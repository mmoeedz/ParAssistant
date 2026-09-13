"""Text to speech.

Three providers:

* `google` — Google Cloud Text-to-Speech's neural voices. The default: sends
  reply text to Google's endpoint to be synthesized, in exchange for natural,
  high-quality speech in far more languages/accents than the other two.
* `sapi` — the voices built into Windows. Local, offline, instant, no data
  leaves the machine, but only whatever voices are installed on it.
* `edge` — Microsoft's neural voices. Also sends text to an endpoint (this
  time Microsoft's) — a fallback if Google credentials are not set up.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

OUT_DIR = Path(os.getenv("TEMP", tempfile.gettempdir())) / "paradox" / "speech"

DEFAULT_PROVIDER = os.getenv("PARADOX_TTS", "google")
_CONFIGURED_VOICE = os.getenv("PARADOX_TTS_VOICE")
DEFAULT_EDGE_VOICE = _CONFIGURED_VOICE or "en-GB-SoniaNeural"
# A natural, widely-available Neural2 voice. Any voice name from
# `client.list_voices()` works — see `voices('google')`.
DEFAULT_GOOGLE_VOICE = _CONFIGURED_VOICE or "en-US-Neural2-C"

GOOGLE_API_KEY = os.getenv("GOOGLE_CLOUD_API_KEY") or os.getenv("GOOGLE_CLOUD_TTS_API_KEY")
GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# SAPI stream mode: create for write.
_SSFM_CREATE_FOR_WRITE = 3


def _google_client():
    from google.cloud import texttospeech

    if GOOGLE_API_KEY:
        from google.api_core.client_options import ClientOptions

        return texttospeech.TextToSpeechClient(client_options=ClientOptions(api_key=GOOGLE_API_KEY))
    return texttospeech.TextToSpeechClient()  # GOOGLE_APPLICATION_CREDENTIALS / ADC


def _voice_language(voice_name: str) -> str:
    """"en-US-Neural2-C" -> "en-US" — the language code Google's API wants
    alongside the voice name."""
    parts = voice_name.split("-")
    return "-".join(parts[:2]) if len(parts) >= 2 else voice_name


def available() -> dict[str, bool]:
    providers = {"google": False, "sapi": False, "edge": False}
    try:
        from google.cloud import texttospeech  # noqa: F401

        providers["google"] = bool(GOOGLE_API_KEY or GOOGLE_CREDENTIALS_FILE)
    except Exception:
        pass
    try:
        import win32com.client  # noqa: F401

        providers["sapi"] = True
    except Exception:
        pass
    try:
        import edge_tts  # noqa: F401

        providers["edge"] = True
    except Exception:
        pass
    return providers


def voices(provider: str = DEFAULT_PROVIDER) -> list[str]:
    if provider == "google":
        try:
            client = _google_client()
            language = _voice_language(DEFAULT_GOOGLE_VOICE)
            found = client.list_voices(language_code=language).voices
            return [v.name for v in found]
        except Exception:
            return []
    if provider == "sapi":
        try:
            import win32com.client

            engine = win32com.client.Dispatch("SAPI.SpVoice")
            return [v.GetDescription() for v in engine.GetVoices()]
        except Exception:
            return []
    if provider == "edge":
        try:
            import edge_tts

            # Filter to whatever language the configured voice is in — not
            # hardcoded to English, so a non-English DEFAULT_EDGE_VOICE (e.g.
            # ur-PK-UzmaNeural) actually surfaces its own language's voices.
            found = asyncio.run(edge_tts.list_voices())
            prefix = DEFAULT_EDGE_VOICE.split("-")[0] + "-"
            return [v["ShortName"] for v in found if v["ShortName"].startswith(prefix)]
        except Exception:
            return []
    return []


def _select_sapi_voice(engine, wanted: str | None) -> None:
    if not wanted:
        return
    try:
        for voice in engine.GetVoices():
            if wanted.lower() in voice.GetDescription().lower():
                engine.Voice = voice
                return
    except Exception:
        pass


def speak(text: str, provider: str = DEFAULT_PROVIDER, voice: str | None = None,
          blocking: bool = False, on_done: Callable[[], None] | None = None) -> None:
    """Say something out loud on this machine's speakers.

    `on_done` fires after playback actually finishes for `google` and `sapi`
    (both play a `.wav` synchronously) — accurate enough to gate something
    like always-listening on. For `edge` (an `.mp3` handed to the default
    player) it fires right after handing it off, since nothing here can see
    when an external player finishes.
    """
    if not text.strip():
        if on_done:
            on_done()
        return

    def run() -> None:
        try:
            if provider in ("google", "edge"):
                path = speak_to_file(text, provider=provider, voice=voice)
                _play(path)
                return
            import pythoncom
            import win32com.client

            pythoncom.CoInitialize()
            try:
                engine = win32com.client.Dispatch("SAPI.SpVoice")
                _select_sapi_voice(engine, voice)
                engine.Speak(text)
            finally:
                pythoncom.CoUninitialize()
        except Exception:
            pass
        finally:
            if on_done:
                on_done()

    if blocking:
        run()
    else:
        threading.Thread(target=run, daemon=True).start()


def speak_to_file(text: str, path: Path | None = None, provider: str = DEFAULT_PROVIDER,
                  voice: str | None = None) -> Path:
    """Render speech to an audio file and return its path."""
    if not text.strip():
        raise ValueError("nothing to say")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")

    if provider == "google":
        from google.cloud import texttospeech

        voice_name = voice or DEFAULT_GOOGLE_VOICE
        client = _google_client()
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(
                language_code=_voice_language(voice_name), name=voice_name,
            ),
            # LINEAR16 comes back as a complete .wav (Google adds the header)
            # — playable immediately and, unlike an mp3 handed to an external
            # player, its playback can be waited on (see _play/on_done above).
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.LINEAR16,
            ),
        )
        target = path or OUT_DIR / f"paradox-{stamp}.wav"
        target.write_bytes(response.audio_content)
        return target

    if provider == "edge":
        import edge_tts

        target = path or OUT_DIR / f"paradox-{stamp}.mp3"

        async def render() -> None:
            speech = edge_tts.Communicate(text, voice or DEFAULT_EDGE_VOICE)
            await speech.save(str(target))

        asyncio.run(render())
        return target

    # SAPI writes wav.
    import pythoncom
    import win32com.client

    target = path or OUT_DIR / f"paradox-{stamp}.wav"
    pythoncom.CoInitialize()
    try:
        engine = win32com.client.Dispatch("SAPI.SpVoice")
        _select_sapi_voice(engine, voice)
        stream = win32com.client.Dispatch("SAPI.SpFileStream")
        stream.Open(str(target), _SSFM_CREATE_FOR_WRITE)
        engine.AudioOutputStream = stream
        engine.Speak(text)
        stream.Close()
    finally:
        pythoncom.CoUninitialize()

    return target


def _play(path: Path) -> None:
    try:
        if path.suffix.lower() == ".wav":
            import winsound

            winsound.PlaySound(str(path), winsound.SND_FILENAME)
            return
        os.startfile(str(path))  # noqa: S606 - hands an audio file to the default player
    except Exception:
        pass


def info() -> dict[str, object]:
    return {
        "providers": available(),
        "default": DEFAULT_PROVIDER,
        "voices": voices()[:8],
    }
