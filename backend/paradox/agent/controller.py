"""The agent loop.

One user goal becomes one Task. The model decides which tools to call; this
module runs them, enforces permissions, streams the result to the UI, and keeps
the conversation honest about what actually happened.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

from .. import memory, protocol
from ..config import CONFIG
from ..models import ModelTurn, ModelUnavailable, ToolCall
from ..protocol import Step, Task
from ..tools import Registry
from .prompt import build_system
from .recovery import Recovery, is_transient

log = logging.getLogger("paradox.agent")

# How many past screenshots to keep in the conversation. Older ones are
# replaced with a note: they cost a lot of context and rarely matter twice.
KEEP_IMAGES = 2


class Controller:
    def __init__(self, session: Any) -> None:
        self.session = session
        self.registry: Registry = session.registry
        self.recovery = Recovery()

    @property
    def system(self) -> str:
        """Rebuilt each task so newly remembered facts are in scope."""
        return build_system() + memory.context_block()

    # ------------------------------------------------------------ helpers --

    def emit(self, event: dict[str, Any]) -> None:
        self.session.send(event)

    @property
    def history(self) -> list[dict[str, Any]]:
        return self.session.history

    # --------------------------------------------------------------- main --

    async def handle(self, text: str) -> None:
        task = Task(goal=text)
        self.recovery = Recovery()
        self.session.current_task = task
        self.emit(protocol.task_start(task))
        self.history.append({"role": "user", "content": text})

        try:
            await self._loop(task)
        except asyncio.CancelledError:
            task.status = "cancelled"
            self.emit(protocol.task_update(task.id, status="cancelled", status_line="Stopped",
                                           ended_at=protocol.now_ms()))
            self.emit(protocol.message("assistant", "Stopped.", task.id))
            raise
        except ModelUnavailable as exc:
            self._fail(task, str(exc))
        except Exception as exc:  # noqa: BLE001 - the UI must hear about anything
            log.exception("task failed")
            self._fail(task, f"Something broke while I was working on that: {exc}")
        finally:
            self._record(task)
            if self.session.current_task is task:
                self.session.current_task = None

    def _record(self, task: Task) -> None:
        """Keep a durable trace of what was attempted, for the Memory panel."""
        try:
            memory.record_task(
                task_id=task.id,
                goal=task.goal,
                status=task.status,
                summary=getattr(task, "summary", None),
                steps=getattr(task, "step_count", 0),
                started_at=task.started_at / 1000,
                ended_at=protocol.now_ms() / 1000,
            )
        except Exception:  # noqa: BLE001 - never let bookkeeping break a task
            log.debug("could not record the task", exc_info=True)

    def _speak(self, text: str) -> None:
        if not text or not self.session.speak_replies:
            return
        try:
            from ..voice import tts

            tts.speak(text)
        except Exception:  # noqa: BLE001
            log.debug("could not speak the reply", exc_info=True)

    def _fail(self, task: Task, message: str) -> None:
        task.status = "failed"
        self.emit(protocol.task_update(task.id, status="failed", status_line="Failed",
                                       ended_at=protocol.now_ms()))
        self.emit(protocol.error(message, task.id))

    async def _loop(self, task: Task) -> None:
        tools = self.registry.definitions()
        step_count = 0

        for turn_index in range(CONFIG.max_turns):
            message_id: str | None = None

            def on_text(chunk: str) -> None:
                nonlocal message_id
                if message_id is None:
                    message_id, opener = protocol.message_open(task_id=task.id)
                    self.emit(opener)
                self.emit(protocol.message_delta(message_id, chunk))

            turn: ModelTurn = await self.session.model.turn(
                system=self.system,
                messages=self.history,
                tools=tools,
                on_text=on_text,
            )

            if message_id is not None:
                self.emit(protocol.message_done(message_id))

            self.history.append({"role": "assistant", "content": turn.raw_content})

            if not turn.wants_tools:
                summary = turn.text if 0 < len(turn.text) <= 160 else None
                task.summary = summary
                task.step_count = step_count
                self._speak(turn.text)
                task.status = "succeeded"
                self.emit(protocol.task_update(task.id, status="succeeded", status_line="Done",
                                               summary=summary, ended_at=protocol.now_ms()))
                if message_id is None and turn.text:
                    self.emit(protocol.message("assistant", turn.text, task.id))
                return

            if turn_index == 0:
                self.emit(protocol.task_update(task.id, status="running", status_line="Working"))

            results: list[dict[str, Any]] = []
            for call in turn.tool_calls:
                step_count += 1
                results.append(await self._run_tool(task, call))
            task.step_count = step_count

            self._prune_images()
            self.history.append({"role": "user", "content": results})

        self._fail(
            task,
            f"I stopped after {CONFIG.max_turns} steps without finishing. "
            "Tell me what to do differently, or give me a smaller piece of it.",
        )

    # -------------------------------------------------------------- tools --

    async def _run_tool(self, task: Task, call: ToolCall) -> dict[str, Any]:
        tool = self.registry.get(call.name)
        if tool is None:
            return self._result_block(call.id, f"there is no tool called {call.name!r}", error=True)

        args = call.arguments or {}
        category = tool.category_for(args)
        step = Step(label=tool.label_for(args), status="running", tool=call.name)
        self.emit(protocol.task_step(task.id, step))

        # Going in circles is a failure mode of its own: refuse the fourth
        # identical call rather than letting it spin.
        looping = self.recovery.note_call(call.name, args)
        if looping:
            step.status = "skipped"
            step.label = f"Skipped a repeat of: {step.label.lower()}"
            step.evidence = "same call, same arguments, already tried"
            self.emit(protocol.task_step(task.id, step))
            return self._result_block(call.id, looping, error=True)

        decision = self.session.permissions.check(category)

        if not decision.allowed:
            step.status = "blocked"
            step.label = f"Blocked: {step.label.lower()}"
            step.evidence = decision.reason
            self.emit(protocol.task_step(task.id, step))
            return self._result_block(
                call.id,
                f"refused: {decision.reason}. Do not retry this; find another way or tell the user.",
                error=True,
            )

        if decision.needs_confirmation:
            self.emit(protocol.task_update(task.id, status="awaiting_confirmation",
                                           status_line="Waiting for you"))
            approved = await self.session.ask_confirmation(tool, args, category)
            self.emit(protocol.task_update(task.id, status="running", status_line="Working"))
            if not approved:
                step.status = "blocked"
                step.label = f"Declined: {step.label.lower()}"
                step.evidence = "the user said no"
                self.emit(protocol.task_step(task.id, step))
                return self._result_block(
                    call.id,
                    "the user declined this action. Do not attempt it another way.",
                    error=True,
                )

        try:
            result = await self._invoke(tool, args)
        except asyncio.CancelledError:
            step.status = "skipped"
            step.evidence = "cancelled"
            self.emit(protocol.task_step(task.id, step))
            raise
        except asyncio.TimeoutError:
            step.status = "failed"
            step.evidence = f"timed out after {CONFIG.tool_timeout:g}s"
            self.emit(protocol.task_step(task.id, step))
            return self._result_block(call.id, f"{call.name} timed out", error=True)
        except TypeError as exc:
            step.status = "failed"
            step.evidence = "bad arguments"
            self.emit(protocol.task_step(task.id, step))
            return self._result_block(call.id, f"bad arguments for {call.name}: {exc}", error=True)
        except Exception as exc:  # noqa: BLE001 - tool failures are data for the model
            log.exception("tool %s failed", call.name)
            step.status = "failed"
            step.evidence = str(exc)[:160]
            self.emit(protocol.task_step(task.id, step))
            return self._result_block(call.id, f"{call.name} failed: {exc}", error=True)

        step.status = "done" if result.ok else "failed"
        step.label = result.label or step.label
        step.evidence = result.evidence
        self.emit(protocol.task_step(task.id, step))

        if result.observation:
            obs = result.observation
            self.emit(
                protocol.observation(
                    active_window=obs.get("activeWindow") or obs.get("active_window"),
                    image=obs.get("image"),
                    method=obs.get("method", "uia"),
                )
            )

        summary = result.summary
        nudge = self.recovery.note_result(result.ok, call.name)
        if nudge:
            summary += nudge

        return self._result_block(call.id, summary, image=result.image, error=not result.ok)

    async def _invoke(self, tool: Any, args: dict[str, Any]) -> Any:
        """Run a tool, retrying once when the failure looks transient.

        A COM call that raced a window redraw, or a browser socket that was not
        up yet, is worth one more go. A wrong argument is not.
        """
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(tool.handler, **args), timeout=CONFIG.tool_timeout
            )
        except (asyncio.CancelledError, asyncio.TimeoutError, TypeError):
            raise
        except Exception as exc:  # noqa: BLE001
            if not is_transient(exc):
                raise
            log.info("retrying %s after a transient failure: %s", tool.name, exc)
            await asyncio.sleep(0.8)
            return await asyncio.wait_for(
                asyncio.to_thread(tool.handler, **args), timeout=CONFIG.tool_timeout
            )

    @staticmethod
    def _result_block(tool_use_id: str, text: str, image: str | None = None,
                      error: bool = False) -> dict[str, Any]:
        content: Any
        if image and image.startswith("data:image/"):
            header, _, data = image.partition(",")
            media_type = header.removeprefix("data:").partition(";")[0]
            content = [
                {"type": "image",
                 "source": {"type": "base64", "media_type": media_type, "data": data}},
                {"type": "text", "text": text},
            ]
        else:
            content = text

        block: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": content,
        }
        if error:
            block["is_error"] = True
        return block

    def _prune_images(self) -> None:
        """Keep the last few screenshots; replace older ones with a note."""
        seen = 0
        for message in reversed(self.history):
            if message.get("role") != "user" or not isinstance(message.get("content"), list):
                continue
            for block in message["content"]:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                content = block.get("content")
                if not isinstance(content, list):
                    continue
                has_image = any(b.get("type") == "image" for b in content if isinstance(b, dict))
                if not has_image:
                    continue
                seen += 1
                if seen > KEEP_IMAGES:
                    block["content"] = [
                        b for b in content if isinstance(b, dict) and b.get("type") != "image"
                    ] + [{"type": "text", "text": "(earlier screenshot dropped from context)"}]


def encode_image(raw: bytes, media_type: str = "image/png") -> str:
    return f"data:{media_type};base64,{base64.b64encode(raw).decode('ascii')}"
