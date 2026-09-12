"""Speech to text via Google Cloud Speech-to-Text.

The microphone is one keypress away, so the pipeline is: the browser captures
audio, this process streams it to Google's Speech-to-Text API as it arrives,
and Google's transcription streams back — the same shape as before (chunks
in, a `Transcript` out), but recognition now runs while the user is still
talking instead of only starting once the recording is over, and it does not
depend on how well a small local model handles a given accent.

Credentials stay server-side only:
* `GOOGLE_CLOUD_API_KEY` — simplest: a Cloud API key with the Speech-to-Text
  API enabled, pasted into backend/.env.
* `GOOGLE_APPLICATION_CREDENTIALS` — a service-account JSON key's path, if
  that is what your Google Cloud project uses instead.
Either way, this is the only place they are read; the frontend never sees them.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from dataclasses import dataclass
from typing import Iterator

log = logging.getLogger(__name__)

# BCP-47 language code. "en-US" by default; set to the language actually
# spoken, or see `alternative_language_codes` below for a fixed short list.
LANGUAGE = os.getenv("PARADOX_STT_LANGUAGE", "en-US")
# Google's long-form conversational model: handles pauses, filler words and
# continuous speech far better than the short-command model.
MODEL = os.getenv("PARADOX_STT_MODEL", "latest_long")

API_KEY = os.getenv("GOOGLE_CLOUD_API_KEY") or os.getenv("GOOGLE_CLOUD_SPEECH_API_KEY")
CREDENTIALS_FILE = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# A Google streaming session tops out at 5 minutes server-side; this is a
# ceiling for one spoken utterance, not something normal use should hit.
FINISH_TIMEOUT = 45.0


def available() -> bool:
    try:
        from google.cloud import speech  # noqa: F401
    except Exception:
        return False
    return bool(API_KEY or CREDENTIALS_FILE)


def _client():
    from google.cloud import speech

    if API_KEY:
        from google.api_core.client_options import ClientOptions

        return speech.SpeechClient(client_options=ClientOptions(api_key=API_KEY))
    # Falls back to GOOGLE_APPLICATION_CREDENTIALS / whatever ADC finds.
    return speech.SpeechClient()


@dataclass
class Transcript:
    text: str
    language: str
    duration: float
    seconds_of_audio: float

    def describe(self) -> str:
        return f"{self.text!r} ({self.language}, {self.seconds_of_audio:.1f}s audio)"


class StreamingSession:
    """One spoken utterance, fed to Google chunk by chunk as it is captured.

    Created on `voice.start`, fed on every `voice.audio`, finished on
    `voice.stop`. Recognition runs on a worker thread for the whole life of
    the session — the official client's streaming call is a blocking
    generator-in, iterator-out call, not natively async.
    """

    def __init__(self) -> None:
        self._queue: "queue.Queue[bytes | None]" = queue.Queue()
        self._pieces: list[str] = []
        self._bytes_in = 0
        self._error: Exception | None = None
        self._started = time.time()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def push(self, chunk: bytes) -> None:
        self._bytes_in += len(chunk)
        self._queue.put(chunk)

    def _requests(self) -> Iterator[object]:
        from google.cloud import speech

        while True:
            chunk = self._queue.get()
            if chunk is None:
                return
            yield speech.StreamingRecognizeRequest(audio_content=chunk)

    def _run(self) -> None:
        from google.cloud import speech

        config = speech.RecognitionConfig(
            # Matches the browser's MediaRecorder output exactly — see
            # useMic.ts / useWakeWord.ts, which pin this same container.
            encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            sample_rate_hertz=48000,
            language_code=LANGUAGE,
            model=MODEL,
            enable_automatic_punctuation=True,
        )
        streaming_config = speech.StreamingRecognitionConfig(config=config)

        try:
            client = _client()
            responses = client.streaming_recognize(streaming_config, self._requests())
            for response in responses:
                for result in response.results:
                    if result.is_final and result.alternatives:
                        self._pieces.append(result.alternatives[0].transcript.strip())
        except Exception as exc:  # noqa: BLE001 - surfaced by finish()
            self._error = exc

    def finish(self) -> Transcript:
        """Signal end-of-audio and collect whatever Google finished with."""
        self._queue.put(None)
        self._thread.join(FINISH_TIMEOUT)
        if self._thread.is_alive():
            raise RuntimeError("Google Speech-to-Text did not finish in time")
        if self._error is not None:
            raise RuntimeError(f"Google Speech-to-Text failed: {self._error}")

        text = " ".join(piece for piece in self._pieces if piece).strip()
        # WebM/Opus at a typical ~24kbit/s voice bitrate — a rough estimate
        # for the log line and the wake-word check; nothing depends on it
        # being exact.
        seconds = self._bytes_in / 3000
        return Transcript(
            text=text,
            language=LANGUAGE,
            duration=time.time() - self._started,
            seconds_of_audio=seconds,
        )


def warm_up() -> None:
    """Open a client ahead of time so the first phrase is not slow.

    There is no local model to load — this just gets the gRPC channel and
    any credential lookup out of the way before the user's first request.
    """
    if not available():
        return

    def run() -> None:
        try:
            _client()
        except Exception:  # noqa: BLE001 - warm-up is best effort
            log.debug("Google Speech-to-Text warm-up failed", exc_info=True)

    threading.Thread(target=run, daemon=True).start()


def shutdown() -> None:
    """Nothing to tear down — kept for interface parity with the caller."""


def info() -> dict[str, object]:
    return {
        "available": available(),
        "provider": "google",
        "model": MODEL,
        "language": LANGUAGE,
    }
