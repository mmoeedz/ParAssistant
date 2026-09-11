"""OCR through the Windows engine.

Uses Windows.Media.Ocr, which ships with Windows 10/11 — no Tesseract binary,
no model download, no network. This is the cheap path for reading text that UI
Automation does not expose: canvas apps, images, PDFs in a viewer, video.

Vision (sending the screenshot to the model) stays the last resort.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from PIL import Image

try:
    import winocr

    AVAILABLE = True
except Exception:  # pragma: no cover - non-Windows or missing WinRT
    winocr = None  # type: ignore[assignment]
    AVAILABLE = False


@dataclass
class Line:
    text: str
    x: int
    y: int
    width: int
    height: int

    @property
    def center(self) -> tuple[int, int]:
        return self.x + self.width // 2, self.y + self.height // 2

    def describe(self) -> str:
        return f'"{self.text}" at {self.center[0]},{self.center[1]}'


@dataclass
class OcrResult:
    text: str
    lines: list[Line]

    def summarize(self, limit: int = 60) -> str:
        if not self.lines:
            return "no text found on screen"
        out = [f"- {line.describe()}" for line in self.lines[:limit]]
        if len(self.lines) > limit:
            out.append(f"- … and {len(self.lines) - limit} more lines")
        return "\n".join(out)


def read_image(image: Image.Image, offset: tuple[int, int] = (0, 0),
               scale: float = 1.0, language: str = "en") -> OcrResult:
    """Recognise text in a PIL image, mapping boxes back to screen coordinates.

    `offset` and `scale` translate image space to screen space, so the model can
    click what OCR found.
    """
    if not AVAILABLE:
        raise RuntimeError("Windows OCR is not available in this environment")

    result = winocr.recognize_pil_sync(image.convert("RGB"), language)

    # winocr returns plain dicts; tolerate objects in case that changes.
    def field(obj: Any, name: str, default: Any = None) -> Any:
        if isinstance(obj, dict):
            return obj.get(name, default)
        return getattr(obj, name, default)

    lines: list[Line] = []
    for line in field(result, "lines", []) or []:
        words = list(field(line, "words", []) or [])
        boxes = [field(w, "bounding_rect", {}) for w in words]
        boxes = [b for b in boxes if b]
        if not boxes:
            continue
        left = min(float(field(b, "x", 0)) for b in boxes)
        top = min(float(field(b, "y", 0)) for b in boxes)
        right = max(float(field(b, "x", 0)) + float(field(b, "width", 0)) for b in boxes)
        bottom = max(float(field(b, "y", 0)) + float(field(b, "height", 0)) for b in boxes)
        lines.append(
            Line(
                text=str(field(line, "text", "")),
                x=int(left / scale) + offset[0],
                y=int(top / scale) + offset[1],
                width=int((right - left) / scale),
                height=int((bottom - top) / scale),
            )
        )

    return OcrResult(text=str(field(result, "text", "") or ""), lines=lines)


def find_text(result: OcrResult, needle: str) -> list[Line]:
    query = needle.strip().lower()
    return [line for line in result.lines if query in line.text.lower()]


def languages() -> list[str]:
    """Which OCR languages this Windows install actually has."""
    if not AVAILABLE:
        return []
    try:
        return [lang.language_tag for lang in winocr.OcrEngine.get_available_recognizer_languages()]
    except Exception:
        return []


def info() -> dict[str, Any]:
    return {"available": AVAILABLE, "languages": languages()}
