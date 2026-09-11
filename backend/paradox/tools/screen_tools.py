"""Seeing the screen: UI Automation first, pixels second."""

from __future__ import annotations

from typing import Any

from ..computer import ocr, uia, win
from .registry import Tool, ToolResult, boolean, schema, string, untrusted


def _target_window(query: str | None) -> win.WindowInfo | None:
    if not query:
        return win.active_window()
    matches = win.find_windows(query)
    return matches[0] if matches else None


def observe_screen(include_image: bool = True, window: str | None = None) -> ToolResult:
    target = _target_window(window)
    if not target:
        return ToolResult.fail("no foreground window could be identified")

    elements = uia.read_window(target.hwnd)
    lines = [
        f"Active window: {target.title!r} ({target.process}, {target.state})",
        f"Window bounds: {target.rect}",
        f"Screen size: {win.screen_size()}",
        "",
        "Readable controls (UI Automation):",
        uia.summarize(elements),
    ]

    image = None
    if include_image:
        _, image = win.capture()

    return ToolResult(
        ok=True,
        summary=untrusted("\n".join(lines), f"screen: {target.process}"),
        evidence=f"active window: {target.title or target.process}",
        label=f"Looked at {target.title or target.process}",
        image=image,
        observation={"activeWindow": target.title or target.process,
                     "image": image,
                     "method": "uia" if elements else "vision"},
    )


def read_window(window: str | None = None) -> ToolResult:
    target = _target_window(window)
    if not target:
        return ToolResult.fail(f"no window matching {window!r}")

    elements = uia.read_window(target.hwnd)
    if not elements:
        return ToolResult(
            ok=True,
            summary=f"{target.title!r} exposes no UI Automation elements. "
                    "Call observe_screen with include_image=true and work from the picture.",
            evidence=f"{target.title or target.process}: no UIA tree",
            label=f"Read {target.title or target.process}",
        )

    return ToolResult(
        ok=True,
        summary=untrusted(uia.summarize(elements, limit=90), f"window: {target.title}"),
        evidence=f"{len(elements)} controls in {target.title or target.process}",
        label=f"Read {target.title or target.process}",
        observation={"activeWindow": target.title or target.process, "method": "uia"},
    )


def find_ui_element(name: str, control: str | None = None,
                    window: str | None = None) -> ToolResult:
    target = _target_window(window)
    if not target:
        return ToolResult.fail(f"no window matching {window!r}")

    matches = uia.find_elements(target.hwnd, name=name, control=control)
    if not matches:
        return ToolResult(
            ok=False,
            summary=f"nothing called {name!r} in {target.title!r}. "
                    "Try read_window to see what is actually there.",
            evidence=f"no match for {name!r}",
            label=f"Looked for {name!r}",
        )

    listing = "\n".join(f"- {el.describe()}" for el in matches[:12])
    return ToolResult(
        ok=True,
        summary=f"{len(matches)} match(es) in {target.title!r}:\n{listing}",
        evidence=f"found {matches[0].name or name!r} at {matches[0].center}",
        label=f"Found {name!r}",
    )


def read_text_on_screen(find: str | None = None, window: str | None = None) -> ToolResult:
    """OCR — for text that UI Automation cannot see."""
    if not ocr.AVAILABLE:
        return ToolResult.fail("the Windows OCR engine is not available in this environment")

    target = _target_window(window)
    region = target.rect if (window and target) else None
    image, _ = win.capture(region=region)
    screen_w = win.screen_size()[0] if not region else (region[2] - region[0])
    scale = image.width / max(screen_w, 1)
    offset = (region[0], region[1]) if region else (0, 0)

    result = ocr.read_image(image, offset=offset, scale=scale)
    if not result.lines:
        return ToolResult(ok=False, summary="OCR found no text in that area",
                          evidence="no text recognised", label="Read no text")

    if find:
        hits = ocr.find_text(result, find)
        if not hits:
            return ToolResult(
                ok=False,
                summary=f"OCR read {len(result.lines)} lines but none contain {find!r}",
                evidence=f"no OCR match for {find!r}",
                label=f"Did not find {find!r} on screen",
            )
        listing = "\n".join(f"- {h.describe()}" for h in hits[:10])
        return ToolResult(
            ok=True,
            summary=untrusted(f"{len(hits)} place(s) showing {find!r}:\n{listing}", "screen OCR"),
            evidence=f"{find!r} at {hits[0].center[0]},{hits[0].center[1]}",
            label=f"Found {find!r} on screen",
        )

    return ToolResult(
        ok=True,
        summary=untrusted(result.summarize(), "screen OCR"),
        evidence=f"{len(result.lines)} lines of text read",
        label=f"Read {len(result.lines)} lines of text",
        observation={"activeWindow": target.title if target else "screen", "method": "ocr"},
    )


TOOLS = [
    Tool(
        name="observe_screen",
        description=(
            "Look at the screen. Returns the active window, its readable controls from "
            "Windows UI Automation, and optionally a screenshot. Call this when you do not "
            "know the current state, and again after an action to check it worked. Do not "
            "call it repeatedly without a reason — it costs time and tokens."
        ),
        schema=schema({
            "include_image": boolean("Attach a screenshot. Skip it when the control list is enough.", True),
            "window": string("Optional window title or process to look at instead of the active one."),
        }),
        handler=observe_screen,
        category="read_screen",
        label=lambda a: f"Looking at {a.get('window') or 'the screen'}",
    ),
    Tool(
        name="read_window",
        description=(
            "List the controls of one window via UI Automation: buttons, text, list items, "
            "edit fields, with names and screen positions. Prefer this over a screenshot — "
            "it is faster, cheaper and more precise."
        ),
        schema=schema({"window": string("Window title or process name. Defaults to the active window.")}),
        handler=read_window,
        category="read_screen",
        label=lambda a: f"Reading {a.get('window') or 'the active window'}",
    ),
    Tool(
        name="find_ui_element",
        description=(
            "Find controls by name inside a window and get their exact screen coordinates. "
            "Use before clicking so you click a known element rather than a guessed position."
        ),
        schema=schema({
            "name": string("Text on or near the control, e.g. 'Send', 'Search', 'Ahmed'."),
            "control": string("Optional control type filter, e.g. Button, Edit, ListItem."),
            "window": string("Window to search. Defaults to the active window."),
        }, ["name"]),
        handler=find_ui_element,
        category="read_screen",
        label=lambda a: f"Looking for {a.get('name')!r}",
    ),
    Tool(
        name="read_text_on_screen",
        description=(
            "Read text off the screen with OCR. Use when UI Automation shows nothing readable — "
            "images, video, canvas apps, PDFs in a viewer, remote desktops. Returns each line "
            "with the screen position you could click. Cheaper and more precise than sending a "
            "screenshot to be looked at."
        ),
        schema=schema({
            "find": string("Only return lines containing this text."),
            "window": string("Restrict to one window. Defaults to the whole screen."),
        }),
        handler=read_text_on_screen,
        category="read_screen",
        label=lambda a: "Reading text on screen"
        + (f" for {a.get('find')!r}" if a.get("find") else ""),
    ),
]
