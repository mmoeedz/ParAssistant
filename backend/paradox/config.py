"""Configuration. Secrets come from the environment, never from source."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Where the model is allowed to look without being asked. Everything outside
# these roots needs an explicit absolute path from the user.
DEFAULT_ROOTS = [
    Path.home() / "Downloads",
    Path.home() / "Desktop",
    Path.home() / "Documents",
    Path.home() / "Pictures",
    Path.home() / "Videos",
    Path.home() / "Music",
]

# ------------------------------------------------------------------ model --

# The provider is chosen by whichever key is present. Set PARADOX_PROVIDER to
# force one when several keys are in the environment.
PROVIDER_KEYS: dict[str, tuple[str, ...]] = {
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    "openai": ("OPENAI_API_KEY",),
    "google": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
}

# The default model per provider. Override any of them with PARADOX_MODEL.
DEFAULT_MODEL: dict[str, str] = {
    "anthropic": "claude-opus-5",
    "openai": "gpt-5",
    "google": "gemini-3.6-flash",
}


def _detect_provider() -> str | None:
    forced = os.getenv("PARADOX_PROVIDER")
    if forced:
        return forced.strip().lower()
    for provider, keys in PROVIDER_KEYS.items():
        if any(os.getenv(k) for k in keys):
            return provider
    return None


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 8765
    path: str = "/ws"

    max_tokens: int = 8000
    effort: str = os.getenv("PARADOX_EFFORT", "high")

    # Hard stop on a single task, so a confused loop cannot run forever.
    max_turns: int = 24
    tool_timeout: float = 45.0

    log_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parents[2] / "logs")
    screenshot_dir: Path = field(
        default_factory=lambda: Path(os.getenv("TEMP", "/tmp")) / "paradox" / "screens"
    )

    @property
    def provider(self) -> str | None:
        """anthropic, openai or google — whichever has a key. None if none do."""
        return _detect_provider()

    @property
    def model(self) -> str:
        explicit = os.getenv("PARADOX_MODEL")
        if explicit:
            return explicit
        return DEFAULT_MODEL.get(self.provider or "anthropic", DEFAULT_MODEL["anthropic"])

    @property
    def api_key(self) -> str | None:
        """The key for the active provider."""
        for name in PROVIDER_KEYS.get(self.provider or "anthropic", ()):
            value = os.getenv(name)
            if value:
                return value
        return None

    # ------------------------------------------------------- whatsapp api --
    # The official Cloud API — a different capability from the UI-automation
    # path in computer/whatsapp.py, not a faster version of it. See
    # computer/whatsapp_api.py and .env.example for what these are and where
    # to get them.

    @property
    def whatsapp_api_token(self) -> str | None:
        return os.getenv("WHATSAPP_API_TOKEN")

    @property
    def whatsapp_phone_number_id(self) -> str | None:
        return os.getenv("WHATSAPP_PHONE_NUMBER_ID")

    @property
    def whatsapp_api_version(self) -> str:
        return os.getenv("WHATSAPP_API_VERSION", "v21.0")

    def ensure_dirs(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)


CONFIG = Config()
