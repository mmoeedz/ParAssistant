"""Model abstraction.

The agent talks to this interface, not to a vendor SDK, so the model behind
Paradox can be swapped without touching the controller or the tools.

Messages and tool definitions use the Anthropic JSON shapes as the common
vocabulary; a different provider implements this protocol by translating.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


class ModelUnavailable(RuntimeError):
    """No usable model — missing credentials, or the provider refused."""


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ModelTurn:
    """One assistant turn: what it said, what it wants to run, why it stopped."""

    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = "end_turn"
    # Provider-native content blocks, echoed back verbatim on the next request.
    raw_content: Any = None

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


class ModelClient(Protocol):
    name: str

    async def turn(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: Callable[[str], None] | None = None,
    ) -> ModelTurn:
        """Run one turn, streaming visible text through `on_text` as it arrives."""
        ...
