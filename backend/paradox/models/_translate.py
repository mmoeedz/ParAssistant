"""Translation between the canonical history and each provider's wire format.

The controller keeps one history, in the Anthropic JSON shapes (see base.py).
Non-Anthropic adapters translate that history into their own format on every
turn, and translate the reply back into a ModelTurn. Its `raw_content` is
written back in the canonical shape so the next turn translates cleanly too.
"""

from __future__ import annotations

from typing import Any

from .base import ToolCall


def synth_raw_content(text: str, tool_calls: list[ToolCall]) -> list[dict[str, Any]]:
    """Rebuild canonical assistant blocks from a provider's plain reply."""
    blocks: list[dict[str, Any]] = []
    if text:
        blocks.append({"type": "text", "text": text})
    for call in tool_calls:
        blocks.append(
            {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
        )
    return blocks


def tool_names_by_id(messages: list[dict[str, Any]]) -> dict[str, str]:
    """id -> tool name, read from the assistant turns already in the history.

    Providers that key tool results by name rather than by call id (Gemini)
    need this to label a `tool_result` block.
    """
    out: dict[str, str] = {}
    for message in messages:
        if message.get("role") != "assistant":
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                out[block["id"]] = block["name"]
    return out


# JSON Schema keys that the OpenAI (non-strict) and Gemini function schemas
# either reject outright or quietly choke on.
_DROP_KEYS = {"$schema", "$id", "additionalProperties", "title", "default", "examples"}


def clean_schema(schema: Any) -> Any:
    """A JSON Schema both OpenAI and Gemini will accept as a function schema."""
    if not isinstance(schema, dict):
        return schema
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key in _DROP_KEYS:
            continue
        if key == "properties" and isinstance(value, dict):
            out[key] = {k: clean_schema(v) for k, v in value.items()}
        elif key in ("items", "additionalItems"):
            out[key] = clean_schema(value)
        elif key in ("anyOf", "oneOf", "allOf") and isinstance(value, list):
            out[key] = [clean_schema(v) for v in value]
        else:
            out[key] = value
    return out


def result_text(inner: Any) -> str:
    """The text half of a tool_result's content (canonical shape)."""
    if isinstance(inner, str):
        return inner
    if isinstance(inner, list):
        parts = [b["text"] for b in inner if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(parts)
    return ""


def result_images(inner: Any) -> list[tuple[str, str]]:
    """(media_type, base64 data) for every image in a tool_result's content."""
    if not isinstance(inner, list):
        return []
    images: list[tuple[str, str]] = []
    for block in inner:
        if isinstance(block, dict) and block.get("type") == "image":
            source = block.get("source") or {}
            if source.get("type") == "base64":
                images.append((source.get("media_type", "image/png"), source.get("data", "")))
    return images
