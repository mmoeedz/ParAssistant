"""Windows primitives: windows, input, screen.

Input goes through SendInput directly rather than a wrapper library, so that
Unicode typing and modifier handling behave the same in every application.
Everything here is blocking; callers run it in a thread.
"""

from __future__ import annotations

import base64
import ctypes
import io
import time
from ctypes import wintypes
from dataclasses import dataclass, asdict
from typing import Any, Literal

import psutil
import win32con
import win32gui
import win32process
from PIL import Image

user32 = ctypes.WinDLL("user32", use_last_error=True)

# ------------------------------------------------------------------ input --

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_SCANCODE = 0x0008

MOUSEEVENTF = {
    "move": 0x0001,
    "absolute": 0x8000,
    "left_down": 0x0002,
    "left_up": 0x0004,
    "right_down": 0x0008,
    "right_up": 0x0010,
    "middle_down": 0x0020,
    "middle_up": 0x0040,
    "wheel": 0x0800,
    "hwheel": 0x01000,
}

VK = {
    "enter": 0x0D, "return": 0x0D, "tab": 0x09, "esc": 0x1B, "escape": 0x1B,
    "space": 0x20, "backspace": 0x08, "delete": 0x2E, "del": 0x2E, "insert": 0x2D,
    "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12,
    "win": 0x5B, "windows": 0x5B, "cmd": 0x5B, "meta": 0x5B,
    "capslock": 0x14, "printscreen": 0x2C, "apps": 0x5D, "menu": 0x5D,
    "volume_mute": 0xAD, "volume_down": 0xAE, "volume_up": 0xAF,
    "media_next": 0xB0, "media_prev": 0xB1, "media_stop": 0xB2, "media_play": 0xB3,
    "browser_back": 0xA6, "browser_forward": 0xA7, "browser_refresh": 0xA8,
}
for _i in range(1, 25):
    VK[f"f{_i}"] = 0x6F + _i
for _c in "abcdefghijklmnopqrstuvwxyz":
    VK[_c] = ord(_c.upper())
for _d in "0123456789":
    VK[_d] = ord(_d)

MODIFIERS = {"ctrl", "control", "shift", "alt", "win", "windows", "cmd", "meta"}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG), ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _INPUTunion(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTunion)]


def _send(*inputs: INPUT) -> None:
    array = (INPUT * len(inputs))(*inputs)
    sent = user32.SendInput(len(inputs), array, ctypes.sizeof(INPUT))
    if sent != len(inputs):
        raise OSError(f"SendInput sent {sent}/{len(inputs)} events "
                      f"(error {ctypes.get_last_error()}). A window may be running as admin.")


def _key_input(vk: int, up: bool = False) -> INPUT:
    return INPUT(type=INPUT_KEYBOARD,
                 ki=KEYBDINPUT(wVk=vk, wScan=0, dwFlags=KEYEVENTF_KEYUP if up else 0,
                               time=0, dwExtraInfo=None))


def _unicode_input(ch: str, up: bool = False) -> INPUT:
    flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0)
    return INPUT(type=INPUT_KEYBOARD,
                 ki=KEYBDINPUT(wVk=0, wScan=ord(ch), dwFlags=flags, time=0, dwExtraInfo=None))


def screen_size() -> tuple[int, int]:
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def type_text(text: str, per_char_delay: float = 0.004) -> None:
    """Type literal text, including emoji and non-ASCII, via Unicode events."""
    for ch in text:
        if ch == "\n":
            _send(_key_input(VK["enter"]), _key_input(VK["enter"], up=True))
        else:
            for unit in ch.encode("utf-16-le").decode("utf-16-le"):
                _send(_unicode_input(unit), _unicode_input(unit, up=True))
        if per_char_delay:
            time.sleep(per_char_delay)


def press_keys(combo: str) -> None:
    """Press a chord such as 'ctrl+s', 'alt+tab', 'win+r', 'enter'."""
    parts = [p.strip().lower() for p in combo.replace(" ", "").split("+") if p.strip()]
    if not parts:
        raise ValueError("empty key combination")

    unknown = [p for p in parts if p not in VK]
    if unknown:
        raise ValueError(f"unknown key(s): {', '.join(unknown)}")

    mods = [p for p in parts if p in MODIFIERS]
    keys = [p for p in parts if p not in MODIFIERS]

    events: list[INPUT] = [_key_input(VK[m]) for m in mods]
    for k in keys:
        events.append(_key_input(VK[k]))
    for k in reversed(keys):
        events.append(_key_input(VK[k], up=True))
    for m in reversed(mods):
        events.append(_key_input(VK[m], up=True))
    _send(*events)


def move_mouse(x: int, y: int) -> None:
    w, h = screen_size()
    nx = int(x * 65535 / max(w - 1, 1))
    ny = int(y * 65535 / max(h - 1, 1))
    _send(INPUT(type=INPUT_MOUSE,
                mi=MOUSEINPUT(dx=nx, dy=ny, mouseData=0,
                              dwFlags=MOUSEEVENTF["move"] | MOUSEEVENTF["absolute"],
                              time=0, dwExtraInfo=None)))


def _mouse_event(flag: int, data: int = 0) -> INPUT:
    return INPUT(type=INPUT_MOUSE,
                 mi=MOUSEINPUT(dx=0, dy=0, mouseData=data, dwFlags=flag, time=0, dwExtraInfo=None))


def click(x: int | None = None, y: int | None = None,
          button: Literal["left", "right", "middle"] = "left",
          double: bool = False) -> None:
    if x is not None and y is not None:
        move_mouse(x, y)
        time.sleep(0.04)
    down, up = MOUSEEVENTF[f"{button}_down"], MOUSEEVENTF[f"{button}_up"]
    _send(_mouse_event(down), _mouse_event(up))
    if double:
        time.sleep(0.06)
        _send(_mouse_event(down), _mouse_event(up))


def drag(x1: int, y1: int, x2: int, y2: int, steps: int = 24) -> None:
    move_mouse(x1, y1)
    time.sleep(0.05)
    _send(_mouse_event(MOUSEEVENTF["left_down"]))
    for i in range(1, steps + 1):
        move_mouse(int(x1 + (x2 - x1) * i / steps), int(y1 + (y2 - y1) * i / steps))
        time.sleep(0.012)
    _send(_mouse_event(MOUSEEVENTF["left_up"]))


def scroll(amount: int, horizontal: bool = False) -> None:
    """Positive scrolls up / right. One notch is 120."""
    flag = MOUSEEVENTF["hwheel"] if horizontal else MOUSEEVENTF["wheel"]
    _send(_mouse_event(flag, ctypes.c_int32(amount * 120).value))


def cursor_pos() -> tuple[int, int]:
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y


# ---------------------------------------------------------------- windows --


@dataclass
class WindowInfo:
    hwnd: int
    title: str
    process: str
    pid: int
    state: str
    rect: tuple[int, int, int, int]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def describe(self) -> str:
        return f"[{self.hwnd}] {self.title or '(untitled)'} — {self.process} ({self.state})"


def _process_name(hwnd: int) -> tuple[str, int]:
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return psutil.Process(pid).name(), pid
    except Exception:
        return "unknown", 0


def _state(hwnd: int) -> str:
    if win32gui.IsIconic(hwnd):
        return "minimized"
    placement = win32gui.GetWindowPlacement(hwnd)
    return "maximized" if placement[1] == win32con.SW_SHOWMAXIMIZED else "normal"


def _info(hwnd: int) -> WindowInfo:
    name, pid = _process_name(hwnd)
    return WindowInfo(hwnd=hwnd, title=win32gui.GetWindowText(hwnd), process=name,
                      pid=pid, state=_state(hwnd), rect=win32gui.GetWindowRect(hwnd))


def list_windows(include_untitled: bool = False) -> list[WindowInfo]:
    """Visible top-level windows, front-most first."""
    found: list[WindowInfo] = []

    def collect(hwnd: int, _: Any) -> bool:
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd)
        if not title and not include_untitled:
            return True
        # Skip tool windows and the desktop shell layers.
        ex = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
        if ex & win32con.WS_EX_TOOLWINDOW:
            return True
        found.append(_info(hwnd))
        return True

    win32gui.EnumWindows(collect, None)
    return found


def active_window() -> WindowInfo | None:
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd or not win32gui.IsWindow(hwnd):
        return None
    return _info(hwnd)


def find_windows(query: str) -> list[WindowInfo]:
    q = query.lower().strip()
    return [w for w in list_windows()
            if q in w.title.lower() or q in w.process.lower().removesuffix(".exe")]


def focus_window(hwnd: int) -> bool:
    """Bring a window to the foreground and confirm it actually got there."""
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

    try:
        # Windows refuses SetForegroundWindow from a background thread unless
        # the input queues are attached, so attach to the current foreground.
        fg = win32gui.GetForegroundWindow()
        cur_thread = ctypes.windll.kernel32.GetCurrentThreadId()
        fg_thread, _ = win32process.GetWindowThreadProcessId(fg) if fg else (0, 0)
        if fg_thread and fg_thread != cur_thread:
            user32.AttachThreadInput(fg_thread, cur_thread, True)
            try:
                win32gui.SetForegroundWindow(hwnd)
            finally:
                user32.AttachThreadInput(fg_thread, cur_thread, False)
        else:
            win32gui.SetForegroundWindow(hwnd)
    except Exception:
        try:
            win32gui.BringWindowToTop(hwnd)
        except Exception:
            return False

    time.sleep(0.25)
    return win32gui.GetForegroundWindow() == hwnd


def window_action(hwnd: int, action: str) -> None:
    commands = {
        "minimize": win32con.SW_MINIMIZE,
        "maximize": win32con.SW_SHOWMAXIMIZED,
        "restore": win32con.SW_RESTORE,
    }
    if action == "close":
        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
        return
    if action not in commands:
        raise ValueError(f"unknown window action: {action}")
    win32gui.ShowWindow(hwnd, commands[action])


def window_exists(hwnd: int) -> bool:
    return bool(win32gui.IsWindow(hwnd))


# ----------------------------------------------------------------- screen --


def capture(region: tuple[int, int, int, int] | None = None,
            max_width: int = 1400) -> tuple[Image.Image, str]:
    """Grab the screen. Returns the image and a base64 PNG data URL."""
    import mss

    with mss.mss() as sct:
        if region:
            left, top, right, bottom = region
            box = {"left": left, "top": top, "width": right - left, "height": bottom - top}
        else:
            box = sct.monitors[1]
        shot = sct.grab(box)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return img, f"data:image/png;base64,{encoded}"


def volume(action: str, repeat: int = 1) -> None:
    key = {"up": "volume_up", "down": "volume_down", "mute": "volume_mute"}.get(action)
    if not key:
        raise ValueError(f"unknown volume action: {action}")
    for _ in range(max(1, repeat)):
        press_keys(key)
        time.sleep(0.02)


def media(action: str) -> None:
    key = {"play": "media_play", "pause": "media_play", "next": "media_next",
           "previous": "media_prev", "stop": "media_stop"}.get(action)
    if not key:
        raise ValueError(f"unknown media action: {action}")
    press_keys(key)


def lock_workstation() -> None:
    ctypes.windll.user32.LockWorkStation()
