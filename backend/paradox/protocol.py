"""Wire protocol shared with the frontend.

Mirrors frontend/src/types/protocol.ts. Keep the two in step: the field names
here are the field names the UI reads.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

AGENT_NAME = "PARADOX"
AGENT_VERSION = "0.1.0"


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def now_ms() -> int:
    return int(time.time() * 1000)


StepStatus = Literal["pending", "running", "done", "failed", "skipped", "blocked"]
TaskStatus = Literal["planning", "running", "awaiting_confirmation", "succeeded", "failed", "cancelled"]
Tier = Literal["safe", "sensitive", "dangerous"]


@dataclass
class Step:
    label: str
    status: StepStatus = "running"
    tool: str | None = None
    evidence: str | None = None
    id: str = field(default_factory=lambda: uid("step"))

    def as_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "label": self.label, "status": self.status}
        if self.tool:
            out["tool"] = self.tool
        if self.evidence:
            out["evidence"] = self.evidence
        return out


@dataclass
class Task:
    goal: str
    id: str = field(default_factory=lambda: uid("task"))
    status: TaskStatus = "planning"
    status_line: str = "Working out how"
    started_at: int = field(default_factory=now_ms)
    summary: str | None = None
    step_count: int = 0

    def as_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "goal": self.goal,
            "status": self.status,
            "statusLine": self.status_line,
            "steps": [],
            "startedAt": self.started_at,
        }


# ----------------------------------------------------------------- events --


def hello(capabilities: list[str]) -> dict[str, Any]:
    return {
        "type": "hello",
        "agent": AGENT_NAME,
        "version": AGENT_VERSION,
        "capabilities": capabilities,
    }


def message(role: str, text: str, task_id: str | None = None, error: bool = False) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "id": uid("msg"),
        "role": role,
        "text": text,
        "createdAt": now_ms(),
        "source": "text",
    }
    if task_id:
        msg["taskId"] = task_id
    if error:
        msg["error"] = True
    return {"type": "message", "message": msg}


def message_open(role: str = "assistant", task_id: str | None = None) -> tuple[str, dict[str, Any]]:
    """Start an empty message the deltas will fill in."""
    msg: dict[str, Any] = {
        "id": uid("msg"),
        "role": role,
        "text": "",
        "createdAt": now_ms(),
        "source": "text",
        "streaming": True,
    }
    if task_id:
        msg["taskId"] = task_id
    return msg["id"], {"type": "message", "message": msg}


def message_delta(message_id: str, text: str) -> dict[str, Any]:
    return {"type": "message.delta", "id": message_id, "text": text}


def message_done(message_id: str) -> dict[str, Any]:
    return {"type": "message.done", "id": message_id}


def task_start(task: Task) -> dict[str, Any]:
    return {"type": "task.start", "task": task.as_json()}


def task_update(task_id: str, **patch: Any) -> dict[str, Any]:
    if "status_line" in patch:
        patch["statusLine"] = patch.pop("status_line")
    if "ended_at" in patch:
        patch["endedAt"] = patch.pop("ended_at")
    return {"type": "task.update", "taskId": task_id, "patch": patch}


def task_step(task_id: str, step: Step) -> dict[str, Any]:
    return {"type": "task.step", "taskId": task_id, "step": step.as_json()}


def confirm_request(
    request_id: str,
    tier: Tier,
    category: str,
    title: str,
    detail: str,
    tool: str,
    params: dict[str, str],
) -> dict[str, Any]:
    return {
        "type": "confirm.request",
        "request": {
            "id": request_id,
            "tier": tier,
            "category": category,
            "title": title,
            "detail": detail,
            "tool": tool,
            "params": params,
            "createdAt": now_ms(),
        },
    }


def confirm_resolved(request_id: str) -> dict[str, Any]:
    return {"type": "confirm.resolved", "requestId": request_id}


def observation(
    active_window: str | None = None,
    image: str | None = None,
    method: str = "uia",
) -> dict[str, Any]:
    obs: dict[str, Any] = {"id": uid("obs"), "capturedAt": now_ms(), "method": method}
    if active_window:
        obs["activeWindow"] = active_window
    if image:
        obs["image"] = image
    return {"type": "observation", "observation": obs}


def system_stats(stats: dict[str, Any]) -> dict[str, Any]:
    return {"type": "system.stats", "stats": stats}


def memory_list(facts: list[dict[str, Any]], stats: dict[str, Any]) -> dict[str, Any]:
    return {"type": "memory", "facts": facts, "stats": stats}


def transcript(text: str) -> dict[str, Any]:
    """What the microphone heard, shown before the task starts."""
    return {
        "type": "message",
        "message": {
            "id": uid("msg"),
            "role": "user",
            "text": text,
            "createdAt": now_ms(),
            "source": "voice",
        },
    }


def now_playing(state: dict[str, Any] | None) -> dict[str, Any]:
    """Whatever Windows says is playing, or null when nothing is."""
    return {"type": "media", "media": state}


def headlines(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "headlines", "items": items}


def voice_state(state: str) -> dict[str, Any]:
    return {"type": "voice.state", "state": state}


def pong(ping_id: str) -> dict[str, Any]:
    """Echo of a client ping, so it can time the round trip itself."""
    return {"type": "pong", "id": ping_id}


def error(text: str, task_id: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "error", "message": text}
    if task_id:
        out["taskId"] = task_id
    return out
