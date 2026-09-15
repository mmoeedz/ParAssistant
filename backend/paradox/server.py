"""WebSocket server: one session per connected UI."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import websockets
from websockets.asyncio.server import ServerConnection, serve

from . import memory, news, protocol, telemetry
from .computer import media
from .agent import Controller
from .config import CONFIG
from .models import ModelClient, ModelUnavailable, create_model
from .permissions import Permissions
from .tools import Registry, Tool, build_registry

log = logging.getLogger("paradox.server")


def _after_wake_word(text: str, wake_word: str) -> str | None:
    """The command spoken after the wake word, or None if it was never said.

    "" is a valid return (the user said only the wake word) and is treated by
    the caller the same as None — there is nothing to act on either way.
    """
    if not text or not wake_word:
        return None
    match = re.search(rf"\b{re.escape(wake_word)}\b", text, re.IGNORECASE)
    if not match:
        return None
    return text[match.end():].strip(" ,.!:;-—")


class Session:
    """Everything one connected UI owns: history, policy, the running task."""

    def __init__(self, ws: ServerConnection, model: ModelClient | None, registry: Registry) -> None:
        self.ws = ws
        self.model = model
        self.registry = registry
        self.permissions = Permissions()
        self.history: list[dict[str, Any]] = []
        self.current_task: protocol.Task | None = None
        self.outbox: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.task_handle: asyncio.Task[None] | None = None
        self.pending_confirmations: dict[str, asyncio.Future[bool]] = {}
        # Voice: audio streams to Google Speech-to-Text chunk by chunk while
        # the user holds the key, or while the UI is auto-segmenting speech
        # for the always-listening mode — see StreamingSession in voice/stt.py.
        self.voice_session: object | None = None
        self.voice_wake_mode = False
        self.speak_replies = True
        self.wake_word = "paradox"
        self.controller = Controller(self)

    # ------------------------------------------------------------ outbound --

    def send(self, event: dict[str, Any]) -> None:
        """Queue an event. One writer drains the queue, so ordering holds."""
        self.outbox.put_nowait(event)

    async def telemetry_loop(self, every: float = 2.0) -> None:
        """Real CPU/memory/disk/network for the monitor panel."""
        while True:
            try:
                self.send(protocol.system_stats(telemetry.sample()))
            except Exception:  # noqa: BLE001 - telemetry must never kill a session
                log.debug("telemetry sample failed", exc_info=True)
            await asyncio.sleep(every)

    async def media_loop(self, every: float = 1.5) -> None:
        """What is playing, for the now-playing bar. Silent when nothing is.

        Album art is a couple of hundred KB, so it is only sent when the track
        actually changes; the UI keeps the last one while the key matches.
        """
        sent_art_for: str | None = None
        was_playing = False
        while True:
            try:
                state = await media.now_playing()
                if state is None:
                    if was_playing:
                        self.send(protocol.now_playing(None))
                        was_playing = False
                        sent_art_for = None
                else:
                    key = f"{state['title']}␟{state['artist']}"
                    state["key"] = key
                    if key == sent_art_for:
                        state["art"] = None
                    else:
                        sent_art_for = key
                    self.send(protocol.now_playing(state))
                    was_playing = True
            except Exception:  # noqa: BLE001 - the music must never kill a session
                log.debug("media poll failed", exc_info=True)
            await asyncio.sleep(every)

    async def headlines_loop(self, every: float = 900.0) -> None:
        """Real RSS for the headlines panel; silent when the feeds are down."""
        while True:
            try:
                items = await asyncio.to_thread(news.headlines)
                self.send(protocol.headlines([h.as_json() for h in items]))
            except Exception:  # noqa: BLE001 - news must never kill a session
                log.debug("headline fetch failed", exc_info=True)
            await asyncio.sleep(every)

    async def writer(self) -> None:
        while True:
            event = await self.outbox.get()
            try:
                await self.ws.send(json.dumps(event))
            except websockets.exceptions.ConnectionClosed:
                return

    # ------------------------------------------------------- confirmations --

    async def ask_confirmation(self, tool: Tool, args: dict[str, Any], category: str) -> bool:
        request_id = protocol.uid("req")
        tier = self.permissions.tier_for(category)

        if tool.confirm:
            title, detail, params = tool.confirm(args)
        else:
            title = f"Run {tool.name.replace('_', ' ')}?"
            detail = ""
            params = {k: str(v) for k, v in args.items() if v is not None}

        future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self.pending_confirmations[request_id] = future
        self.send(protocol.confirm_request(request_id, tier, category, title, detail,
                                           tool.name, params))
        try:
            return await future
        except asyncio.CancelledError:
            self.send(protocol.confirm_resolved(request_id))
            raise
        finally:
            self.pending_confirmations.pop(request_id, None)

    # -------------------------------------------------------------- inbound --

    async def handle(self, raw: str) -> None:
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("dropped malformed frame")
            return

        kind = event.get("type")

        if kind == "prompt":
            await self._on_prompt(event)
        elif kind == "cancel":
            self._on_cancel()
        elif kind == "confirm.response":
            self._on_confirm(event)
        elif kind == "settings.update":
            settings = event.get("settings") or {}
            self.permissions.update_from_settings(settings)
            voice_settings = settings.get("voice") or {}
            self.speak_replies = bool(voice_settings.get("speakReplies", True))
            self.wake_word = str(voice_settings.get("wakeWord") or "paradox").strip().lower() or "paradox"
            log.info("settings applied from the UI")
        elif kind in ("voice.start", "voice.audio", "voice.stop"):
            await self._on_voice(kind, event)
        elif kind == "media.control":
            await self._on_media(event)
        elif kind == "media.seek":
            await self._on_media_seek(event)
        elif kind == "memory.forget":
            self._forget(event)
        elif kind == "memory.clear":
            memory.clear(event.get("kind"))
            self.send_memory()
        elif kind == "ping":
            ping_id = event.get("id")
            if isinstance(ping_id, str) and ping_id:
                self.send(protocol.pong(ping_id))
        else:
            log.warning("unknown client event: %s", kind)

    async def _on_media(self, event: dict[str, Any]) -> None:
        """Transport buttons in the UI, driving the real media session."""
        action = (event.get("action") or "").strip()
        if action not in {"play", "pause", "toggle", "next", "previous", "stop"}:
            log.warning("unknown media action: %s", action)
            return
        try:
            await media.control(action)
        except Exception:  # noqa: BLE001
            log.debug("media control failed", exc_info=True)
            return
        await self._report_media_soon()

    async def _on_media_seek(self, event: dict[str, Any]) -> None:
        """Scrubbing the timeline in the UI — jump the real session there."""
        position = event.get("positionSeconds")
        if not isinstance(position, (int, float)):
            log.warning("media.seek without a positionSeconds")
            return
        try:
            await media.seek(float(position))
        except Exception:  # noqa: BLE001
            log.debug("media seek failed", exc_info=True)
            return
        await self._report_media_soon()

    async def _report_media_soon(self) -> None:
        """Report the new state without waiting for the next poll."""
        await asyncio.sleep(0.25)
        try:
            state = await media.now_playing()
            if state is not None:
                state["key"] = f"{state['title']}␟{state['artist']}"
            self.send(protocol.now_playing(state))
        except Exception:  # noqa: BLE001
            log.debug("media re-read failed", exc_info=True)

    async def _on_prompt(self, event: dict[str, Any]) -> None:
        text = (event.get("text") or "").strip()
        if not text:
            return

        if self.model is None:
            self.send(protocol.error(
                "No model is configured, so I cannot work out how to do that. "
                "Set ANTHROPIC_API_KEY in backend/.env and restart the agent."
            ))
            return

        # A new instruction supersedes whatever is running (spec: "Open Spotify instead").
        if self.task_handle and not self.task_handle.done():
            self.task_handle.cancel()
            try:
                await self.task_handle
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        self.task_handle = asyncio.create_task(self.controller.handle(text))

    def _on_cancel(self) -> None:
        for future in self.pending_confirmations.values():
            if not future.done():
                future.set_result(False)
        if self.task_handle and not self.task_handle.done():
            self.task_handle.cancel()

    def _on_confirm(self, event: dict[str, Any]) -> None:
        request_id = event.get("requestId")
        approved = bool(event.get("approved"))
        future = self.pending_confirmations.get(str(request_id))
        if future and not future.done():
            future.set_result(approved)
        if approved and event.get("remember"):
            log.info("user chose to stop being asked about %s", request_id)

    # ---------------------------------------------------------------- voice --

    async def _on_voice(self, kind: str, event: dict[str, Any]) -> None:
        from .voice import stt

        if kind == "voice.start":
            self.voice_wake_mode = bool(event.get("wake"))
            # Opens a Google Speech-to-Text streaming session right away —
            # audio is transcribed as it arrives, not only once recording
            # stops, so most of the work is already done by the time the
            # user finishes talking.
            self.voice_session = stt.StreamingSession() if stt.available() else None
            self.send(protocol.voice_state("listening"))
            return

        if kind == "voice.audio":
            chunk = event.get("chunk")
            if isinstance(chunk, str) and self.voice_session is not None:
                import base64

                self.voice_session.push(base64.b64decode(chunk))
            return

        # voice.stop
        session, self.voice_session = self.voice_session, None
        wake_mode = self.voice_wake_mode or bool(event.get("wake"))

        if session is None:
            self.send(protocol.voice_state("off"))
            # Always-listening runs this on every utterance it hears — a hard
            # error every time would be noise, not signal, so only push-to-talk
            # (a single deliberate recording) surfaces it.
            if not wake_mode:
                self.send(protocol.error(
                    "Google Speech-to-Text is not configured in the agent (set "
                    "GOOGLE_CLOUD_API_KEY or GOOGLE_APPLICATION_CREDENTIALS), so the recording "
                    "could not be transcribed. Nothing was sent."
                ))
            return

        self.send(protocol.voice_state("transcribing"))
        try:
            result = await asyncio.to_thread(session.finish)
        except Exception as exc:  # noqa: BLE001
            self.send(protocol.voice_state("off"))
            if not wake_mode:
                self.send(protocol.error(f"Could not transcribe that: {exc}"))
            return

        self.send(protocol.voice_state("off"))
        text = result.text.strip()

        if wake_mode:
            # Always-listening: every utterance gets transcribed, but only
            # the part after the wake word is ever acted on — ambient speech
            # that never says "paradox" is dropped here, silently.
            command = _after_wake_word(text, self.wake_word)
            if not command:
                return
            log.info("wake word heard, transcribed %.1fs of audio: %r",
                      result.seconds_of_audio, command[:80])
            self.send(protocol.transcript(command))
            await self._on_prompt({"text": command, "source": "voice"})
            return

        if not text:
            self.send(protocol.error("I heard the microphone but no words came through."))
            return

        log.info("transcribed %.1fs of audio: %r", result.seconds_of_audio, text[:80])
        self.send(protocol.transcript(text))
        await self._on_prompt({"text": text, "source": "voice"})

    # --------------------------------------------------------------- memory --

    def send_memory(self) -> None:
        try:
            facts = [f.as_json() for f in memory.recall(limit=100)]
            self.send(protocol.memory_list(facts, memory.stats()))
        except Exception:  # noqa: BLE001 - memory must never break a session
            log.debug("could not read memory", exc_info=True)

    def _forget(self, event: dict[str, Any]) -> None:
        fact_id = event.get("id")
        try:
            memory.forget(fact_id=int(fact_id)) if fact_id is not None else None
        except Exception:  # noqa: BLE001
            log.debug("forget failed", exc_info=True)
        self.send_memory()


# ------------------------------------------------------------------ server --


def capabilities(registry: Registry, model: ModelClient | None) -> list[str]:
    """What is actually wired up. Not aspirational."""
    from .computer import browser, ocr, uia
    from .voice import stt, tts

    caps = ["windows", "files", "clipboard", "screen", "input"]
    if uia.AVAILABLE:
        caps.append("ui-automation")
    if ocr.AVAILABLE:
        caps.append("ocr")
    caps.append("browser-cdp")
    caps.append("whatsapp")
    if stt.available():
        caps.append("speech-to-text")
    if any(tts.available().values()):
        caps.append("text-to-speech")
    caps.append("memory")
    caps.append(f"{len(registry)} tools")
    caps.append(model.name if model else "no model")
    if model:
        caps.append("model-ready")
    return caps


async def connection(ws: ServerConnection, model: ModelClient | None, registry: Registry) -> None:
    peer = ws.remote_address
    log.info("UI connected from %s", peer)
    session = Session(ws, model, registry)
    writer = asyncio.create_task(session.writer())
    stats = asyncio.create_task(session.telemetry_loop())
    feed = asyncio.create_task(session.headlines_loop())
    songs = asyncio.create_task(session.media_loop())

    session.send(protocol.hello(capabilities(registry, model)))
    session.send_memory()
    if model is None:
        session.send(protocol.error(
            "Connected, but no model is configured — I can see the computer but cannot decide "
            "anything. Set ANTHROPIC_API_KEY in backend/.env and restart."
        ))

    try:
        async for raw in ws:
            await session.handle(raw)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        log.info("UI disconnected")
        if session.task_handle and not session.task_handle.done():
            session.task_handle.cancel()
        writer.cancel()
        stats.cancel()
        songs.cancel()
        feed.cancel()


async def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )
    CONFIG.ensure_dirs()

    registry = build_registry()

    model: ModelClient | None
    try:
        model = create_model()
        log.info("model: %s", model.name)
    except ModelUnavailable as exc:
        model = None
        log.warning("%s", exc)

    # Only once the model client exists: loading the speech model on another
    # thread while the Anthropic SDK is still importing races their native
    # libraries and takes the process down without a traceback.
    from .voice import stt

    stt.warm_up()

    log.info("%d tools ready", len(registry))
    log.info("listening on ws://%s:%d%s", CONFIG.host, CONFIG.port, CONFIG.path)

    async def handler(ws: ServerConnection) -> None:
        await connection(ws, model, registry)

    async with serve(handler, CONFIG.host, CONFIG.port):
        await asyncio.Future()  # run until interrupted
