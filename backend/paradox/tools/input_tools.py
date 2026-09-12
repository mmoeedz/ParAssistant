"""Mouse and keyboard.

Raw input is how everything else happens, so it runs freely — but a click on a
button called "Send" or "Delete" is not a neutral click, and is escalated to
the matching permission category.
"""

from __future__ import annotations

import time

from ..computer import uia, win
from .registry import Tool, ToolResult, boolean, integer, schema, string

SEND_WORDS = ("send", "post", "publish", "tweet", "share", "submit", "reply", "forward")
MONEY_WORDS = ("buy", "pay", "order", "checkout", "purchase", "subscribe", "place order")
DESTRUCTIVE_WORDS = ("delete", "remove", "uninstall", "format", "erase", "wipe", "reset")


def click_category(args: dict) -> str:
    """A click is only as safe as the thing it lands on."""
    label = str(args.get("name") or args.get("label") or "").lower()
    if any(w in label for w in MONEY_WORDS):
        return "destructive_ops"
    if any(w in label for w in DESTRUCTIVE_WORDS):
        return "delete_files"
    if any(w in label for w in SEND_WORDS):
        return "send_messages"
    return "input_control"


def _active_title() -> str:
    active = win.active_window()
    return active.title or active.process if active else "unknown"


def click_element(name: str, control: str | None = None, window: str | None = None,
                  double: bool = False) -> ToolResult:
    target = win.find_windows(window)[0] if window and win.find_windows(window) else win.active_window()
    if not target:
        return ToolResult.fail("no window to click in")

    matches = uia.find_elements(target.hwnd, name=name, control=control)
    if not matches:
        return ToolResult.fail(
            f"no control called {name!r} in {target.title!r}. Call read_window to see what exists.",
            label=f"Could not find {name!r}",
        )
    if len(matches) > 1 and matches[0].name.lower() != name.lower():
        listing = ", ".join(f"{m.name!r}" for m in matches[:5])
        return ToolResult.fail(
            f"{name!r} is ambiguous in {target.title!r} — candidates: {listing}. "
            "Use the exact name, or add a control filter.",
            label=f"{name!r} is ambiguous",
        )

    element = matches[0]
    if not element.enabled:
        return ToolResult.fail(f"{element.name!r} is disabled right now",
                               label=f"{element.name!r} is disabled")

    win.focus_window(target.hwnd)
    win.click(*element.center, double=double)
    time.sleep(0.35)

    return ToolResult(
        ok=True,
        summary=f"clicked {element.name!r} ({element.control}) at {element.center}. "
                f"Foreground is now {_active_title()!r}.",
        evidence=f"clicked {element.name or name!r} at {element.center[0]},{element.center[1]}",
        label=f"Clicked {element.name or name!r}",
    )


def click(x: int, y: int, button: str = "left", double: bool = False,
          label: str | None = None) -> ToolResult:
    width, height = win.screen_size()
    if not (0 <= x < width and 0 <= y < height):
        return ToolResult.fail(f"({x}, {y}) is off screen; the screen is {width}x{height}")

    win.click(x, y, button=button, double=double)  # type: ignore[arg-type]
    time.sleep(0.3)
    what = label or f"({x}, {y})"
    return ToolResult(
        ok=True,
        summary=f"{'double-' if double else ''}{button}-clicked {what}. "
                f"Foreground is now {_active_title()!r}.",
        evidence=f"clicked {x},{y}",
        label=f"Clicked {what}",
    )


def type_text(text: str) -> ToolResult:
    focused = uia.focused_element(win.active_window().hwnd) if win.active_window() else None

    if focused and focused.is_password:
        return ToolResult.fail(
            "that is a password field — I do not type credentials. Ask the user to type it.",
            label="Refused to type into a password field",
        )

    # The model occasionally emits a literal backslash + "n" instead of an
    # actual newline character for "press Enter" here (a JSON-escaping slip
    # in its tool call) — since this tool's own contract says \n means Enter,
    # honor it either way rather than typing the two characters literally.
    text = text.replace("\\n", "\n")

    win.type_text(text)
    time.sleep(0.15)

    after = uia.focused_element(win.active_window().hwnd) if win.active_window() else None
    landed = (after.value or "") if after else ""
    verified = text.strip()[-40:] in landed if landed else False

    preview = text if len(text) <= 60 else text[:57] + "…"
    return ToolResult(
        ok=True,
        summary=f"typed {preview!r} into {(after.name if after else 'the focused control')!r}."
                + (" The field now contains it." if verified else
                   " Could not read the field back — verify before relying on it."),
        evidence=(f"field contains the typed text" if verified
                  else f"typed {len(text)} chars into {(after.name if after else 'focused control')}"),
        label=f"Typed {preview!r}",
    )


def press_keys(keys: str, repeat: int = 1) -> ToolResult:
    try:
        for _ in range(max(1, min(repeat, 40))):
            win.press_keys(keys)
            time.sleep(0.05)
    except ValueError as exc:
        return ToolResult.fail(str(exc), label=f"Bad key combination {keys!r}")

    time.sleep(0.2)
    return ToolResult(
        ok=True,
        summary=f"pressed {keys}{f' x{repeat}' if repeat > 1 else ''}. "
                f"Foreground is now {_active_title()!r}.",
        evidence=f"pressed {keys}",
        label=f"Pressed {keys}",
    )


def scroll(amount: int = -3, horizontal: bool = False) -> ToolResult:
    win.scroll(amount, horizontal=horizontal)
    time.sleep(0.25)
    direction = ("right" if amount > 0 else "left") if horizontal else ("up" if amount > 0 else "down")
    return ToolResult(ok=True, summary=f"scrolled {direction} {abs(amount)} notches",
                      evidence=f"scrolled {direction}", label=f"Scrolled {direction}")


def drag(from_x: int, from_y: int, to_x: int, to_y: int) -> ToolResult:
    win.drag(from_x, from_y, to_x, to_y)
    time.sleep(0.3)
    return ToolResult(ok=True,
                      summary=f"dragged from ({from_x}, {from_y}) to ({to_x}, {to_y})",
                      evidence=f"dragged to {to_x},{to_y}", label="Dragged")


def wait(seconds: float = 1.0, reason: str | None = None) -> ToolResult:
    seconds = max(0.1, min(float(seconds), 15.0))
    time.sleep(seconds)
    return ToolResult(ok=True, summary=f"waited {seconds:g}s" + (f" ({reason})" if reason else ""),
                      evidence=f"waited {seconds:g}s",
                      label=f"Waited {seconds:g}s" + (f" for {reason}" if reason else ""))


TOOLS = [
    Tool(
        name="click_element",
        description=(
            "Click a named control found through UI Automation. Prefer this over clicking "
            "coordinates: it survives windows moving, resizing and re-laying out."
        ),
        schema=schema({
            "name": string("The control's name, e.g. 'Send', 'New chat', 'Ahmed'."),
            "control": string("Optional control type filter, e.g. Button, ListItem, Edit."),
            "window": string("Window to act in. Defaults to the active window."),
            "double": boolean("Double-click instead of single.", False),
        }, ["name"]),
        handler=click_element,
        category=click_category,
        label=lambda a: f"Clicking {a.get('name')!r}",
        confirm=lambda a: (
            f"Click {a.get('name')!r}?",
            f"In {a.get('window') or 'the active window'}.",
            {"Control": str(a.get("name")), "Window": str(a.get("window") or "active window")},
        ),
    ),
    Tool(
        name="click",
        description=(
            "Click at exact screen coordinates. Use only when the target has no UI Automation "
            "element — get coordinates from observe_screen or find_ui_element first, never guess."
        ),
        schema=schema({
            "x": integer("Screen x."),
            "y": integer("Screen y."),
            "button": string("Which button.", ["left", "right", "middle"]),
            "double": boolean("Double-click.", False),
            "label": string("What you believe is there, for the activity log and permissions."),
        }, ["x", "y"]),
        handler=click,
        category=click_category,
        label=lambda a: "Clicking " + (a.get("label") or "({}, {})".format(a.get("x"), a.get("y"))),
        confirm=lambda a: (
            f"Click {a.get('label') or 'that'}?",
            f"At ({a.get('x')}, {a.get('y')}).",
            {"Target": str(a.get("label") or "unlabelled"), "Position": f"{a.get('x')}, {a.get('y')}"},
        ),
    ),
    Tool(
        name="type_text",
        description=(
            "Type text into whatever has keyboard focus. Focus the right window and field first. "
            "Refuses to type into password fields."
        ),
        schema=schema({"text": string("Exact text to type. Use \\n for Enter.")}, ["text"]),
        handler=type_text,
        category="input_control",
        label=lambda a: f"Typing {(a.get('text') or '')[:32]!r}",
    ),
    Tool(
        name="press_keys",
        description=(
            "Press a key or chord: 'enter', 'ctrl+s', 'alt+tab', 'win+e', 'ctrl+shift+n'. "
            "Also media and volume keys."
        ),
        schema=schema({
            "keys": string("The chord, joined with '+'."),
            "repeat": integer("How many times. Default 1."),
        }, ["keys"]),
        handler=press_keys,
        category="input_control",
        label=lambda a: f"Pressing {a.get('keys')}",
    ),
    Tool(
        name="scroll",
        description="Scroll the window under the pointer. Negative scrolls down, positive up.",
        schema=schema({
            "amount": integer("Notches; negative is down. Default -3."),
            "horizontal": boolean("Scroll sideways instead.", False),
        }),
        handler=scroll,
        category="input_control",
        label=lambda a: "Scrolling",
    ),
    Tool(
        name="drag",
        description="Press at one point, move, and release at another. For sliders and drag-and-drop.",
        schema=schema({
            "from_x": integer("Start x."), "from_y": integer("Start y."),
            "to_x": integer("End x."), "to_y": integer("End y."),
        }, ["from_x", "from_y", "to_x", "to_y"]),
        handler=drag,
        category="input_control",
        label=lambda a: "Dragging",
    ),
    Tool(
        name="wait",
        description=(
            "Pause for the UI to catch up — a window opening, a page loading, a file copying. "
            "Then observe again rather than assuming it finished."
        ),
        schema=schema({
            "seconds": {"type": "number", "description": "How long, up to 15."},
            "reason": string("What you are waiting for."),
        }),
        handler=wait,
        category="read_screen",
        label=lambda a: f"Waiting for {a.get('reason') or 'the UI'}",
    ),
]
