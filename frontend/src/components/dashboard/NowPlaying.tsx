import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useSession } from '@/store/session'
import { RUN_ON_MS, projectPosition } from '@/lib/mediaClock'
import './dashboard.css'

/**
 * The media session panel.
 *
 * Windows publishes whatever is playing — Spotify, a YouTube tab, VLC — through
 * the system media session, and the agent reports it. The buttons drive that
 * same session, so they control the real player, not a copy of it.
 *
 * Nothing playing means no panel: the column never holds an empty player.
 */

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The app id Windows reports is a model id; show the readable half of it. */
function sourceName(app: string): string {
  if (!app) return ''
  const tail = app.split('!').pop() ?? app
  const head = tail.split('.').pop() ?? tail
  return head.replace(/\.exe$/i, '')
}

export function NowPlaying() {
  const media = useSession((s) => s.media)
  const anchor = useSession((s) => s.mediaSampledAt)
  const control = useSession((s) => s.mediaControl)
  const seek = useSession((s) => s.mediaSeek)

  const barRef = useRef<HTMLElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubRef = useRef<HTMLDivElement>(null)
  /** The whole second the label currently shows, so it is rewritten once a second, not every frame. */
  const shownSecond = useRef(-1)

  const position = media?.position ?? 0
  const duration = media?.duration ?? 0
  const rate = media?.rate ?? 1
  const key = media?.key
  const canSeek = Boolean(media?.can.seek) && duration > 0

  /**
   * Whether the rail moves comes from `advancing` — the agent's reading of the
   * timeline itself — not from `status`, which players get wrong in both
   * directions: Spotify Connect reports "paused" while the song plays on the
   * phone and "playing" while it sits paused. Buffering reads as not advancing,
   * so the rail holds rather than moving on an assumption. `status` is only the
   * fallback for an agent too old to send `advancing`.
   */
  const playing = media?.advancing ?? media?.status === 'playing'

  /** Where the user is currently dragging to, in seconds — null when not scrubbing. */
  const [scrub, setScrub] = useState<number | null>(null)

  const paint = (at: number) => {
    const bar = barRef.current
    const label = timeRef.current
    if (!bar || !label) return
    const pct = duration > 0 ? Math.max(0, Math.min(100, (at / duration) * 100)) : 0
    bar.style.width = `${pct}%`
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`
    const whole = Math.floor(at)
    if (whole !== shownSecond.current) {
      shownSecond.current = whole
      label.textContent = clock(at)
    }
  }

  const positionFromPointer = (clientX: number) => {
    const el = scrubRef.current
    if (!el || duration <= 0) return 0
    const rect = el.getBoundingClientRect()
    const frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
    return Math.max(0, Math.min(1, frac)) * duration
  }

  const onScrubDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canSeek) return
    const at = positionFromPointer(e.clientX)
    setScrub(at)
    paint(at)
    // If this throws (an odd device, a synthetic pointer id), the drag still
    // ends correctly — onScrubEnd below is what actually clears it, not this.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not fatal — see comment above */
    }
  }

  const onScrubMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub == null) return
    const at = positionFromPointer(e.clientX)
    setScrub(at)
    paint(at)
  }

  /**
   * The one place a drag ends — pointerup, pointercancel, or the browser
   * revoking capture for any other reason (onLostPointerCapture fires for
   * all of these). Committing the seek only here, instead of in onPointerUp,
   * means a dropped or out-of-window pointerup can never leave the bar
   * stuck mid-drag showing a frozen clock forever.
   */
  const onScrubEnd = () => {
    setScrub((current) => {
      if (current != null) seek(current)
      return null
    })
  }

  /**
   * One requestAnimationFrame loop, alive only while the track is really moving.
   *
   * Every frame reads the player's clock (projectPosition: the published
   * position placed at the instant it was true, advanced at the player's own
   * rate) and paints it — nothing is counted or accumulated here, so the rail
   * cannot drift, scales with 0.5x/2x by construction, and after a stalled or
   * hidden tab resumes exactly where the player is. Frame rate only decides
   * how often the rail is painted, never how fast it moves.
   *
   * Any new sample, pause, seek or drag re-runs this effect, and its cleanup
   * cancels the previous frame first, so there is never more than one loop.
   * A layout effect so the rail is placed before the panel first paints.
   */
  useLayoutEffect(() => {
    shownSecond.current = -1
    if (scrub != null) return

    if (!playing || anchor == null || duration <= 0) {
      paint(position)
      return
    }

    let frame = 0
    const step = (now: number) => {
      const at = projectPosition({ position, duration, rate }, anchor, now)
      paint(at)
      // Ended (rail at 100%, elapsed = duration), or the player has gone quiet
      // past RUN_ON_MS: the rail stays put until the next sample, so stop
      // spending frames on it.
      if (at >= duration || now - anchor >= RUN_ON_MS) return
      frame = requestAnimationFrame(step)
    }
    step(performance.now())
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint reads refs, not state
  }, [position, duration, rate, playing, key, anchor, scrub])

  if (!media) return null

  const source = sourceName(media.app)

  return (
    <section className="panel media">
      <header className="panel__head">
        <Music size={14} />
        <span className="section-title">MEDIA SESSION</span>
        {source ? <span className="media__source">{source}</span> : null}
      </header>

      <div className="media__body" data-playing={playing}>
        {media.art ? (
          <div className="media__wash" style={{ backgroundImage: `url(${media.art})` }} />
        ) : null}

        <div className="media__art">
          {media.art ? (
            <img src={media.art} alt="" />
          ) : (
            <span className="media__art-blank">
              <Music size={28} />
            </span>
          )}
        </div>

        <div className="media__title" title={media.title}>
          {media.title}
        </div>
        <div className="media__artist" title={media.album ?? undefined}>
          {media.artist || media.album || 'Unknown artist'}
        </div>

        <div className="media__track">
          {/* Written only by paint(), never by React, so a re-render cannot overwrite the live clock. */}
          <span className="media__time" ref={timeRef} />
          <div
            ref={scrubRef}
            className="media__scrub"
            data-seekable={canSeek}
            data-dragging={scrub != null}
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
            onLostPointerCapture={onScrubEnd}
            title={canSeek ? 'Drag to jump to a point in the track' : undefined}
          >
            <span className="media__bar">
              <b ref={barRef} />
            </span>
            <span className="media__thumb" ref={thumbRef} />
          </div>
          <span className="media__time">{clock(media.duration)}</span>
        </div>

        <div className="media__controls">
          <button
            type="button"
            className="media__btn"
            disabled={!media.can.previous}
            onClick={() => control('previous')}
            title="Previous track"
          >
            <SkipBack size={17} />
          </button>
          <button
            type="button"
            className="media__btn media__btn--main"
            onClick={() => control('toggle')}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            className="media__btn"
            disabled={!media.can.next}
            onClick={() => control('next')}
            title="Next track"
          >
            <SkipForward size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}
