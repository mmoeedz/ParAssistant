"""Error recovery.

The system prompt tells the model to diagnose and try another way. This is the
part that does not depend on it complying: it notices a loop, refuses to run the
same failing call a fourth time, retries genuinely transient failures once, and
escalates to the user when a task stops making progress.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any

# Failures worth one automatic retry: a window that was mid-redraw, a COM call
# that raced, a browser socket that had not come up yet.
TRANSIENT_MARKERS = (
    "rpc server",
    "com error",
    "connection",
    "timed out",
    "temporarily",
    "being used by another",
    "0x800",  # generic COM/HRESULT failures
)

MAX_IDENTICAL_CALLS = 3
MAX_CONSECUTIVE_FAILURES = 4


def is_transient(exc: BaseException) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    return any(marker in text for marker in TRANSIENT_MARKERS)


@dataclass
class Recovery:
    """Per-task memory of what has been tried and how it went."""

    calls: dict[str, int] = field(default_factory=dict)
    consecutive_failures: int = 0
    failed_tools: list[str] = field(default_factory=list)
    started: float = field(default_factory=time.time)

    @staticmethod
    def signature(name: str, args: dict[str, Any]) -> str:
        try:
            payload = json.dumps(args, sort_keys=True, default=str)
        except Exception:
            payload = str(args)
        digest = hashlib.sha1(payload.encode("utf-8", "ignore")).hexdigest()[:10]
        return f"{name}:{digest}"

    def note_call(self, name: str, args: dict[str, Any]) -> str | None:
        """Count this call. Returns a refusal if it is going round in circles."""
        signature = self.signature(name, args)
        count = self.calls.get(signature, 0) + 1
        self.calls[signature] = count

        if count > MAX_IDENTICAL_CALLS:
            return (
                f"You have already called {name} with these exact arguments {count - 1} times and "
                "it has not moved things forward. Do not repeat it. Either observe the screen to "
                "see what actually happened, try a different route, or tell the user what is "
                "blocking you."
            )
        return None

    def note_result(self, ok: bool, tool: str) -> str | None:
        """Track the failure streak. Returns guidance when a task is stuck."""
        if ok:
            self.consecutive_failures = 0
            self.failed_tools.clear()
            return None

        self.consecutive_failures += 1
        self.failed_tools.append(tool)

        if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            tried = ", ".join(dict.fromkeys(self.failed_tools))
            return (
                f"\n\n[Paradox] {self.consecutive_failures} steps in a row have failed ({tried}). "
                "Stop trying variations. Look at the screen, and if the way forward is not "
                "obvious, tell the user plainly what is in the way and what you would need."
            )
        if self.consecutive_failures == 2:
            return (
                "\n\n[Paradox] That is two failures in a row. Observe the current state before "
                "acting again — something is probably not where you think it is."
            )
        return None

    @property
    def stuck(self) -> bool:
        return self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
