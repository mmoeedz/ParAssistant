import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Gauge,
  ListChecks,
  Minus,
  Newspaper,
  Target,
} from 'lucide-react'
import { useSession } from '@/store/session'
import { useFps } from '@/hooks/useFps'
import { AGENTS } from '@/types/agents'
import { statusLabel } from './panels'
import { ARCS, NODES, TONE_VAR, arcPath, worldDots } from './world'
import './dashboard.css'

/* ------------------------------------------------------- system overview -- */

const RING = 27
const CIRC = 2 * Math.PI * RING

function Ring({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  const pct = value ?? 0
  return (
    <div className="ring">
      <svg viewBox="0 0 72 72" className="ring__svg">
        <circle cx="36" cy="36" r={RING} className="ring__track" />
        <circle
          cx="36"
          cy="36"
          r={RING}
          className="ring__value"
          stroke={tone}
          strokeDasharray={`${(CIRC * pct) / 100} ${CIRC}`}
        />
      </svg>
      <div className="ring__label">
        <span className="ring__pct">{value === null ? '—' : `${Math.round(pct)}%`}</span>
      </div>
      <span className="ring__name">{label}</span>
    </div>
  )
}

/** A rolling window of CPU samples — real history, not a decorative squiggle. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div className="spark spark--empty" />
  }
  const width = 320
  const height = 42
  const step = width / (points.length - 1)
  const path = points
    .map((value, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${height - (value / 100) * height}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="spark" preserveAspectRatio="none">
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} className="spark__fill" />
      <path d={path} className="spark__line" />
    </svg>
  )
}

/**
 * Bounded rolling history of a live value, for a card's own mini sparkline
 * and trend. Nulls (value not available yet) are skipped rather than
 * plotted as zero.
 *
 * `tick` is what actually triggers a push — for FPS and latency the value
 * itself changes on close to every reading, so it can serve as its own tick.
 * CPU/GPU temperature come from a backend cache that only refreshes every
 * few seconds and re-sends the same number across several broadcasts in
 * between; keying off the value there would silently drop every repeat and
 * leave the trend stuck on "no data yet" during a genuinely flat stretch.
 * Passing the stats frame's own timestamp as `tick` records "sampled again,
 * still flat" as a real, honest point instead.
 */
function useHistory(value: number | null, tick: unknown = value, limit = 24): number[] {
  const [history, setHistory] = useState<number[]>([])
  useEffect(() => {
    if (value === null) return
    setHistory((prev) => [...prev, value].slice(-limit))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick, not value, decides when to sample
  }, [tick, limit])
  return history
}

/** Auto-scaled to its own window — this is a trend, not a percentage gauge. */
function MiniSpark({ points, color }: { points: number[]; color: string }) {
  const width = 56
  const height = 20
  if (points.length < 2) {
    return <svg viewBox={`0 0 ${width} ${height}`} className="mspark" aria-hidden="true" />
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const path = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mspark" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={color} className="mspark__fill" />
      <path d={path} stroke={color} fill="none" className="mspark__line" />
    </svg>
  )
}

interface MetricCardProps {
  value: string
  unit: string
  history: number[]
  /** 'percent' for a scale-free metric like FPS; 'unit' appends deltaUnit. */
  deltaFormat: 'percent' | 'unit'
  deltaUnit?: string
  color: string
  title: string
}

/**
 * One-step change — the latest real sample against the one before it.
 *
 * The value and its graph share this card's own accent colour, but the
 * delta is a judgement about direction, not identity — rising is green and
 * falling is red on every card, the same convention regardless of which
 * metric it is. There is no separate caption line, so the title attribute
 * is what discloses exactly what is being measured on hover.
 */
function MetricCard({ value, unit, history, deltaFormat, deltaUnit = '', color, title }: MetricCardProps) {
  const previous = history[history.length - 2]
  const latest = history[history.length - 1]
  const diff = previous !== undefined ? latest - previous : null
  // Genuinely unchanged is its own state — defaulting a zero diff to "up"
  // would claim a rising trend for a metric that has not moved.
  const trend: 'up' | 'down' | 'flat' | null = diff === null ? null : diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'

  const deltaText =
    diff === null
      ? null
      : deltaFormat === 'percent'
        ? `${trend === 'up' ? '+' : ''}${((diff / (previous || 1)) * 100).toFixed(1)}%`
        : `${trend === 'up' ? '+' : ''}${diff.toFixed(deltaUnit === 'ms' ? 0 : 1)}${deltaUnit}`

  return (
    <div className="mcard" style={{ ['--tone' as string]: color }} title={title}>
      <div className="mcard__top">
        <div className="mcard__value">
          {value}
          {value !== '—' ? <span className="mcard__unit">{unit}</span> : null}
        </div>
        <MiniSpark points={history} color={color} />
      </div>
      <div className="mcard__delta" data-trend={trend ?? 'none'}>
        {trend === null ? (
          '—'
        ) : (
          <>
            {trend === 'up' ? (
              <ArrowUp size={10} />
            ) : trend === 'down' ? (
              <ArrowDown size={10} />
            ) : (
              <Minus size={10} />
            )}
            {deltaText}
          </>
        )}
      </div>
    </div>
  )
}

export function SystemOverview() {
  const stats = useSession((s) => s.stats)
  const latencyMs = useSession((s) => s.latencyMs)
  const history = useRef<number[]>([])
  // This interface's own render rate — see the hook for why that, and not a
  // fabricated "system FPS", is the honest thing to show here.
  const fps = useFps()

  if (stats) {
    const last = history.current[history.current.length - 1]
    if (last !== stats.cpu || history.current.length === 0) {
      history.current = [...history.current, stats.cpu].slice(-48)
    }
  }

  const fpsHistory = useHistory(fps)
  const cpuTempHistory = useHistory(stats?.cpuTempC ?? null, stats?.capturedAt)
  const gpuTempHistory = useHistory(stats?.gpuTempC ?? null, stats?.capturedAt)
  const latencyHistory = useHistory(latencyMs)

  return (
    <section className="panel">
      <header className="panel__head">
        <Gauge size={14} />
        <span className="section-title">SYSTEM OVERVIEW</span>
      </header>
      <div className="panel__body">
        <div className="rings">
          <Ring label="CPU" value={stats?.cpu ?? null} tone="var(--accent)" />
          <Ring label="RAM" value={stats?.memory.percent ?? null} tone="var(--accent)" />
          <Ring label="GPU" value={stats?.gpu ?? null} tone="var(--accent)" />
          <Ring label="DISK" value={stats?.disk.percent ?? null} tone="var(--accent)" />
        </div>
        <Sparkline points={history.current} />

        <div className="mgrid">
          <MetricCard
            value={fps === null ? '—' : String(fps)}
            unit="FPS"
            history={fpsHistory}
            deltaFormat="percent"
            color="var(--metric-fps)"
            title="This interface's own render rate — there is no single Windows-wide FPS to read"
          />
          <MetricCard
            value={stats?.cpuTempC !== undefined ? stats.cpuTempC.toFixed(1) : '—'}
            unit="°c"
            history={cpuTempHistory}
            deltaFormat="unit"
            deltaUnit="°"
            color="var(--metric-cpu)"
            title="CPU — hottest thermal zone this machine exposes"
          />
          <MetricCard
            value={stats?.gpuTempC !== undefined ? stats.gpuTempC.toFixed(1) : '—'}
            unit="°c"
            history={gpuTempHistory}
            deltaFormat="unit"
            deltaUnit="°"
            color="var(--metric-gpu)"
            title="GPU — hottest thermal zone this machine exposes"
          />
          <MetricCard
            value={latencyMs === null ? '—' : String(Math.round(latencyMs))}
            unit="ms"
            history={latencyHistory}
            deltaFormat="unit"
            deltaUnit="ms"
            color="var(--metric-latency)"
            title="Latency — round-trip time to the agent process, timed on a plain ping/pong"
          />
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------- current task -- */

export function CurrentTaskCard() {
  const tasks = useSession((s) => s.tasks)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const setView = useSession((s) => s.setView)

  const task = tasks.find((t) => t.id === activeTaskId) ?? tasks[tasks.length - 1] ?? null
  const live = Boolean(activeTaskId)

  const settled = task
    ? task.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
    : 0
  const pct = !task
    ? 0
    : task.status === 'succeeded'
      ? 100
      : Math.round((settled / Math.max(task.steps.length, 1)) * 100)

  const owner = task?.steps.length
    ? AGENTS.find((a) => a.tools.includes(task.steps[task.steps.length - 1].tool ?? ''))
    : undefined

  return (
    <section className="panel">
      <header className="panel__head">
        <ListChecks size={14} />
        <span className="section-title">CURRENT TASK</span>
      </header>
      <div className="panel__body">
        {!task ? (
          <p className="panel__blank">
            Nothing running. Ask for something and the steps appear here as they happen.
          </p>
        ) : (
          <button type="button" className="taskcard" onClick={() => setView('command')}>
            <span className="taskcard__icon" data-live={live}>
              <Target size={15} />
            </span>
            <span className="taskcard__text">
              <span className="taskcard__goal">{task.goal}</span>
              <span className="taskcard__who">{owner?.role ?? 'Paradox Core'}</span>
            </span>
            <span className="taskcard__pill" data-state={task.status}>
              {live ? 'In Progress' : statusLabel(task.status)}
            </span>
          </button>
        )}

        {task ? (
          <div className="taskprog">
            <div className="taskcard__bar">
              <span style={{ width: `${pct}%` }} data-state={task.status} />
            </div>
            <b>{pct}%</b>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/* --------------------------------------------------------- global activity -- */

const DOTS = worldDots()

export function GlobalActivity() {
  const agents = useSession((s) => s.agents)
  const tasks = useSession((s) => s.tasks)
  const console_ = useSession((s) => s.console)
  const setView = useSession((s) => s.setView)

  const active = AGENTS.filter((a) => agents[a.id].state !== 'standby').length
  const running = tasks.filter((t) => !t.endedAt).length
  const errors = console_.filter((l) => l.level === 'error').length
  const requests = Object.values(agents).reduce((sum, a) => sum + a.runs, 0)

  return (
    <section className="panel">
      <header className="panel__head">
        <Activity size={14} />
        <span className="section-title">GLOBAL ACTIVITY</span>
        <button type="button" className="panel__action" onClick={() => setView('command')}>
          <span className="live-dot" /> Live <ArrowRight size={11} />
        </button>
      </header>

      <div
        className="panel__body"
        title="Node positions are illustrative; a node lights when its agent is actually working."
      >
        <div className="map">
          {/* Cropped to the inhabited band, as the reference frames it. */}
          <svg viewBox="0 3 120 52" className="map__svg">
            <defs>
              <filter id="mapGlow" x="-200%" y="-200%" width="500%" height="500%">
                <feGaussianBlur stdDeviation="1.1" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {DOTS.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="0.5" className="map__dot" />
            ))}

            {ARCS.map((arc, i) => {
              const on = agents[arc.agent].state !== 'standby'
              return (
                <path
                  key={i}
                  d={arcPath(NODES[arc.from], NODES[arc.to], arc.bow)}
                  className="map__arc"
                  data-on={on}
                  stroke={TONE_VAR[arc.tone]}
                />
              )
            })}

            {NODES.map((node, i) => {
              const on = agents[node.agent].state !== 'standby'
              const tone = TONE_VAR[node.tone]
              return (
                <g key={i} className="map__node" data-on={on}>
                  {node.size >= 1.5 ? (
                    <line
                      className="map__beam"
                      x1={node.x}
                      y1={node.y}
                      x2={node.x}
                      y2={node.y - node.size * 5.5}
                      stroke={tone}
                      strokeWidth={node.size * 0.7}
                      filter="url(#mapGlow)"
                      style={{ animationDelay: `${(i % 5) * 0.4}s` }}
                    />
                  ) : null}
                  <circle cx={node.x} cy={node.y} r={node.size * 2.1} fill={tone}
                          className="map__halo" />
                  <circle cx={node.x} cy={node.y} r={node.size} fill={tone}
                          filter="url(#mapGlow)" style={{ animationDelay: `${(i % 7) * 0.3}s` }} />
                </g>
              )
            })}
          </svg>
        </div>

        <div className="stats4">
          <Stat value={requests} label="Requests" />
          <Stat value={active} label="Active Agents" tone="var(--accent)" />
          <Stat value={running} label="Running" tone="var(--warn)" />
          <Stat value={errors} label="Errors" tone={errors ? 'var(--danger)' : undefined} />
        </div>
      </div>
    </section>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="stat">
      <div className="stat__value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

/* -------------------------------------------------------------- headlines -- */

function ago(ts: number | null): string {
  if (!ts) return ''
  const hours = Math.round((Date.now() - ts) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const SOURCE_TONE = ['var(--warn)', 'var(--danger)', 'var(--accent)', 'var(--a-luna)']

export function Headlines() {
  const items = useSession((s) => s.headlines)
  const connection = useSession((s) => s.connection)
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items.slice(0, 12) : items.slice(0, 4)

  return (
    <section className="panel">
      <header className="panel__head">
        <Newspaper size={14} />
        <span className="section-title">TODAY'S HEADLINES</span>
        {items.length > 4 ? (
          <button type="button" className="panel__action" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Less' : 'See All'} <ArrowRight size={11} />
          </button>
        ) : null}
      </header>
      <div className="panel__body">
        {shown.length === 0 ? (
          <p className="panel__blank">
            {connection === 'online'
              ? 'No headlines came back — the feeds may be unreachable.'
              : 'Headlines are fetched by the agent, which is offline.'}
          </p>
        ) : (
          <ul className="news">
            {shown.map((item, i) => (
              <li key={item.url || item.title}>
                <a href={item.url} target="_blank" rel="noreferrer" title={`${item.source} — open`}>
                  <span className="news__dot" style={{ background: SOURCE_TONE[i % 4] }} />
                  <span className="news__title">{item.title}</span>
                  <span className="news__time">{ago(item.publishedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Keeps the CPU sparkline moving even when the panel is not re-rendered. */
export function useTick(ms = 1000) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}
