import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, Gauge, ListChecks, Newspaper, Target } from 'lucide-react'
import { useSession } from '@/store/session'
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

export function SystemOverview() {
  const stats = useSession((s) => s.stats)
  const history = useRef<number[]>([])

  if (stats) {
    const last = history.current[history.current.length - 1]
    if (last !== stats.cpu || history.current.length === 0) {
      history.current = [...history.current, stats.cpu].slice(-48)
    }
  }

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
