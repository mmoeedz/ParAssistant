"""Memory and voice tools that belong to Paradox Core itself."""

from __future__ import annotations

from .. import memory
from ..voice import stt, tts
from .registry import Tool, ToolResult, integer, schema, string, untrusted


def remember(kind: str, key: str, value: str) -> ToolResult:
    try:
        fact = memory.remember(kind, key, value, source="conversation")
    except ValueError as exc:
        return ToolResult.fail(str(exc))

    return ToolResult(
        ok=True,
        summary=f"remembered — {fact.describe()}. It will be there next session, and the user "
                "can see and delete it in the Memory panel.",
        evidence=f"stored [{fact.kind}] {fact.key}",
        label=f"Remembered {fact.key}",
    )


def recall(query: str | None = None, kind: str | None = None, limit: int = 15) -> ToolResult:
    facts = memory.recall(query=query, kind=kind, limit=limit)
    if not facts:
        return ToolResult(
            ok=True,
            summary=f"nothing remembered{f' about {query!r}' if query else ''} yet",
            evidence="no matching memories",
            label="Checked memory",
        )

    listing = "\n".join(f"- {f.describe()}" for f in facts)
    return ToolResult(
        ok=True,
        summary=untrusted(listing, "stored memory"),
        evidence=f"{len(facts)} memory item(s)",
        label=f"Recalled {len(facts)} item(s)",
    )


def forget(key: str, kind: str | None = None) -> ToolResult:
    removed = memory.forget(kind=kind, key=key)
    return ToolResult(
        ok=removed > 0,
        summary=f"forgot {removed} item(s) matching {key!r}" if removed
                else f"nothing stored under {key!r}",
        evidence=f"{removed} removed",
        label=f"Forgot {key}",
    )


def speak(text: str) -> ToolResult:
    providers = tts.available()
    if not any(providers.values()):
        return ToolResult.fail("no speech engine is available on this machine")

    tts.speak(text)
    return ToolResult(
        ok=True,
        summary=f"speaking aloud: {text[:80]!r}. Windows has no way to confirm the user heard it.",
        evidence=f"sent {len(text)} chars to the speech engine",
        label="Spoke out loud",
    )


def save_speech(text: str, voice: str | None = None) -> ToolResult:
    try:
        path = tts.speak_to_file(text, voice=voice)
    except Exception as exc:  # noqa: BLE001
        return ToolResult.fail(f"could not generate speech: {exc}")

    size = path.stat().st_size
    return ToolResult(
        ok=size > 0,
        summary=f"saved speech to {path} ({size // 1024} KB). Attach it to send it as audio.",
        evidence=f"{path.name} is {size // 1024} KB",
        label=f"Recorded {path.name}",
    )


TOOLS = [
    Tool(
        name="remember",
        description=(
            "Store something worth keeping between sessions: a preference, a fact about a person, "
            "a way the user likes something done. Use it when the user says to remember, or when "
            "you learn something that will obviously matter again. Do not store secrets, and do "
            "not store things scraped off the screen."
        ),
        schema=schema({
            "kind": string("What sort of memory.", ["preference", "person", "workflow", "note"]),
            "key": string("Short identifier, e.g. 'preferred browser' or 'Ahmed'."),
            "value": string("What to remember about it."),
        }, ["kind", "key", "value"]),
        handler=remember,
        category="find_files",
        label=lambda a: f"Remembering {a.get('key')}",
    ),
    Tool(
        name="recall",
        description="Look in memory for what you already know, optionally filtered by text or kind.",
        schema=schema({
            "query": string("Text to search for in keys and values."),
            "kind": string("Restrict to one kind.", ["preference", "person", "workflow", "note"]),
            "limit": integer("How many to return. Default 15."),
        }),
        handler=recall,
        category="find_files",
        label=lambda a: f"Recalling {a.get('query') or 'what I know'}",
    ),
    Tool(
        name="forget",
        description="Delete a stored memory by its key. Use when the user says to forget something.",
        schema=schema({
            "key": string("The key to remove."),
            "kind": string("Narrow to one kind, if the key is used twice."),
        }, ["key"]),
        handler=forget,
        category="find_files",
        label=lambda a: f"Forgetting {a.get('key')}",
    ),
    Tool(
        name="speak",
        description=(
            "Say something out loud through the speakers. For answering hands-free, not for "
            "narrating what you are doing."
        ),
        schema=schema({"text": string("What to say.")}, ["text"]),
        handler=speak,
        category="media_control",
        label=lambda a: "Speaking",
    ),
    Tool(
        name="save_speech",
        description=(
            "Turn text into an audio file and return its path — the first half of sending a voice "
            "message. To send it on WhatsApp, use whatsapp_send_voice instead, which does both."
        ),
        schema=schema({
            "text": string("What the audio should say."),
            "voice": string("Optional voice name."),
        }, ["text"]),
        handler=save_speech,
        category="media_control",
        label=lambda a: "Recording speech",
    ),
]


def capabilities() -> dict[str, object]:
    return {"tts": tts.info(), "stt": stt.info(), "memory": memory.stats()}
