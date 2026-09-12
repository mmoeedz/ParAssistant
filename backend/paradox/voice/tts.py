"""Text to speech.

Two providers:

* `sapi` — the voices built into Windows. Local, offline, instant, no data
  leaves the machine. The default, per the local-first rule.
* `edge` — Microsoft's neural voices. Much better sounding, but the text is
  sent to a Microsoft endpoint, so it is opt-in and says so.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from pathlib import Path

OUT_DIR = Path(os.getenv("TEMP", tempfile.gettempdir())) / "paradox" / "speech"

DEFAULT_PROVIDER = os.getenv("PARADOX_TTS", "sapi")
DEFAULT_EDGE_VOICE = os.getenv("PARADOX_TTS_VOICE", "en-GB-SoniaNeural")

# SAPI stream mode: create for write.
_SSFM_CREATE_FOR_WRITE = 3


def available() -> dict[str, bool]:
    providers = {"sapi": False, "edge": False}
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

            found = asyncio.run(edge_tts.list_voices())
            return [v["ShortName"] for v in found if v["ShortName"].startswith("en-")]
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
          blocking: bool = False) -> None:
    """Say something out loud on this machine's speakers."""
    if not text.strip():
        return

    def run() -> None:
        if provider == "edge":
            path = speak_to_file(text, provider="edge", voice=voice)
            _play(path)
            return
        try:
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
