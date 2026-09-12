"""Speech to text, locally.

Whisper runs on this machine — the audio never leaves it, which matters for a
microphone that is one keypress away.

The model itself lives in a separate process (`whisper_worker`). CTranslate2
takes the interpreter down when its model is loaded from a background thread
alongside a running asyncio server, and the agent always transcribes off the
main thread, so isolation is not optional here. The worker is kept warm between
phrases and restarted if it dies.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

MODEL_NAME = os.getenv("PARADOX_STT_MODEL", "base")
AUDIO_DIR = Path(os.getenv("TEMP", tempfile.gettempdir())) / "paradox" / "audio"
STARTUP_TIMEOUT = 180.0  # the first run downloads the model
REQUEST_TIMEOUT = 120.0

_worker: subprocess.Popen[str] | None = None
_lock = threading.Lock()


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


@dataclass
class Transcript:
    text: str
    language: str
    duration: float
    seconds_of_audio: float

    def describe(self) -> str:
        return f"{self.text!r} ({self.language}, {self.seconds_of_audio:.1f}s audio)"


def _spawn() -> subprocess.Popen[str]:
    process = subprocess.Popen(
        [sys.executable, "-m", "paradox.voice.whisper_worker", MODEL_NAME],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        cwd=str(Path(__file__).resolve().parents[2]),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    deadline = time.time() + STARTUP_TIMEOUT
    while time.time() < deadline:
        line = process.stdout.readline() if process.stdout else ""
        if not line:
            if process.poll() is not None:
                raise RuntimeError("the speech worker exited while starting up")
            continue
        try:
            hello = json.loads(line)
        except json.JSONDecodeError:
            continue
        if hello.get("ready"):
            return process
        raise RuntimeError(f"the speech worker could not start: {hello.get('error')}")

    process.kill()
    raise RuntimeError("the speech worker did not become ready in time")


def _ensure_worker() -> subprocess.Popen[str]:
    global _worker
    if _worker is None or _worker.poll() is not None:
        _worker = _spawn()
    return _worker


def transcribe_file(path: Path) -> Transcript:
    if not available():
        raise RuntimeError(
            "faster-whisper is not installed in the agent's environment, so nothing can be "
            "transcribed."
        )

    started = time.time()
    with _lock:
        worker = _ensure_worker()
        assert worker.stdin and worker.stdout
        try:
            worker.stdin.write(json.dumps({"path": str(path)}) + "\n")
            worker.stdin.flush()
            line = worker.stdout.readline()
        except (BrokenPipeError, OSError) as exc:
            _reset()
            raise RuntimeError(f"the speech worker stopped responding: {exc}") from exc

    if not line:
        _reset()
        raise RuntimeError("the speech worker returned nothing")

    result = json.loads(line)
    if "error" in result:
        raise RuntimeError(result["error"])

    return Transcript(
        text=result.get("text", ""),
        language=result.get("language", ""),
        duration=time.time() - started,
        seconds_of_audio=float(result.get("seconds", 0.0)),
    )


def _reset() -> None:
    global _worker
    if _worker is not None:
        try:
            _worker.kill()
        except Exception:
            pass
    _worker = None


def transcribe_chunks(chunks: list[str], suffix: str = ".webm") -> Transcript:
    """Transcribe base64 audio captured by the browser's MediaRecorder."""
    if not chunks:
        raise ValueError("no audio was captured")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    target = AUDIO_DIR / f"take-{time.strftime('%Y%m%d-%H%M%S')}{suffix}"

    with open(target, "wb") as handle:
        for chunk in chunks:
            handle.write(base64.b64decode(chunk))

    if target.stat().st_size < 2000:
        raise ValueError("the recording was too short to transcribe")

    return transcribe_file(target)


def warm_up() -> None:
    """Start the worker ahead of time so the first phrase is not slow."""
    if not available():
        return

    def run() -> None:
        try:
            with _lock:
                _ensure_worker()
        except Exception:  # noqa: BLE001 - warm-up is best effort
            pass

    threading.Thread(target=run, daemon=True).start()


def shutdown() -> None:
    with _lock:
        _reset()


def info() -> dict[str, object]:
    return {
        "available": available(),
        "model": MODEL_NAME,
        "worker": bool(_worker and _worker.poll() is None),
    }
