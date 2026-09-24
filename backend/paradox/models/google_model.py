"""Google Gemini, via the google-genai SDK.

Non-streaming, for the same reason as the OpenAI adapter: the reply is fetched
whole, then the visible text is handed to `on_text` once.

Two Gemini-isms handled here:
  - No tool-call ids — results are matched back to a call by tool name.
  - Gemini 3 attaches an opaque `thought_signature` to the parts of a turn
    that used tools; it must be echoed back verbatim on the next request or the
    API rejects the whole conversation. It is stashed on the canonical blocks
    under `_google_sig` (base64) and reattached in `_to_gemini`.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
from typing import Any, Callable

from ..config import CONFIG
from .base import ModelClient, ModelTurn, ModelUnavailable, ToolCall
from ._translate import clean_schema, result_images, result_text, tool_names_by_id

log = logging.getLogger("paradox.model")

# Observed in testing: a turn can sit with no response and no error for
# several minutes under load, with nothing logged in between — indistinguishable
# from a genuine hang from the task card's point of view. Bound it so a stall
# fails with a clear message instead of leaving the UI stuck on "In Progress"
# with only the Cancel button as a way out.
REQUEST_TIMEOUT = 90.0

# Waits before each retry of a 503. A 429 waits however long Google says to
# instead, as long as that is no more than MAX_RETRY_WAIT.
RETRY_503 = (2.0, 5.0, 10.0)
MAX_RETRY_WAIT = 40.0


class _Retry(Exception):
    """A failure worth waiting out; `final` is raised if the waiting runs out."""

    def __init__(self, reason: str, delay: float | None, cause: BaseException,
                 final: ModelUnavailable) -> None:
        super().__init__(reason)
        self.reason = reason
        self.cause = cause
        self.final = final
        self.delay = delay if delay is not None else 0.0

    def with_default(self, delay: float) -> "_Retry":
        if self.delay <= 0:
            self.delay = delay
        return self


def _retry_delay(text: str) -> float:
    """Google's suggested wait from a 429 body, e.g. "Please retry in 23.5s"."""
    match = re.search(r"retry in ([\d.]+)\s*s", text, re.IGNORECASE) or re.search(
        r"retryDelay['\"]?\s*:\s*['\"]?([\d.]+)s", text)
    return float(match.group(1)) + 1.0 if match else 20.0


class GoogleModel(ModelClient):
    def __init__(self, model: str | None = None) -> None:
        if not CONFIG.api_key:
            raise ModelUnavailable(
                "GEMINI_API_KEY is not set. Put it in backend/.env; "
                "Paradox cannot decide anything without a model."
            )
        try:
            from google import genai
        except ImportError as exc:  # pragma: no cover
            raise ModelUnavailable(
                "the google-genai package is not installed — pip install google-genai"
            ) from exc

        self.model = model or CONFIG.model
        self.name = f"google:{self.model}"
        self._genai = genai
        self._client = genai.Client(api_key=CONFIG.api_key)

    async def turn(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: Callable[[str], None] | None = None,
    ) -> ModelTurn:
        from google.genai import types

        names = tool_names_by_id(messages)
        contents = _to_gemini(messages, names, types)

        declarations = [
            types.FunctionDeclaration(
                name=tool["name"],
                description=tool.get("description", ""),
                parameters=clean_schema(tool["input_schema"]) or None,
            )
            for tool in tools
        ]

        # Gemini 3 thinks before every turn. For an agent that mostly makes
        # concrete tool calls, deep per-step reasoning is slow and burns tokens
        # (and free-tier request quota) for little gain — keep it shallow.
        # PARADOX_GEMINI_THINKING: minimal | low | medium | high.
        level = os.getenv("PARADOX_GEMINI_THINKING", "low").strip().upper()
        thinking = None
        if level in {"MINIMAL", "LOW", "MEDIUM", "HIGH"}:
            try:
                thinking = types.ThinkingConfig(thinking_level=level)
            except Exception:  # noqa: BLE001 - older SDK without thinking_level
                thinking = None

        config = types.GenerateContentConfig(
            system_instruction=system or None,
            tools=[types.Tool(function_declarations=declarations)] if declarations else None,
            max_output_tokens=CONFIG.max_tokens,
            thinking_config=thinking,
        )

        response = await self._generate(contents, config)
        return self._parse(response, on_text)

    async def _generate(self, contents: Any, config: Any) -> Any:
        """One request, retried through Gemini's short-lived failures.

        Both of these were hit in normal use on the free tier: a 503 "high
        demand" that clears in seconds, and a per-minute 429 after about six
        quick requests (one agent task makes one request per step). Failing
        the task on either meant a long task almost never finished.
        """
        for attempt in range(len(RETRY_503) + 1):
            try:
                return await self._request(contents, config)
            except _Retry as retry:
                if attempt >= len(RETRY_503):
                    raise retry.final from retry.cause
                retry.with_default(RETRY_503[attempt])
                if retry.delay > MAX_RETRY_WAIT:
                    raise retry.final from retry.cause
                log.info("Gemini %s — retrying in %.0fs", retry.reason, retry.delay)
                await asyncio.sleep(retry.delay)
        raise AssertionError("unreachable")

    async def _request(self, contents: Any, config: Any) -> Any:
        try:
            return await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=self.model, contents=contents, config=config
                ),
                timeout=REQUEST_TIMEOUT,
            )
        except asyncio.TimeoutError as exc:
            raise ModelUnavailable(
                f"Gemini did not respond within {REQUEST_TIMEOUT:g}s — likely overloaded "
                "right now. Try again, or switch providers if this keeps happening."
            ) from exc
        except Exception as exc:  # noqa: BLE001
            text = str(exc)
            if "RESOURCE_EXHAUSTED" in text or "429" in text:
                log.info("Gemini quota error, raw: %s", text[:400])
                # The free tier has separate per-minute AND per-day caps. Only
                # the per-minute one clears by waiting — a per-day quota does
                # not reset until midnight Pacific, so telling the user to
                # "wait a minute" for that case is actively wrong.
                lowered = text.lower()
                if "perday" in lowered.replace(" ", "") or "requests per day" in lowered:
                    raise ModelUnavailable(
                        "Gemini's free-tier *daily* request quota is used up for this "
                        "model — waiting a few minutes will not help, it resets at "
                        "midnight Pacific time. Enable billing on the Google Cloud "
                        "project for higher limits, switch PARADOX_MODEL to a "
                        "different Gemini model, or switch providers."
                    ) from exc
                raise _Retry(
                    "rate limit (per minute)", _retry_delay(text), exc,
                    ModelUnavailable(
                        "Gemini rate limit hit (the free tier allows only a few requests "
                        "a minute) and it did not clear in time. Wait a minute, enable "
                        "billing on the Google project for higher limits, or switch providers."
                    ),
                ) from exc
            if "UNAVAILABLE" in text or "503" in text or "high demand" in text.lower():
                raise _Retry(
                    "overloaded (503)", None, exc,
                    ModelUnavailable(
                        "Gemini is overloaded on Google's side (503) and stayed that way "
                        "through several retries. This is not something wrong here — try "
                        "again shortly, or set PARADOX_MODEL to another Gemini model."
                    ),
                ) from exc
            raise

    def _parse(self, response: Any, on_text: Callable[[str], None] | None) -> ModelTurn:
        text_parts: list[str] = []
        calls: list[ToolCall] = []
        raw: list[dict[str, Any]] = []
        candidate = response.candidates[0] if response.candidates else None
        parts = candidate.content.parts if candidate and candidate.content else None
        for part in parts or []:
            sig = getattr(part, "thought_signature", None)
            sig_b64 = base64.b64encode(sig).decode("ascii") if sig else None

            if getattr(part, "text", None):
                text_parts.append(part.text)
                block = {"type": "text", "text": part.text}
                if sig_b64:
                    block["_google_sig"] = sig_b64
                raw.append(block)

            call = getattr(part, "function_call", None)
            if call is not None:
                tc = ToolCall(
                    id=f"call_{len(calls)}_{call.name}",
                    name=call.name,
                    arguments=dict(call.args or {}),
                )
                calls.append(tc)
                block = {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments,
                }
                if sig_b64:
                    block["_google_sig"] = sig_b64
                raw.append(block)

        text = "".join(text_parts).strip()
        if not text and not calls:
            # Nothing to show and nothing to run — without this the task was
            # marked succeeded with a blank reply.
            reason = getattr(candidate, "finish_reason", None) if candidate else None
            reason = getattr(reason, "name", None) or str(reason or "no candidates")
            feedback = getattr(response, "prompt_feedback", None)
            block = getattr(feedback, "block_reason", None) if feedback else None
            raise ModelUnavailable(
                f"Gemini returned an empty reply ({getattr(block, 'name', block) or reason}). "
                "Try rephrasing the request, or try again."
            )
        if on_text and text:
            on_text(text)

        return ModelTurn(
            text=text,
            tool_calls=calls,
            stop_reason="tool_use" if calls else "end_turn",
            raw_content=raw,
        )


def _sig_bytes(block: dict[str, Any]) -> bytes | None:
    raw = block.get("_google_sig")
    return base64.b64decode(raw) if raw else None


def _to_gemini(
    messages: list[dict[str, Any]], names: dict[str, str], types: Any
) -> list[Any]:
    out: list[Any] = []
    for message in messages:
        role, content = message.get("role"), message.get("content")

        if role == "user" and isinstance(content, str):
            out.append(types.Content(role="user", parts=[types.Part(text=content)]))

        elif role == "assistant":
            parts: list[Any] = []
            for block in content if isinstance(content, list) else []:
                sig = _sig_bytes(block)
                if block.get("type") == "text" and block.get("text"):
                    parts.append(types.Part(text=block["text"], thought_signature=sig))
                elif block.get("type") == "tool_use":
                    parts.append(
                        types.Part(
                            function_call=types.FunctionCall(
                                name=block["name"], args=block.get("input") or {}
                            ),
                            thought_signature=sig,
                        )
                    )
            if parts:
                out.append(types.Content(role="model", parts=parts))

        elif role == "user" and isinstance(content, list):
            parts = []
            for block in content:
                if block.get("type") != "tool_result":
                    continue
                name = names.get(block.get("tool_use_id", ""), "tool")
                inner = block.get("content")
                text = result_text(inner) or "(see image)"
                parts.append(
                    types.Part.from_function_response(name=name, response={"result": text})
                )
                for media_type, data in result_images(inner):
                    parts.append(
                        types.Part.from_bytes(
                            data=base64.b64decode(data), mime_type=media_type
                        )
                    )
            if parts:
                out.append(types.Content(role="user", parts=parts))

    return out
