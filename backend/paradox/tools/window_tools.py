"""Launching applications and moving windows around."""

from __future__ import annotations

import time

from ..computer import files, win
from .registry import Tool, ToolResult, schema, string


def launch_app(name: str) -> ToolResult:
    before = {w.hwnd for w in win.list_windows()}
    try:
        what = files.launch(name)
    except FileNotFoundError as exc:
        return ToolResult.fail(str(exc), label=f"Could not find {name}")

    # Verify: wait for a new window, or for an existing one to come forward.
    appeared = None
    for _ in range(24):
        time.sleep(0.25)
        for window in win.list_windows():
            if window.hwnd not in before and window.title:
                appeared = window
                break
        if appeared:
            break

    if appeared:
        return ToolResult(
            ok=True,
            summary=f"{what}. New window: {appeared.title!r} ({appeared.process}).",
            evidence=f"window opened: {appeared.title or appeared.process}",
            label=f"Opened {appeared.title or name}",
            observation={"activeWindow": appeared.title or appeared.process, "method": "uia"},
        )

    existing = win.find_windows(name)
    if existing:
        return ToolResult(
            ok=True,
            summary=f"{what}. It was already running: {existing[0].title!r}.",
            evidence=f"already open: {existing[0].title}",
            label=f"Found {name} already open",
        )

    return ToolResult(
        ok=False,
        summary=f"{what}, but no window appeared within 6 seconds. "
                "It may still be starting, or it may have failed. Observe the screen to check.",
        evidence="no window appeared within 6s",
        label=f"Launched {name} — no window yet",
    )


def list_windows() -> ToolResult:
    windows = win.list_windows()
    if not windows:
        return ToolResult(ok=True, summary="no visible windows", evidence="0 windows open")
    listing = "\n".join(f"- {w.describe()}" for w in windows[:40])
    active = win.active_window()
    return ToolResult(
        ok=True,
        summary=f"{len(windows)} open windows:\n{listing}\n\n"
                f"Foreground: {active.title if active else 'unknown'!r}",
        evidence=f"{len(windows)} windows open",
        label="Listed open windows",
    )


def focus_window(window: str) -> ToolResult:
    matches = win.find_windows(window)
    if not matches:
        return ToolResult.fail(
            f"no open window matches {window!r}. Use list_windows to see what is open, "
            "or launch_app if it is not running.",
            label=f"No window matching {window!r}",
        )

    target = matches[0]
    ok = win.focus_window(target.hwnd)
    active = win.active_window()
    if ok or (active and active.hwnd == target.hwnd):
        return ToolResult(
            ok=True,
            summary=f"{target.title!r} is now in the foreground.",
            evidence=f"foreground: {target.title or target.process}",
            label=f"Switched to {target.title or target.process}",
            observation={"activeWindow": target.title or target.process, "method": "uia"},
        )

    return ToolResult(
        ok=False,
        summary=f"could not bring {target.title!r} forward; the foreground is still "
                f"{active.title if active else 'unknown'!r}. Windows blocks focus stealing "
                "in some states — try again, or ask the user to click the window.",
        evidence=f"focus refused; still on {active.title if active else 'unknown'}",
        label=f"Could not focus {target.title or window}",
    )


def window_action(window: str, action: str) -> ToolResult:
    matches = win.find_windows(window)
    if not matches:
        return ToolResult.fail(f"no open window matches {window!r}", label=f"No window matching {window!r}")

    target = matches[0]
    title = target.title or target.process
    win.window_action(target.hwnd, action)
    time.sleep(0.4)

    if action == "close":
        gone = not win.window_exists(target.hwnd)
        return ToolResult(
            ok=gone,
            summary=f"{title!r} " + ("is closed." if gone else
                                     "did not close — it may be asking to save something. "
                                     "Observe the screen."),
            evidence="window closed" if gone else "still open after close",
            label=f"Closed {title}" if gone else f"{title} did not close",
        )

    state = win._state(target.hwnd) if win.window_exists(target.hwnd) else "gone"
    return ToolResult(
        ok=True,
        summary=f"{title!r} is now {state}.",
        evidence=f"{title}: {state}",
        label=f"{action.capitalize()}d {title}",
    )


TOOLS = [
    Tool(
        name="launch_app",
        description=(
            "Open an application, file, folder or URL. Accepts a Start-menu name "
            "('WhatsApp', 'Spotify', 'Notepad'), an executable, a full path, or an http(s) URL. "
            "Waits for the window and reports what actually appeared."
        ),
        schema=schema({"name": string("App name, path, or URL to open.")}, ["name"]),
        handler=launch_app,
        category="open_apps",
        label=lambda a: f"Opening {a.get('name')}",
    ),
    Tool(
        name="list_windows",
        description="List open windows with their titles, processes and state. Cheap; use it to orient.",
        schema=schema({}),
        handler=list_windows,
        category="read_screen",
        label=lambda a: "Checking what is open",
    ),
    Tool(
        name="focus_window",
        description=(
            "Bring a window to the foreground by title or process name. Always focus a window "
            "before typing into it — keystrokes go to whatever has focus."
        ),
        schema=schema({"window": string("Part of the window title or the process name.")}, ["window"]),
        handler=focus_window,
        category="open_apps",
        label=lambda a: f"Switching to {a.get('window')}",
    ),
    Tool(
        name="window_action",
        description="Minimize, maximize, restore or close a window.",
        schema=schema({
            "window": string("Part of the window title or the process name."),
            "action": string("What to do.", ["minimize", "maximize", "restore", "close"]),
        }, ["window", "action"]),
        handler=window_action,
        category=lambda a: "open_apps" if a.get("action") != "close" else "open_apps",
        label=lambda a: f"{a.get('action', 'changing').capitalize()} {a.get('window')}",
    ),
]
