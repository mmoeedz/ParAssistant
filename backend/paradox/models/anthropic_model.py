"""Claude, via the Anthropic SDK."""

from __future__ import annotations

import logging
from typing import Any, Callable

import anthropic

from ..config import CONFIG
from .base import ModelClient, ModelTurn, ModelUnavailable, ToolCall

log = logging.getLogger("paradox.model")

# Server-side fallback: if a safety classifier declines a turn, the API routes
# to a capable alternative instead of handing back an empty refusal.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicModel(ModelClient):
    def __init__(self, model: str | None = None) -> None:
        if not CONFIG.api_key:
            raise ModelUnavailable(
                "ANTHROPIC_API_KEY is not set. Put it in backend/.env or the environment; "
                "NEXUS cannot decide anything without a model."
            )
        self.model = model or CONFIG.model
        self.name = f"anthropic:{self.model}"
        self._client = anthropic.AsyncAnthropic(api_key=CONFIG.api_key)
        # Flipped off if this SDK build does not know the fallback parameters.
        self._use_fallbacks = True

    async def turn(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: Callable[[str], None] | None = None,
    ) -> ModelTurn:
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": CONFIG.max_tokens,
            "system": system,
            "messages": messages,
            "tools": tools,
            # Adaptive thinking; the chain of thought is never surfaced to the UI.
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": CONFIG.effort},
        }

        try:
            final = await self._stream(params, on_text)
        except TypeError as exc:
            # An older SDK that does not accept the fallback parameters.
            if not self._use_fallbacks:
                raise
            log.warning("retrying without server-side fallbacks: %s", exc)
            self._use_fallbacks = False
            final = await self._stream(params, on_text)
        except anthropic.BadRequestError as exc:
            if self._use_fallbacks and "fallback" in str(exc).lower():
                log.warning("server rejected fallbacks, retrying without: %s", exc)
                self._use_fallbacks = False
                final = await self._stream(params, on_text)
            else:
                raise

        if final.stop_reason == "refusal":
            details = getattr(final, "stop_details", None)
            category = getattr(details, "category", None) or "unspecified"
            raise ModelUnavailable(
                f"The model declined this request ({category}). Rephrase it, or do this step yourself."
            )

        text_parts: list[str] = []
        calls: list[ToolCall] = []
        for block in final.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                calls.append(ToolCall(id=block.id, name=block.name, arguments=dict(block.input)))

        return ModelTurn(
            text="".join(text_parts).strip(),
            tool_calls=calls,
            stop_reason=final.stop_reason or "end_turn",
            raw_content=final.content,
        )

    async def _stream(self, params: dict[str, Any], on_text: Callable[[str], None] | None):
        call = dict(params)
        if self._use_fallbacks:
            call["betas"] = [FALLBACK_BETA]
            call["fallbacks"] = "default"
            streamer = self._client.beta.messages.stream
        else:
            streamer = self._client.messages.stream

        async with streamer(**call) as stream:
            async for event in stream:
                if (
                    on_text
                    and event.type == "content_block_delta"
                    and getattr(event.delta, "type", None) == "text_delta"
                ):
                    on_text(event.delta.text)
            return await stream.get_final_message()
