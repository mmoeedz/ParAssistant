"""Read-only check that the Windows layer really works on this machine.

Runs no input, launches nothing, changes nothing. Use it to confirm the agent
can see the computer before you let it act on one.

    .venv/Scripts/python.exe selftest.py
"""

from __future__ import annotations

import sys
import time

from paradox import memory
from paradox.computer import files as fs
from paradox.computer import browser, ocr, uia, win
from paradox.voice import stt, tts

PASS, FAIL = "  ok  ", " FAIL "


def check(name: str, fn):
    start = time.time()
    try:
        detail = fn()
        print(f"[{PASS}] {name:<22} {detail}  ({time.time() - start:.2f}s)")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[{FAIL}] {name:<22} {type(exc).__name__}: {exc}")
        return False


def main() -> int:
    print("Paradox self-test — read-only\n")
    results = []

    results.append(check("screen size", lambda: f"{win.screen_size()[0]}x{win.screen_size()[1]}"))
    results.append(check("window list", lambda: f"{len(win.list_windows())} visible windows"))

    def active():
        w = win.active_window()
        return f"{w.title[:40]!r} ({w.process})" if w else "none"

    results.append(check("active window", active))

    def uia_read():
        if not uia.AVAILABLE:
            raise RuntimeError("uiautomation is not importable")
        w = win.active_window()
        if not w:
            return "no active window to read"
        elements = uia.read_window(w.hwnd, max_depth=4, max_nodes=40)
        return f"{len(elements)} controls in {w.process}"

    results.append(check("UI Automation", uia_read))

    def capture():
        img, data_url = win.capture()
        return f"{img.width}x{img.height}, {len(data_url) // 1024} KB base64"

    results.append(check("screen capture", capture))
    results.append(check("start menu apps", lambda: f"{len(fs.start_apps())} entries"))
    results.append(check("recent files", lambda: f"{len(fs.recent_files())} in the last 72h"))
    results.append(check("clipboard read", lambda: f"{len(fs.read_clipboard())} chars"))
    results.append(check("explorer selection",
                         lambda: f"{len(fs.explorer_selection())} files selected"))

    def cursor():
        x, y = win.cursor_pos()
        return f"at {x},{y}"

    results.append(check("cursor position", cursor))

    def match():
        found = fs.match_app("notepad")
        return f"'notepad' -> {found[0][0]!r}" if found else "'notepad' not found"

    results.append(check("app resolution", match))

    print()

    def ocr_check():
        if not ocr.AVAILABLE:
            raise RuntimeError("Windows OCR is not available")
        img, _ = win.capture()
        result = ocr.read_image(img, scale=img.width / win.screen_size()[0])
        return f"{len(result.lines)} lines of text read"

    results.append(check("windows OCR", ocr_check))

    def browser_check():
        return "a debuggable browser is attached" if browser.is_attached() else (
            "no debug browser running (NEXUS starts one on demand)"
        )

    results.append(check("browser (CDP)", browser_check))

    def whatsapp_check():
        from paradox.computer import whatsapp

        state = whatsapp.info()
        return "running" if state.get("running") else "not running (NEXUS starts it on demand)"

    results.append(check("whatsapp", whatsapp_check))

    def tts_check():
        engines = [name for name, ok in tts.available().items() if ok]
        if not engines:
            raise RuntimeError("no speech engine")
        return f"{', '.join(engines)}"

    results.append(check("text to speech", tts_check))
    results.append(check("speech to text",
                         lambda: f"faster-whisper {stt.MODEL_NAME}" if stt.available()
                         else (_ for _ in ()).throw(RuntimeError("not installed"))))

    def memory_check():
        stats = memory.stats()
        return f"{stats['facts']} facts, {stats['tasks']} tasks"

    results.append(check("memory store", memory_check))

    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
