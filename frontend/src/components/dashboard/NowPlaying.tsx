import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useSession } from '@/store/session'
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

/**
 * How far the local clock may run past the last position the player actually
 * confirmed. Long enough to smooth over a lazy reporter, short enough that a
 * player which stops talking altogether cannot drift minutes out of step.
 */
const RUN_ON_MS = 10_000

/** The app id Windows reports is a model id; show the readable half of it. */
function sourceName(app: string): string {
  if (!app) return ''
  const tail = app.split('!').pop() ?? app
  const head = tail.split('.').pop() ?? tail
  return head.replace(/\.exe$/i, '')
}

export function NowPlaying() {
  const media = useSession((s) => s.media)
  const mediaSampledAt = useSession((s) => s.mediaSampledAt)
  const control = useSession((s) => s.mediaControl)
  const seek = useSession((s) => s.mediaSeek)

  const barRef = useRef<HTMLElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const scrubRef = useRef<HTMLDivElement>(null)

  const position = media?.position ?? 0
  const duration = media?.duration ?? 0
  const key = media?.key
  const canSeek = Boolean(media?.can.seek) && duration > 0

  /**
   * "Playing" is what the player claims; `advancing` is whether it is actually
   * moving. They disagree when playback has been handed to another device —
   * Spotify Connect keeps reporting "playing" on a track pinned in place — and
   * when they do, believing the claim runs a clock for a song nobody is
   * hearing. The panel follows the truth, so it stops where the track stopped.
   */
  const playing = media?.status === 'playing' && media.advancing !== false

  /** Where the user is currently dragging to, in seconds — null when not scrubbing. */
  const [scrub, setScrub] = useState<number | null>(null)

  const paint = (at: number) => {
    const bar = barRef.current
    const label = timeRef.current
    if (!bar || !label || duration <= 0) return
    const pct = Math.max(0, Math.min(100, (at / duration) * 100))
    bar.style.width = `${pct}%`
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`
    label.textContent = clock(at)
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
   * The agent samples the player about once a second, which would step the bar
   * along in visible jumps. Run the clock forward here between samples and
   * write it straight to the DOM — re-rendering the panel four times a second
   * to move one bar would be silly.
   *
   * `position` and `mediaSampledAt` always describe the same instant — set
   * together by every real sample and by the optimistic pause/resume in
   * mediaControl — so this only ever extrapolates forward from a point that
   * was true when it was set, instead of re-basing to a slightly stale
   * position and visibly snapping the bar backward.
   *
   * Windows updates a player's reported position only occasionally, so the
   * clock has to be run forward locally to read smoothly — but running it
   * forward is a claim, and it is only allowed to outrun the last confirmed
   * position by RUN_ON_MS. Past that the player has told us nothing for long
   * enough that guessing would be inventing a position rather than smoothing
   * one, so the bar holds where it was last known to be.
   *
   * While the user is dragging the bar themselves, `scrub` owns painting —
   * this effect steps aside so the two don't fight over the same DOM nodes.
   *
   * A timer rather than requestAnimationFrame: rAF stops when the window is
   * not being painted. The 250ms step is smoothed by a matching CSS
   * transition on the bar.
   */
  useEffect(() => {
    if (duration <= 0 || scrub != null) return

    if (!playing || mediaSampledAt == null) {
      paint(position)
      return
    }

    const tick = () => {
      const elapsed = Math.min((performance.now() - mediaSampledAt) / 1000, RUN_ON_MS / 1000)
      paint(Math.min(position + elapsed, duration))
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint reads refs, not state
  }, [position, duration, playing, key, mediaSampledAt, scrub])

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
          <span className="media__time" ref={timeRef}>
            {clock(media.position)}
          </span>
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
