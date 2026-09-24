"""Text to speech.

Three providers:

* `google` — Google Cloud Text-to-Speech's neural voices. The default when its
  credentials are set: sends reply text to Google's endpoint to be
  synthesized, in exchange for natural, high-quality speech in far more
  languages/accents than the other two.
* `edge` — Microsoft's neural voices. Also sends text to an endpoint (this
  time Microsoft's); no key needed. The fallback when Google is not set up.
* `sapi` — the voices built into Windows. Local, offline, instant, no data
  leaves the machine, but only whatever voices are installed on it. The last
  resort, and what `edge` drops to when the network is down.

`PARADOX_TTS` picks the first one tried; whichever of the others work are
tried after it, so a missing key or a dropped connection costs quality, not
the reply.
"""

from __future__ import annotations

import asyncio
import ctypes
import logging
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from .. import config as _config  # noqa: F401 - loads backend/.env before the reads below

log = logging.getLogger(__name__)

OUT_DIR = Path(os.getenv("TEMP", tempfile.gettempdir())) / "paradox" / "speech"
# Old renders are pruned past this many, oldest first.
KEEP_FILES = 40

ORDER = ("google", "edge", "sapi")
DEFAULT_PROVIDER = os.getenv("PARADOX_TTS", "google").strip().lower()
_CONFIGURED_VOICE = os.getenv("PARADOX_TTS_VOICE")
DEFAULT_EDGE_VOICE = os.getenv("PARADOX_TTS_EDGE_VOICE") or "en-GB-SoniaNeural"
# A natural, widely-available Neural2 voice. Any voice name from
# `client.list_voices()` works — see `voices('google')`.
DEFAULT_GOOGLE_VOICE = _CONFIGURED_VOICE or "en-US-Neural2-C"

GOOGLE_API_KEY = os.getenv("GOOGLE_CLOUD_API_KEY") or os.getenv("GOOGLE_CLOUD_TTS_API_KEY")
GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# SAPI stream mode: create for write.
_SSFM_CREATE_FOR_WRITE = 3

# One reply at a time: a second reply queues behind the first instead of the
# two talking over each other.
_speaking = threading.Lock()


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


def candidates(preferred: str | None = None) -> list[str]:
    """Usable providers, the preferred one first, then the rest in ORDER."""
    ready = available()
    first = (preferred or DEFAULT_PROVIDER).lower()
    ordered = [first] + [p for p in ORDER if p != first]
    return [p for p in ordered if ready.get(p)]


def active_provider() -> str | None:
    found = candidates()
    return found[0] if found else None


def _voice_for(provider: str, voice: str | None) -> str | None:
    """A voice name only means something to the provider it belongs to."""
    if voice:
        return voice
    if provider == "google":
        return DEFAULT_GOOGLE_VOICE
    if provider == "edge":
        # PARADOX_TTS_VOICE is honoured here only when it is an Edge voice
        # name ("...Neural"); a Google name would make Edge fail.
        if _CONFIGURED_VOICE and _CONFIGURED_VOICE.endswith("Neural"):
            return _CONFIGURED_VOICE
        return DEFAULT_EDGE_VOICE
    return _CONFIGURED_VOICE


def voices(provider: str | None = None) -> list[str]:
    provider = provider or active_provider() or DEFAULT_PROVIDER
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
            # hardcoded to English, so a non-English voice (e.g.
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


def speak(text: str, provider: str | None = None, voice: str | None = None,
          blocking: bool = False, on_done: Callable[[], None] | None = None) -> None:
    """Say something out loud on this machine's speakers.

    `on_done` fires once playback has actually finished, whichever provider
    ended up speaking — accurate enough to gate always-listening on, so the
    agent does not hear (and act on) its own reply.
    """
    if not text.strip():
        if on_done:
            on_done()
        return

    def run() -> None:
        try:
            with _speaking:
                _speak_now(text, provider, voice)
        except Exception:  # noqa: BLE001 - logged; a reply must never crash the agent
            log.warning("could not speak the reply", exc_info=True)
        finally:
            if on_done:
                on_done()

    if blocking:
        run()
    else:
        threading.Thread(target=run, daemon=True, name="paradox-tts").start()


def _speak_now(text: str, provider: str | None, voice: str | None) -> None:
    tried: list[str] = []
    for name in candidates(provider):
        try:
            if name == "sapi":
                _sapi_speak(text, _voice_for(name, voice if provider == "sapi" else None))
            else:
                path = speak_to_file(text, provider=name,
                                     voice=voice if provider == name else None, fallback=False)
                _play(path)
            log.info("spoke %d chars via %s", len(text), name)
            return
        except Exception as exc:  # noqa: BLE001
            tried.append(f"{name}: {exc}")
            log.info("tts provider %s failed, trying the next: %s", name, exc)
    raise RuntimeError("no speech engine could speak: " + "; ".join(tried) if tried
                       else "no speech engine is available")


def _sapi_speak(text: str, voice: str | None) -> None:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        engine = win32com.client.Dispatch("SAPI.SpVoice")
        _select_sapi_voice(engine, voice)
        engine.Speak(text)
    finally:
        pythoncom.CoUninitialize()


def _new_path(suffix: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        old = sorted(OUT_DIR.glob("paradox-*"), key=lambda p: p.stat().st_mtime)
        for stale in old[:-KEEP_FILES]:
            stale.unlink(missing_ok=True)
    except OSError:
        pass
    stamp = time.strftime("%Y%m%d-%H%M%S")
    # The stamp alone collided when two replies landed in the same second —
    # the second render overwrote the first while it was still playing.
    return OUT_DIR / f"paradox-{stamp}-{uuid.uuid4().hex[:6]}{suffix}"


def speak_to_file(text: str, path: Path | None = None, provider: str | None = None,
                  voice: str | None = None, fallback: bool = True) -> Path:
    """Render speech to an audio file and return its path.

    With `fallback`, a provider that is not configured or fails is skipped for
    the next usable one rather than failing the whole render.
    """
    if not text.strip():
        raise ValueError("nothing to say")

    order = candidates(provider) if fallback else [provider or DEFAULT_PROVIDER]
    if not order:
        raise RuntimeError("no speech engine is available on this machine")

    errors: list[str] = []
    for name in order:
        try:
            return _render(text, path, name, voice if (provider in (None, name)) else None)
        except Exception as exc:  # noqa: BLE001
            if not fallback:
                raise
            errors.append(f"{name}: {exc}")
            log.info("tts provider %s could not render, trying the next: %s", name, exc)
    raise RuntimeError("could not render speech — " + "; ".join(errors))


def _render(text: str, path: Path | None, provider: str, voice: str | None) -> Path:
    voice = _voice_for(provider, voice)

    if provider == "google":
        from google.cloud import texttospeech

        client = _google_client()
        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(
                language_code=_voice_language(voice), name=voice,
            ),
            # LINEAR16 comes back as a complete .wav (Google adds the header)
            # — playable immediately, and its playback can be waited on.
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.LINEAR16,
            ),
        )
        target = path or _new_path(".wav")
        target.write_bytes(response.audio_content)
        return target

    if provider == "edge":
        import edge_tts

        target = path or _new_path(".mp3")

        async def render() -> None:
            speech = edge_tts.Communicate(text, voice)
            await speech.save(str(target))

        asyncio.run(render())
        if not target.exists() or target.stat().st_size == 0:
            raise RuntimeError("Edge returned no audio")
        return target

    if provider != "sapi":
        raise ValueError(f"unknown speech provider {provider!r}")

    # SAPI writes wav.
    import pythoncom
    import win32com.client

    target = path or _new_path(".wav")
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
    """Play an audio file to the end, without opening a window.

    `.wav` goes through winsound; `.mp3` through the Windows MCI player, which
    blocks until playback ends — handing it to the default app instead used
    to open a media player window and return at once, so nothing could tell
    when the reply had finished.
    """
    if path.suffix.lower() == ".wav":
        import winsound

        winsound.PlaySound(str(path), winsound.SND_FILENAME)
        return

    mci = ctypes.windll.winmm.mciSendStringW
    alias = f"pdx{uuid.uuid4().hex[:8]}"
    error = mci(f'open "{path}" type mpegvideo alias {alias}', None, 0, 0)
    if error:
        raise RuntimeError(f"Windows could not open {path.name} for playback (MCI {error})")
    try:
        error = mci(f"play {alias} wait", None, 0, 0)
        if error:
            raise RuntimeError(f"Windows could not play {path.name} (MCI {error})")
    finally:
        mci(f"close {alias}", None, 0, 0)


def info() -> dict[str, object]:
    return {
        "providers": available(),
        "default": DEFAULT_PROVIDER,
        "active": active_provider(),
        "voices": voices()[:8],
    }
