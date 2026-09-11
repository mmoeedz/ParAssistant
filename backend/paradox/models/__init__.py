from ..config import CONFIG
from .base import ModelClient, ModelTurn, ModelUnavailable, ToolCall


def create_model(provider: str | None = None, model: str | None = None) -> ModelClient:
    """The model client for the active provider.

    Provider is chosen from whichever key is in the environment
    (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY), or forced with
    PARADOX_PROVIDER. `model` overrides the per-provider default.
    """
    provider = (provider or CONFIG.provider or "anthropic").lower()

    if provider == "anthropic":
        from .anthropic_model import AnthropicModel

        return AnthropicModel(model)

    if provider == "openai":
        from .openai_model import OpenAIModel

        return OpenAIModel(model)

    if provider in ("google", "gemini"):
        from .google_model import GoogleModel

        return GoogleModel(model)

    raise ModelUnavailable(
        f"no model provider called {provider!r} is wired up — "
        "use anthropic, openai or google"
    )


__all__ = ["ModelClient", "ModelTurn", "ModelUnavailable", "ToolCall", "create_model"]
