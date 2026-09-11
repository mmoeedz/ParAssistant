"""OpenAI, via the official SDK. Chat Completions with tools and vision.

Non-streaming: the reply is fetched whole, then the visible text is handed to
`on_text` in one call. Assembling streamed tool-call deltas is where this kind
of adapter usually breaks, and a daily-assistant turn is short enough that the
wait is not worth the risk.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from ..config import CONFIG
from .base import ModelClient, ModelTurn, ModelUnavailable, ToolCall
from ._translate import clean_schema, result_images, result_text, synth_raw_content

log = logging.getLogger("paradox.model")

_STOP = {"stop": "end_turn", "tool_calls": "tool_use", "length": "max_tokens"}


class OpenAIModel(ModelClient):
    def __init__(self, model: str | None = None) -> None:
        if not CONFIG.api_key:
            raise ModelUnavailable(
                "OPENAI_API_KEY is not set. Put it in backend/.env; "
                "NEXUS cannot decide anything without a model."
            )
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:  # pragma: no cover
            raise ModelUnavailable(
                "the openai package is not installed — pip install openai"
            ) from exc

        self.model = model or CONFIG.model
        self.name = f"openai:{self.model}"
        self._client = AsyncOpenAI(api_key=CONFIG.api_key)

    async def turn(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: Callable[[str], None] | None = None,
    ) -> ModelTurn:
        payload = [{"role": "system", "content": system}, *_to_openai(messages)]
        functions = [
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": clean_schema(tool["input_schema"]),
                },
            }
            for tool in tools
        ]

        response = await self._client.chat.completions.create(
            model=self.model,
            messages=payload,
            tools=functions or None,
            max_completion_tokens=CONFIG.max_tokens,
        )
        choice = response.choices[0]
        text = (choice.message.content or "").strip()

        calls: list[ToolCall] = []
        for tc in choice.message.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                log.warning("could not parse tool arguments from openai: %s", tc.function.arguments)
                args = {}
            calls.append(ToolCall(id=tc.id, name=tc.function.name, arguments=args))

        if on_text and text:
            on_text(text)

        return ModelTurn(
            text=text,
            tool_calls=calls,
            stop_reason=_STOP.get(choice.finish_reason or "", "end_turn"),
            raw_content=synth_raw_content(text, calls),
        )


def _to_openai(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        role, content = message.get("role"), message.get("content")

        if role == "user" and isinstance(content, str):
            out.append({"role": "user", "content": content})

        elif role == "assistant":
            blocks = content if isinstance(content, list) else []
            text = "".join(b["text"] for b in blocks if b.get("type") == "text")
            tool_calls = [
                {
                    "id": b["id"],
                    "type": "function",
                    "function": {"name": b["name"], "arguments": json.dumps(b["input"])},
                }
                for b in blocks
                if b.get("type") == "tool_use"
            ]
            entry: dict[str, Any] = {"role": "assistant", "content": text or None}
            if tool_calls:
                entry["tool_calls"] = tool_calls
            out.append(entry)

        elif role == "user" and isinstance(content, list):
            # tool_result blocks. OpenAI's `tool` role is text-only, so any
            # image rides along in a following user message.
            trailing_images: list[str] = []
            for block in content:
                if block.get("type") != "tool_result":
                    continue
                inner = block.get("content")
                text = result_text(inner) or "(see image)"
                out.append(
                    {"role": "tool", "tool_call_id": block["tool_use_id"], "content": text}
                )
                for media_type, data in result_images(inner):
                    trailing_images.append(f"data:{media_type};base64,{data}")
            if trailing_images:
                out.append(
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "(screenshots from the tool results above)"},
                            *(
                                {"type": "image_url", "image_url": {"url": url}}
                                for url in trailing_images
                            ),
                        ],
                    }
                )

    return out
