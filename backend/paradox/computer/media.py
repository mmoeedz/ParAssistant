"""What is playing on this machine, and the transport controls for it.

Windows publishes whatever is playing — Spotify, YouTube in a browser, VLC,
anything that registers a session — through the System Media Transport
Controls. This reads that: title, artist, album art, and where the track is up
to, plus play/pause/next/previous/stop against the same session.

Nothing here guesses. If Windows reports no session, there is no song, and the
UI shows nothing rather than a placeholder.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import threading
import time
from typing import Any

log = logging.getLogger(__name__)

# PlaybackStatus, from Windows.Media.Control
_STATUS = {0: "closed", 1: "opened", 2: "changing", 3: "stopped", 4: "paused", 5: "playing"}

# Album art is a few hundred KB and only changes with the track. Decode it once.
_art_key: tuple[str, str] | None = None
_art_value: str | None = None


# Imported up front on purpose: pulling a winrt module in from inside a running
# event loop, mid-await, deadlocks on the COM apartment.
try:
    from winrt.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as _Manager,
    )
    from winrt.windows.storage.streams import DataReader as _DataReader

    AVAILABLE = True
except Exception:  # noqa: BLE001 - the bindings are optional
    _Manager = None  # type: ignore[assignment]
    _DataReader = None  # type: ignore[assignment]
    AVAILABLE = False


# uiautomation puts the main thread in a single-threaded apartment, and WinRT's
# async continuations never pump there — the album-art read hangs forever. All
# of this runs on a worker thread of its own, which WinRT initialises as MTA.
_loop: asyncio.AbstractEventLoop | None = None
_worker: threading.Thread | None = None
_worker_lock = threading.Lock()

CALL_TIMEOUT = 4.0


def _ensure_worker() -> asyncio.AbstractEventLoop:
    global _loop, _worker
    with _worker_lock:
        if _loop is not None and _worker is not None and _worker.is_alive():
            return _loop
        loop = asyncio.new_event_loop()

        def run() -> None:
            asyncio.set_event_loop(loop)
            loop.run_forever()

        thread = threading.Thread(target=run, name="media-smtc", daemon=True)
        thread.start()
        _loop, _worker = loop, thread
        return loop


async def _off_thread(coro: Any) -> Any:
    """Run a WinRT coroutine on the media thread and wait for it here."""
    loop = _ensure_worker()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    try:
        return await asyncio.wait_for(asyncio.wrap_future(future), CALL_TIMEOUT)
    except asyncio.TimeoutError:
        future.cancel()
        raise


async def _session():
    manager = await _Manager.request_async()
    return manager.get_current_session()


async def _thumbnail(reference: Any) -> str | None:
    """The album art as a data URI, or None if this session has no art."""
    if reference is None:
        return None

    stream = await reference.open_read_async()
    size = stream.size
    if not size or size > 4_000_000:
        return None
    reader = _DataReader(stream)
    await reader.load_async(size)
    raw = bytes(reader.read_buffer(size))
    kind = stream.content_type or "image/jpeg"
    return f"data:{kind};base64,{base64.b64encode(raw).decode('ascii')}"


# What the last read of the player looked like — see _advancing. Module state,
# not per UI session: it describes the one player this machine is showing.
_prev_key: str | None = None
_prev_publish: tuple[float, float] | None = None  # position, published_at
_prev_status: str | None = None
_status_changed_at = 0.0
_moving = False

# A republish that moved less than this is the player standing still.
_STILL = 0.05


def _advancing(key: str, position: float, published_at: float, status: str) -> bool:
    """Whether the track is actually moving, decided from the timeline first.

    `status` is the part players get wrong. Spotify with playback on a phone
    (Spotify Connect) reports "paused" while the song plays — publishing a
    position that advances in ~4.5s steps — and "playing" while it sits paused,
    republishing a pinned position. Believing status there either freezes a
    playing rail into 4.5s jumps or runs a stopped one. So motion decides:

    - a fresh publish that moved like playback (0.25x-4x the time between
      publishes) means moving, whatever status says;
    - a fresh publish that did not move means stopped, whatever status says;
    - a status *change* is believed at once — a real pause or play shows there
      before the next publish can prove it — and no publish from before that
      change may overrule it;
    - anything else (silence, or a seek, which proves nothing either way)
      leaves the last decision standing. A new track starts from its status.
    """
    global _prev_key, _prev_publish, _prev_status, _status_changed_at, _moving

    if key != _prev_key:
        _prev_key, _prev_publish = key, None
        _moving = status == "playing"
    elif status != _prev_status:
        _status_changed_at = time.time()
        _moving = status == "playing"

    if _prev_publish is not None and published_at != _prev_publish[1]:
        moved = position - _prev_publish[0]
        between = published_at - _prev_publish[1]
        if published_at > _status_changed_at:
            if abs(moved) < _STILL:
                _moving = False
            elif between > 0 and 0.25 <= moved / between <= 4.0:
                _moving = True

    _prev_publish = (position, published_at)
    _prev_status = status
    return _moving


async def now_playing() -> dict[str, Any] | None:
    """The current track, or None when nothing is playing on this machine."""
    if not AVAILABLE:
        return None
    return await _off_thread(_read())


async def _read() -> dict[str, Any] | None:
    global _art_key, _art_value

    session = await _session()
    if session is None:
        return None

    props = await session.try_get_media_properties_async()
    info = session.get_playback_info()
    timeline = session.get_timeline_properties()

    title = (props.title or "").strip()
    artist = (props.artist or "").strip()
    if not title:
        return None

    status = _STATUS.get(int(info.playback_status), "stopped")
    if status in {"closed", "stopped"}:
        return None

    key = (title, artist)
    if key != _art_key:
        try:
            _art_value = await _thumbnail(props.thumbnail)
        except Exception:  # noqa: BLE001 - art is decoration, never fatal
            log.debug("album art unavailable", exc_info=True)
            _art_value = None
        _art_key = key

    position = timeline.position.total_seconds()
    controls = info.controls
    return {
        "title": title,
        "artist": artist,
        "album": (props.album_title or "").strip() or None,
        "app": session.source_app_user_model_id or "",
        "status": status,
        "advancing": _advancing(
            f"{title}␟{artist}", position, timeline.last_updated_time.timestamp(), status
        ),
        "position": position,
        # `position` is only true as of the player's last publish, which can be
        # seconds ago. The UI needs that age to place it on the real timeline
        # instead of treating a stale number as current. A player that never
        # set the timestamp reports Windows' zero date (1601) — treat as fresh.
        "positionAge": (
            max(0.0, time.time() - timeline.last_updated_time.timestamp())
            if timeline.last_updated_time.year >= 2000
            else 0.0
        ),
        "rate": float(info.playback_rate or 1.0),
        "duration": timeline.end_time.total_seconds(),
        "art": _art_value,
        "can": {
            "play": bool(controls.is_play_enabled or controls.is_pause_enabled),
            "next": bool(controls.is_next_enabled),
            "previous": bool(controls.is_previous_enabled),
            "stop": bool(controls.is_stop_enabled),
            "seek": bool(controls.is_playback_position_enabled),
        },
    }


async def control(action: str) -> bool:
    """Drive the current session. Returns whether Windows accepted it."""
    if not AVAILABLE:
        return False
    return await _off_thread(_control(action))


async def _control(action: str) -> bool:
    session = await _session()
    if session is None:
        return False

    match action:
        case "play" | "pause" | "toggle":
            return bool(await session.try_toggle_play_pause_async())
        case "next":
            return bool(await session.try_skip_next_async())
        case "previous":
            return bool(await session.try_skip_previous_async())
        case "stop":
            return bool(await session.try_stop_async())
    raise ValueError(f"unknown media action: {action}")


_TICKS_PER_SECOND = 10_000_000  # a WinRT TimeSpan/tick is 100ns


async def seek(position_seconds: float) -> bool:
    """Jump the current session to a position, in seconds. Returns whether
    Windows accepted it — not every player can be scrubbed."""
    if not AVAILABLE:
        return False
    return await _off_thread(_seek(position_seconds))


async def _seek(position_seconds: float) -> bool:
    session = await _session()
    if session is None:
        return False
    ticks = round(max(0.0, position_seconds) * _TICKS_PER_SECOND)
    return bool(await session.try_change_playback_position_async(ticks))


def snapshot() -> dict[str, Any] | None:
    """Blocking wrapper, for callers that are not already in a loop."""
    return asyncio.run(now_playing())

