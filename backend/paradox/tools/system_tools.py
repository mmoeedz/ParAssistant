"""Volume, media keys and the clipboard."""

from __future__ import annotations

from ..computer import files as fs
from ..computer import win
from .registry import Tool, ToolResult, integer, schema, string, untrusted


def volume(action: str, steps: int = 4) -> ToolResult:
    win.volume(action, repeat=steps if action != "mute" else 1)
    return ToolResult(
        ok=True,
        summary=f"volume {action}"
                + (f" x{steps}" if action != 'mute' else "")
                + ". Windows has no reliable way to read the level back, so this is not verified.",
        evidence=f"sent volume {action}",
        label=f"Turned volume {action}" if action != "mute" else "Toggled mute",
    )


def media(action: str) -> ToolResult:
    win.media(action)
    return ToolResult(ok=True, summary=f"sent the {action} media key to whatever is playing",
                      evidence=f"sent media {action}", label=f"Media: {action}")


def clipboard(action: str, text: str | None = None) -> ToolResult:
    if action == "read":
        content = fs.read_clipboard()
        if not content:
            return ToolResult(ok=True, summary="the clipboard is empty",
                              evidence="clipboard empty", label="Read the clipboard")
        preview = content if len(content) <= 1500 else content[:1500] + "…"
        return ToolResult(ok=True, summary=untrusted(preview, "clipboard"),
                          evidence=f"{len(content)} characters on the clipboard",
                          label="Read the clipboard")

    if action == "write":
        if text is None:
            return ToolResult.fail("write needs text")
        fs.write_clipboard(text)
        back = fs.read_clipboard()
        return ToolResult(ok=back == text,
                          summary="clipboard set" if back == text else "clipboard did not take the value",
                          evidence="clipboard now holds the text" if back == text else "write not confirmed",
                          label="Set the clipboard")

    return ToolResult.fail(f"unknown clipboard action: {action}")


TOOLS = [
    Tool(
        name="volume",
        description="Turn the system volume up or down, or toggle mute. Each step is one notch.",
        schema=schema({
            "action": string("What to do.", ["up", "down", "mute"]),
            "steps": integer("How many notches. Default 4."),
        }, ["action"]),
        handler=volume,
        category="media_control",
        label=lambda a: f"Turning volume {a.get('action')}",
    ),
    Tool(
        name="media",
        description="Send a media key: play/pause, next, previous, stop. Works with Spotify, YouTube, VLC.",
        schema=schema({"action": string("Which key.", ["play", "pause", "next", "previous", "stop"])},
                      ["action"]),
        handler=media,
        category="media_control",
        label=lambda a: f"Media {a.get('action')}",
    ),
    Tool(
        name="clipboard",
        description="Read or write the Windows clipboard. Reading is how you pick up copied text or files.",
        schema=schema({
            "action": string("read or write.", ["read", "write"]),
            "text": string("Text to put on the clipboard, when writing."),
        }, ["action"]),
        handler=clipboard,
        category=lambda a: "read_screen" if a.get("action") == "read" else "input_control",
        label=lambda a: "Reading the clipboard" if a.get("action") == "read" else "Setting the clipboard",
    ),
]
