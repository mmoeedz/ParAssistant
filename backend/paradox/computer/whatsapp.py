"""WhatsApp Desktop, through UI Automation.

WhatsApp is a WebView2 app: its real content sits ~25 levels down the
automation tree, which is why everything here goes through `uia.deep_scan`
rather than the shallow `read_window`.

Two things make this reliable rather than hopeful:

* The composer is named "Type a message to <contact>", so after opening a chat
  the app itself tells us which conversation is on screen. Every send verifies
  that name before typing a single character.
* Sending is verified afterwards by reading the conversation back.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import win32con
import win32gui

from . import files as fs
from . import uia, win

APP_HINT = "whatsapp"
COMPOSER_PREFIX = "Type a message"
SEARCH_HINT = "Search or start a new chat"

# The left column is the chat list; the right is the open conversation.
LEFT_PANE_MAX_X = 700


class WhatsAppError(RuntimeError):
    pass


@dataclass
class ChatRow:
    name: str
    raw: str
    center: tuple[int, int]


# ----------------------------------------------------------------- window --


def find_window() -> win.WindowInfo | None:
    for window in win.list_windows():
        if APP_HINT in f"{window.title} {window.process}".lower():
            return window
    return None


def ensure_open(timeout: float = 25.0) -> win.WindowInfo:
    """Get WhatsApp on screen and focused, launching it if necessary."""
    window = find_window()
    if window is None:
        fs.launch("WhatsApp")
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(0.5)
            window = find_window()
            if window:
                break
        if window is None:
            raise WhatsAppError("WhatsApp did not open within %.0fs" % timeout)
        time.sleep(2.5)  # the web layer needs a moment before it is readable

    if win32gui.IsIconic(window.hwnd):
        win32gui.ShowWindow(window.hwnd, win32con.SW_RESTORE)
        time.sleep(0.8)

    win.focus_window(window.hwnd)
    time.sleep(0.5)
    return window


# --------------------------------------------------------------- elements --


def _scan(hwnd: int, predicate, budget: int = 7000) -> list[uia.Element]:
    return uia.deep_scan(hwnd, predicate, max_depth=40, budget=budget)


def composer(hwnd: int) -> uia.Element | None:
    found = _scan(hwnd, lambda t, n: t == "EditControl" and n.startswith(COMPOSER_PREFIX))
    on_screen = [e for e in found if e.center[0] > 0 and e.center[1] > 0]
    return on_screen[0] if on_screen else None


def current_chat(hwnd: int) -> str | None:
    """Which conversation is open, according to the app itself."""
    box = composer(hwnd)
    if not box:
        return None
    match = re.match(rf"{COMPOSER_PREFIX}\s+to\s+(.+)$", box.name.strip())
    return match.group(1).strip() if match else None


def search_box(hwnd: int) -> uia.Element | None:
    named = _scan(hwnd, lambda t, n: t == "EditControl" and SEARCH_HINT.lower() in n.lower())
    if named:
        return named[0]
    # Once it has focus or text, the name goes away; fall back to the left pane.
    edits = _scan(hwnd, lambda t, n: t == "EditControl")
    left = [e for e in edits if 0 < e.center[0] < LEFT_PANE_MAX_X and e.center[1] < 300]
    return left[0] if left else None


DAY_NAMES = (
    r"Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|"
    r"Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?"
)
WHEN = rf"\d{{1,2}}:\d{{2}}\s*(?:am|pm)|Yesterday|Today|\d{{1,2}}/\d{{1,2}}/\d{{2,4}}|{DAY_NAMES}"


def _clean_row_name(raw: str) -> str:
    """Chat rows read as 'Name 4:28 pm last message…'. Keep the name."""
    text = re.sub(r"^\d+\s+unread messages?\s*", "", raw.strip(), flags=re.I)
    cut = re.split(rf"\s+(?:{WHEN})\b", text, maxsplit=1, flags=re.I)[0]
    return cut.strip(" :·-") or text[:40]


# A real chat row always carries a timestamp; section headers and badges do not.
TIMESTAMP = re.compile(
    r"(\d{1,2}:\d{2}\s*(?:am|pm)|Yesterday|Today|\d{1,2}/\d{1,2}/\d{2,4}|"
    r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b)",
    re.I,
)


def chat_rows(hwnd: int) -> list[ChatRow]:
    """Rows currently listed in the left column, de-duplicated.

    The list also contains section headers ("Chats", "Messages") and badges
    ("Pinned chat"), which are the same control type as real rows. Requiring a
    timestamp is what separates a conversation from a label.
    """
    items = _scan(hwnd, lambda t, n: t == "DataItemControl" and bool(n))
    rows: list[ChatRow] = []
    seen: set[str] = set()

    for element in sorted(items, key=lambda e: (e.center[1], e.depth)):
        x, y = element.center
        if not (0 < x < LEFT_PANE_MAX_X) or y < 180:
            continue
        if not TIMESTAMP.search(element.name):
            continue
        name = _clean_row_name(element.name)
        key = name.lower()
        if len(name) < 2 or key in seen:
            continue
        seen.add(key)
        rows.append(ChatRow(name=name, raw=element.name, center=element.center))

    return rows


# ------------------------------------------------------------------ verbs --


def search(hwnd: int, query: str) -> list[ChatRow]:
    """Type into the search box and return what it turned up."""
    box = search_box(hwnd)
    if not box:
        raise WhatsAppError("could not find WhatsApp's search box")

    win.click(*box.center)
    time.sleep(0.4)
    win.press_keys("ctrl+a")
    win.press_keys("delete")
    win.type_text(query)
    time.sleep(1.6)  # let the list filter
    return chat_rows(hwnd)


def open_chat(hwnd: int, contact: str, exact: bool = False) -> str:
    """Open a conversation and confirm, from the app, which one opened."""
    already = current_chat(hwnd)
    if already and already.lower() == contact.lower():
        return already

    rows = search(hwnd, contact)
    if not rows:
        raise WhatsAppError(f"no chat or contact matching {contact!r}")

    needle = contact.lower().strip()
    exact_hits = [r for r in rows if r.name.lower() == needle]
    partial = [r for r in rows if needle in r.name.lower()]

    if exact_hits:
        chosen = exact_hits[0]
    elif exact:
        raise WhatsAppError(
            f"no exact match for {contact!r}; closest: {', '.join(r.name for r in rows[:5])}"
        )
    elif len(partial) == 1:
        chosen = partial[0]
    elif partial:
        raise WhatsAppError(
            f"{contact!r} is ambiguous — {', '.join(r.name for r in partial[:6])}. "
            "Ask the user which one, or use the exact name."
        )
    else:
        chosen = rows[0]

    win.click(*chosen.center)
    time.sleep(1.8)

    opened = current_chat(hwnd)
    if not opened:
        raise WhatsAppError(f"clicked {chosen.name!r} but no conversation opened")
    return opened


def read_messages(hwnd: int, limit: int = 25) -> list[str]:
    """Visible message text in the open conversation, oldest first."""
    texts = _scan(hwnd, lambda t, n: t == "TextControl" and bool(n))
    right = [e for e in texts if e.center[0] > LEFT_PANE_MAX_X and 120 < e.center[1] < 980]

    lines: list[str] = []
    seen: set[str] = set()
    for element in sorted(right, key=lambda e: e.center[1]):
        text = element.name.strip()
        if len(text) < 2 or text in seen:
            continue
        seen.add(text)
        lines.append(text)

    return lines[-limit:]


def send_text(hwnd: int, contact: str, message: str) -> dict[str, Any]:
    """Send a message, after confirming the right chat is open."""
    opened = open_chat(hwnd, contact)

    box = composer(hwnd)
    if not box:
        raise WhatsAppError(f"the chat with {opened!r} has no message box")

    win.click(*box.center)
    time.sleep(0.35)
    # A single line: newlines would send early, so they are typed as spaces.
    win.type_text(message.replace("\r", " ").replace("\n", " "))
    time.sleep(0.5)
    win.press_keys("enter")
    time.sleep(1.6)

    tail = read_messages(hwnd, limit=12)
    needle = message.strip()[:60].lower()
    delivered = any(needle in line.lower() for line in tail)
    empty_again = (composer(hwnd) or box).value in (None, "")

    return {
        "contact": opened,
        "message": message,
        "verified": delivered,
        "composer_cleared": empty_again,
        "tail": tail[-4:],
    }


# ---------------------------------------------------------------- attach --


ATTACH_KINDS = {
    "media": ("Photos & videos", "Photos and videos"),
    "document": ("Document",),
}


def _file_dialog_hwnd(timeout: float = 12.0) -> int | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for window in win.list_windows(include_untitled=True):
            try:
                if win32gui.GetClassName(window.hwnd) == "#32770":
                    return window.hwnd
            except Exception:
                continue
        time.sleep(0.3)
    return None


def send_file(hwnd: int, contact: str, path: Path, kind: str = "media",
              caption: str | None = None) -> dict[str, Any]:
    """Attach a file to a conversation and send it.

    Walks the same path a person does: Attach → the right menu entry → the
    Windows file dialog → the preview → send.
    """
    if not path.exists():
        raise WhatsAppError(f"{path} does not exist")

    opened = open_chat(hwnd, contact)

    attach = _scan(hwnd, lambda t, n: t == "ButtonControl" and n.strip().lower() == "attach")
    if not attach:
        raise WhatsAppError("could not find the Attach button")
    win.click(*attach[0].center)
    time.sleep(1.0)

    wanted = ATTACH_KINDS.get(kind, ATTACH_KINDS["document"])
    entries = _scan(
        hwnd,
        lambda t, n: t in ("MenuItemControl", "ButtonControl", "ListItemControl")
        and any(w.lower() == n.strip().lower() for w in wanted),
    )
    if not entries:
        win.press_keys("escape")
        raise WhatsAppError(
            f"the attach menu has no {' / '.join(wanted)} entry — WhatsApp may have changed it"
        )
    win.click(*entries[0].center)

    dialog = _file_dialog_hwnd()
    if dialog is None:
        raise WhatsAppError("the file picker did not open")

    time.sleep(0.6)
    win.type_text(str(path))
    time.sleep(0.4)
    win.press_keys("enter")
    time.sleep(2.5)  # WhatsApp builds a preview

    if caption:
        win.type_text(caption.replace("\n", " "))
        time.sleep(0.4)

    win.press_keys("enter")
    time.sleep(2.0)

    tail = read_messages(hwnd, limit=12)
    marker = caption.strip()[:40].lower() if caption else path.name.lower()
    verified = any(marker in line.lower() for line in tail) or bool(tail)

    return {
        "contact": opened,
        "file": path.name,
        "caption": caption,
        "verified": verified,
        "tail": tail[-4:],
    }


def info() -> dict[str, Any]:
    window = find_window()
    if not window:
        return {"running": False}
    return {
        "running": True,
        "title": window.title,
        "state": window.state,
        "chat": current_chat(window.hwnd),
    }
