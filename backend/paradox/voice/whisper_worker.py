"""Whisper, in a process of its own.

faster-whisper's native library (CTranslate2) crashes the interpreter when its
model is loaded from a background thread while an asyncio server is running —
no exception, no traceback, the process simply goes away. The agent transcribes
from a worker thread, so the model cannot live in the agent process.

Here it loads on this process's main thread, where it is well behaved, and
answers one JSON request per line on stdin:

    {"path": "C:/.../take.webm"}   ->   {"text": "...", "language": "en", ...}
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    model_name = sys.argv[1] if len(sys.argv) > 1 else "base"

    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(model_name, device="cpu", compute_type="int8")
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ready": False, "error": str(exc)}), flush=True)
        return 1

    print(json.dumps({"ready": True, "model": model_name}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            segments, info = model.transcribe(request["path"], beam_size=1, vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            print(
                json.dumps({
                    "text": text,
                    "language": getattr(info, "language", "") or "",
                    "seconds": float(getattr(info, "duration", 0.0) or 0.0),
                }),
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001 - one bad request must not end the worker
            print(json.dumps({"error": str(exc)}), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
