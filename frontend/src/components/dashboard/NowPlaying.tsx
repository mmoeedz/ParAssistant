import { useEffect, useRef } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
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

/** The app id Windows reports is a model id; show the readable half of it. */
function sourceName(app: string): string {
  if (!app) return ''
  const tail = app.split('!').pop() ?? app
  const head = tail.split('.').pop() ?? tail
  return head.replace(/\.exe$/i, '')
}

export function NowPlaying() {
  const media = useSession((s) => s.media)
  const control = useSession((s) => s.mediaControl)

  const barRef = useRef<HTMLElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)

  const position = media?.position ?? 0
  const duration = media?.duration ?? 0
  const playing = media?.status === 'playing'
  const key = media?.key

  /**
   * The agent samples the player about once a second, which would step the bar
   * along in visible jumps. Run the clock forward here between samples and
   * write it straight to the DOM — re-rendering the panel four times a second
   * to move one bar would be silly.
   *
   * A timer rather than requestAnimationFrame: rAF stops when the window is
   * not being painted, and the elapsed time is capped so that if this does
   * stall, the bar cannot run away — the next sample is a second behind anyway.
   * The 250ms step is smoothed by a matching CSS transition on the bar.
   */
  useEffect(() => {
    const bar = barRef.current
    const label = timeRef.current
    if (!bar || !label || duration <= 0) return

    const paint = (at: number) => {
      const pct = Math.max(0, Math.min(100, (at / duration) * 100))
      bar.style.width = `${pct}%`
      label.textContent = clock(at)
    }

    paint(position)
    if (!playing) return

    const from = performance.now()
    const id = setInterval(() => {
      const elapsed = Math.min((performance.now() - from) / 1000, 10)
      paint(Math.min(position + elapsed, duration))
    }, 250)
    return () => clearInterval(id)
  }, [position, duration, playing, key])

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
          <span className="media__bar">
            <b ref={barRef} />
          </span>
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
            disabled={!media.can.stop}
            onClick={() => control('stop')}
            title="Stop"
          >
            <Square size={14} />
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
