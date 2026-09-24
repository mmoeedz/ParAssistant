import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useSession } from '@/store/session'
import { AGENTS } from '@/types/agents'
import { worldDots } from '@/components/dashboard/world'
import './boot.css'

/**
 * The boot sequence played over the app while it loads.
 *
 * A film-title opening rather than a spinner: rings spin up, frame lines
 * draw themselves in, the boot log types out, and the PARADOX title settles
 * over a dotted world map while the progress bar fills. It then collapses to
 * a single horizontal line and off, like a screen switching over, revealing
 * the dashboard underneath — which has been mounting behind it the whole
 * time, so nothing about the app is actually delayed by this.
 *
 * Most of it is set dressing, and says so by being aria-hidden. The parts
 * that make a claim are real: the last boot line reports the actual agent
 * connection, the roster is the real one, and the version is the one the
 * backend announced (a dash until it has).
 *
 * Any key or click skips it. Under prefers-reduced-motion the whole thing is
 * a brief static card instead.
 */

const RUN_MS = 4200
const REDUCED_MS = 1100
/** Must match the collapse transition in boot.css. */
const EXIT_MS = 720

type Phase = 'run' | 'exit' | 'done'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Fast out, long settle — the bar races, then crawls over the last stretch. */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 2.4)
}

export function BootScreen() {
  const [phase, setPhase] = useState<Phase>('run')
  const [pct, setPct] = useState(0)
  const connection = useSession((s) => s.connection)
  const preview = useSession((s) => s.preview)
  const version = useSession((s) => s.backendInfo?.version)

  // Drive the progress from one clock. The state only changes when the
  // whole-number percentage does — about a hundred renders over the run —
  // and the heavy parts (the map, the rings) are memoised and never
  // re-render at all, so this costs almost nothing while the app mounts.
  useEffect(() => {
    if (phase !== 'run') return
    const total = prefersReducedMotion() ? REDUCED_MS : RUN_MS
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / total)
      setPct((prev) => {
        const next = Math.round(ease(t) * 100)
        return next === prev ? prev : next
      })
      if (t < 1) frame = requestAnimationFrame(step)
      else setPhase('exit')
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [phase])

  useEffect(() => {
    if (phase !== 'exit') return
    const timer = setTimeout(() => setPhase('done'), prefersReducedMotion() ? 200 : EXIT_MS)
    return () => clearTimeout(timer)
  }, [phase])

  // Skippable from the first frame: nobody should have to sit through an
  // intro to reach their own dashboard.
  useEffect(() => {
    if (phase !== 'run') return
    const skip = () => setPhase('exit')
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [phase])

  if (phase === 'done') return null

  const link =
    preview ? 'PREVIEW'
      : connection === 'online' ? 'ESTABLISHED'
        : connection === 'connecting' || connection === 'idle' ? 'NEGOTIATING'
          : 'OFFLINE'

  const log: { at: number; text: string; status?: string; tone?: string }[] = [
    { at: 3, text: 'SYSTEM BOOT SEQUENCE INITIATED' },
    { at: 20, text: 'CALIBRATING DESKTOP ENVIRONMENT' },
    { at: 40, text: 'NEURAL CORE', status: 'ONLINE', tone: 'ok' },
    { at: 62, text: 'SECURE AGENT LINK', status: link, tone: link === 'OFFLINE' ? 'warn' : 'ok' },
  ]

  const roster = AGENTS.filter((a) => a.id !== 'paradox').map((a) => a.name)

  return (
    <div
      className="boot"
      data-phase={phase}
      // A static name: a live region whose label changed every percent would
      // have a screen reader announce the count a hundred times.
      role="status"
      aria-label="Paradox is starting"
      onClick={() => phase === 'run' && setPhase('exit')}
    >
      <div className="boot__grid" aria-hidden="true" />
      <div className="boot__scan" aria-hidden="true" />

      {/* ------------------------------------------------ left instrument -- */}
      <aside className="boot__side boot__side--left" aria-hidden="true">
        <div className="boot__rail" style={d(0.1)}>
          <span className="boot__play">▶</span>
          <i className="boot__bar boot__bar--solid" />
          <i className="boot__blocks"><b /><b /><b /><b /></i>
          <i className="boot__bar boot__bar--hatch" />
          <span className="boot__play">▶</span>
        </div>
        <span className="boot__label boot__label--right" style={d(0.3)}>ANALYSIS</span>

        <div className="boot__dial" style={d(0.25)}>
          <BigRing />
          <span className="boot__num boot__num--a">{fmt(78_844_881, pct)}</span>
          <span className="boot__num boot__num--b">{fmt(197_112_471, pct)}</span>
          <span className="boot__num boot__num--c">{fmt(667_222_338, pct)}</span>
        </div>

        <i className="boot__bar boot__bar--hatch boot__bar--wide" style={d(0.5)} />
        <Readout rows={9} seed={3} style={d(0.6)} />

        <div className="boot__coord" style={d(0.7)}>
          <i className="boot__bar boot__bar--hatch" />
          <span>XA : 215.111.{Math.round(pct / 9)}</span>
        </div>
        <span className="boot__label" style={d(0.75)}>125.022.1253.{250 + Math.round(pct / 40)}</span>

        <div className="boot__gauges" style={d(0.85)}>
          {[13, 19, 23, 28, 11, 20, 19].map((v, i) => (
            <Gauge key={i} value={Math.round((v * pct) / 100)} />
          ))}
        </div>

        <div className="boot__lower" style={d(1)}>
          <SmallRing />
          <Wave />
        </div>
      </aside>

      {/* -------------------------------------------------------- centre -- */}
      <main className="boot__center">
        <svg className="boot__frame" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
          <path className="boot__draw" style={d(0.15)}
                d="M 40 6 H 6 V 554 H 40 M 960 6 H 994 V 554 H 960" />
          <path className="boot__draw boot__draw--dim" style={d(0.4)}
                d="M 110 554 H 330" />
        </svg>

        <WorldMap />

        <div className="boot__corner boot__corner--tl" style={d(0.3)}>
          {log.map((line) =>
            pct >= line.at ? (
              <div key={line.text} className="boot__log">
                <span className="boot__caret">&gt;</span> {line.text}
                {line.status ? (
                  <>
                    <span className="boot__dots"> ........... </span>
                    <span className="boot__status" data-tone={line.tone}>{line.status}</span>
                  </>
                ) : null}
              </div>
            ) : null,
          )}
        </div>

        <div className="boot__corner boot__corner--tr" style={d(0.45)}>
          <div>PARADOX OS // v{version ?? '—'}</div>
          <div>STATUS // {pct < 100 ? 'BOOTING' : 'READY'}</div>
        </div>

        <div className="boot__title">
          <div className="boot__rule" style={d(0.6)}><i /><b /><i /></div>
          <h1 className="boot__name" style={d(0.8)}>PARADOX</h1>
          <div className="boot__sub" style={d(1.1)}>INITIALIZING AGENT</div>
          <div className="boot__progress" style={d(1.2)}>
            <span className="boot__track">
              <b style={{ width: `${pct}%` }} />
            </span>
            <span className="boot__pct">{pct}%</span>
          </div>
          <p className="boot__tag" style={d(1.5)}>YOUR DESKTOP, UNDER COMMAND.</p>
        </div>

        <div className="boot__corner boot__corner--bl" style={d(0.9)}>
          <div>AGENTS // {roster.join(' · ')}</div>
          <div>MODE // COMMAND CENTRE</div>
        </div>

        <div className="boot__corner boot__corner--br" style={d(1)}>
          {pct < 100 ? 'INITIALIZING' : 'READY'}<span className="boot__ellipsis">...</span>
        </div>
      </main>

      {/* ---------------------------------------------- right instrument -- */}
      <aside className="boot__side boot__side--right" aria-hidden="true">
        <Readout rows={7} seed={7} style={d(0.4)} />
        <Readout rows={6} seed={11} style={d(0.6)} />
        <div className="boot__tiles" style={d(0.7)}>
          {Array.from({ length: 16 }, (_, i) => <i key={i} data-on={pct > i * 6} />)}
        </div>
        <SmallRing variant="red" />
        <div className="boot__gauges boot__gauges--3" style={d(1)}>
          {[9, 4, 5].map((v, i) => <Gauge key={i} value={Math.round((v * pct) / 100)} />)}
        </div>
      </aside>

      {/* ------------------------------------------------------- footer -- */}
      <footer className="boot__foot" aria-hidden="true" style={d(0.9)}>
        <div className="boot__conn">
          <span>CONNECTION</span>
          <i className="boot__bar boot__bar--hatch" />
          <span className="boot__conn-sub">NETWORK STABILITY</span>
        </div>
        <i className="boot__bar boot__bar--hatch boot__bar--mid" />
        <span className="boot__ip">201.105.213.{40 + Math.round(pct / 25)}.1</span>
        <div className="boot__gauges boot__gauges--foot">
          {[13, 19, 23, 26, 11, 20, 12].map((v, i) => (
            <Gauge key={i} value={Math.round((v * pct) / 100)} />
          ))}
        </div>
      </footer>

      <span className="boot__skip" aria-hidden="true">PRESS ANY KEY TO SKIP</span>
    </div>
  )
}

/** Stagger an element's entrance by `s` seconds. */
function d(s: number): CSSProperties {
  return { ['--d' as string]: `${s}s` }
}

/** A counter that runs up with the boot rather than sitting still. */
function fmt(target: number, pct: number): string {
  return Math.round(target * (0.35 + 0.65 * (pct / 100))).toLocaleString('en-US')
}

/* ----------------------------------------------------------- pieces -- */

/** The dotted map behind the title. Memoised: ~1500 dots, drawn once. */
const WorldMap = memo(function WorldMap() {
  const dots = useMemo(() => worldDots(1.35), [])
  return (
    <svg className="boot__map" viewBox="0 0 120 62" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.46" />
      ))}
    </svg>
  )
})

/** The large analysis dial: counter-rotating arcs, a tick ring, a sweep. */
const BigRing = memo(function BigRing() {
  return (
    <svg className="boot__ring" viewBox="0 0 200 200">
      <g className="boot__spin boot__spin--slow">
        <circle cx="100" cy="100" r="86" className="boot__arc" strokeDasharray="120 30 60 40 180 110" />
      </g>
      <g className="boot__spin boot__spin--rev">
        <circle cx="100" cy="100" r="76" className="boot__ticks" />
      </g>
      <g className="boot__spin boot__spin--mid">
        <circle cx="100" cy="100" r="81" className="boot__arc boot__arc--red" strokeDasharray="70 440" />
      </g>
      <circle cx="100" cy="100" r="58" className="boot__thin" />
      <g className="boot__spin boot__spin--fast">
        <circle cx="100" cy="100" r="44" className="boot__arc boot__arc--thin" strokeDasharray="40 20 90 26 50 50" />
      </g>
      <circle cx="100" cy="100" r="28" className="boot__thin" />
      <path d="M 100 60 V 140 M 60 100 H 140" className="boot__cross" />
      {/* The invisible circle gives the group the dial's full bounding box,
          so fill-box rotation turns the hand about the dial's centre rather
          than about the midpoint of the line itself. */}
      <g className="boot__spin boot__spin--sweep">
        <circle cx="100" cy="100" r="86" fill="none" stroke="none" />
        <path d="M 100 100 L 100 14" className="boot__sweep" />
      </g>
      <circle cx="100" cy="100" r="2.4" className="boot__dot" />
      <path d="M 138 34 L 166 20 L 190 70 L 158 82 Z" className="boot__wedge" />
      <path d="M 40 150 L 22 172 L 60 196 L 74 170 Z" className="boot__wedge" />
    </svg>
  )
})

const SmallRing = memo(function SmallRing({ variant }: { variant?: 'red' }) {
  return (
    <svg className="boot__ring boot__ring--small" data-variant={variant} viewBox="0 0 120 120">
      <g className="boot__spin boot__spin--slow">
        <circle cx="60" cy="60" r="52" className="boot__arc" strokeDasharray="60 22 90 30 80 45" />
      </g>
      <g className="boot__spin boot__spin--rev">
        <circle cx="60" cy="60" r="42" className="boot__ticks boot__ticks--small" />
      </g>
      <g className="boot__spin boot__spin--mid">
        <circle cx="60" cy="60" r="47" className="boot__arc boot__arc--red" strokeDasharray="36 260" />
      </g>
      <circle cx="60" cy="60" r="26" className="boot__thin boot__thin--bright" />
    </svg>
  )
})

function Gauge({ value }: { value: number }) {
  const c = 2 * Math.PI * 13
  return (
    <svg className="boot__gauge" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="13" className="boot__gauge-track" />
      <circle cx="18" cy="18" r="13" className="boot__gauge-val"
              strokeDasharray={`${(c * Math.min(value, 100)) / 100} ${c}`} />
      <text x="18" y="20.5" textAnchor="middle">{value}%</text>
    </svg>
  )
}

/** The oscilloscope strip under the small ring. */
const Wave = memo(function Wave() {
  return (
    <div className="boot__wave">
      {Array.from({ length: 36 }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(i % 9) * -0.11}s`, height: `${20 + ((i * 37) % 60)}%` }} />
      ))}
    </div>
  )
})

/**
 * A block of small monospace telemetry. Deterministic from its seed so it
 * does not reshuffle on every progress tick — it only reveals line by line.
 */
const Readout = memo(function Readout({ rows, seed, style }: { rows: number; seed: number; style?: CSSProperties }) {
  const lines = useMemo(() => {
    let s = seed * 9301 + 49297
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    const hex = () => Math.floor(rnd() * 0xffff).toString(16).padStart(4, '0')
    return Array.from({ length: rows }, () =>
      `${hex()} ${hex()}  ${Math.floor(rnd() * 999).toString().padStart(3, '0')}.${hex()}  ${rnd() > 0.5 ? 'OK' : 'SYNC'}`,
    )
  }, [rows, seed])
  return (
    <div className="boot__readout" style={style}>
      {lines.map((line, i) => (
        <div key={i} style={{ animationDelay: `calc(var(--d, 0s) + ${i * 0.09}s)` }}>{line}</div>
      ))}
    </div>
  )
})
