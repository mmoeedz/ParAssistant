import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  Eye,
  FolderOpen,
  Globe,
  type LucideIcon,
  MessageSquare,
  Mic,
  Monitor,
  Network,
  Plus,
  Brain,
} from 'lucide-react'
import { useSession } from '@/store/session'
import { AGENTS, type AgentDef, type AgentState } from '@/types/agents'
import type { Task } from '@/types/protocol'
import { CoreOrb, type CorePhase } from './CoreOrb'
import './dashboard.css'

const ICONS: Record<string, LucideIcon> = {
  orion: Globe,
  zeno: Monitor,
  luna: MessageSquare,
  nova: Eye,
  axel: FolderOpen,
  aria: Mic,
  kai: Brain,
}

const LIVE: AgentState[] = ['waking', 'walking', 'working', 'thinking', 'handoff']

function statusText(state: AgentState): string {
  if (state === 'standby' || state === 'returning' || state === 'completed') return 'Idle'
  if (state === 'working' || state === 'walking' || state === 'waking') return 'Working'
  if (state === 'thinking') return 'Thinking'
  if (state === 'waiting') return 'Waiting'
  if (state === 'blocked') return 'Blocked'
  return 'Error'
}

interface Wires {
  w: number
  h: number
  ys: number[]
}

/**
 * The two rails, and who sits on each.
 *
 * Six of the seven agents, three a side, with the Core between them — the
 * arrangement the network is drawn as. The split is declared here rather than
 * derived from the roster order so that adding an agent is a deliberate
 * decision about which side it belongs on, not a silent reflow of both rails.
 */
const LEFT_IDS = ['orion', 'zeno', 'luna'] as const
const RIGHT_IDS = ['axel', 'aria', 'nova'] as const

function railOf(ids: readonly string[]): AgentDef[] {
  return ids.map((id) => AGENTS.find((a) => a.id === id)).filter((a): a is AgentDef => Boolean(a))
}

/**
 * The four words under the core title are not decoration — each maps to a
 * real signal already in the store (see PHASES below and how `learnAt` is
 * set). "Learn" specifically: the backend records every task to memory in
 * its `finally` block regardless of outcome, so lighting it up right after a
 * task succeeds is describing something that is actually happening then, not
 * an invented fourth beat.
 */
const PHASE_WORDS = ['THINK', 'COORDINATE', 'EXECUTE', 'LEARN'] as const

const LIVE_TASK: Task['status'][] = ['planning', 'running', 'awaiting_confirmation']

/**
 * Measure one rail's cables.
 *
 * The connectors are measured rather than assumed. Card height moves with the
 * font, with the panel's own height and with which layout the container query
 * picked, so coordinates written by hand drift out of line with the dots they
 * are supposed to leave from. Observing the cards, the SVG and each individual
 * card means a relayout of any kind — a window resize, the rail switching from
 * three rows to a stacked grid, a font finishing loading — recomputes the
 * geometry from what is actually on screen.
 */
function useWires(
  cardsRef: RefObject<HTMLDivElement | null>,
  svgRef: RefObject<SVGSVGElement | null>,
  count: number,
): Wires {
  const [wires, setWires] = useState<Wires>({ w: 92, h: 260, ys: [] })

  useLayoutEffect(() => {
    const cards = cardsRef.current
    const svg = svgRef.current
    if (!cards || !svg) return

    const measure = () => {
      const base = svg.getBoundingClientRect()
      // Zero height means the cables are display:none in the current layout
      // (see the container queries in dashboard.css) — nothing to measure,
      // and the last good geometry is kept rather than zeroed.
      if (!base.height || !base.width) return
      // Divide out any transform on an ancestor, so the viewBox stays in the
      // element's own CSS pixels whatever the panel is scaled by.
      const scale = svg.clientWidth ? base.width / svg.clientWidth : 1
      const w = Math.round(base.width / scale)
      const h = Math.round(base.height / scale)
      const ys = Array.from(cards.children, (el) => {
        const r = el.getBoundingClientRect()
        return Math.round((r.top + r.height / 2 - base.top) / scale)
      })
      setWires((prev) =>
        prev.w === w && prev.h === h && sameYs(prev.ys, ys) ? prev : { w, h, ys },
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(cards)
    observer.observe(svg)
    for (const card of cards.children) observer.observe(card)
    return () => observer.disconnect()
  }, [cardsRef, svgRef, count])

  return wires
}

/**
 * One side of the network: a rail of agent cards and the cables joining them
 * to the Core. Renders both as siblings so they land in their own grid
 * columns of .net__body, in the order that side needs them.
 */
function Rail({
  side,
  defs,
  agents,
}: {
  side: 'left' | 'right'
  defs: AgentDef[]
  agents: Record<string, { state: AgentState }>
}) {
  const cardsRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wires = useWires(cardsRef, svgRef, defs.length)

  const cards = (
    <div className={`net__cards net__cards--${side}`} ref={cardsRef}>
      {defs.map((agent) => (
        <AgentCard key={agent.id} def={agent} state={agents[agent.id].state} />
      ))}
    </div>
  )

  const cables = (
    <svg
      ref={svgRef}
      className={`net__links net__links--${side}`}
      viewBox={`0 0 ${wires.w} ${wires.h}`}
      aria-hidden="true"
    >
      {wires.ys.map((y, i) => {
        const agent = defs[i]
        if (!agent) return null
        const live = LIVE.includes(agents[agent.id].state)
        // Cable routing: a short run out of the card, one smooth S-bend
        // across the gap, then a run into the Core's edge. Each cable leaves
        // its own column so the bends stay separate instead of overlapping
        // into a bundle, and the run-outs are a fraction of the column's
        // width rather than fixed pixels — on a narrow panel the gap can be
        // 26px, where a hardcoded 16px run-out would overshoot the bend and
        // double the cable back on itself.
        const w = wires.w
        const lead = Math.min(16, w * 0.3)
        const fan = Math.min(6, w * 0.06)
        const pad = Math.min(14, w * 0.25)
        const end = wires.h / 2 + (i - (wires.ys.length - 1) / 2) * 15
        const x1 = side === 'left' ? lead + i * fan : w - lead - i * fan
        const x2 = side === 'left' ? w - pad : pad
        const k = Math.abs(x2 - x1) * 0.5
        const c1 = side === 'left' ? x1 + k : x1 - k
        const c2 = side === 'left' ? x2 - k : x2 + k
        const from = side === 'left' ? 0 : w
        const to = side === 'left' ? w : 0
        const d = `M ${from} ${y} H ${x1} C ${c1} ${y}, ${c2} ${end}, ${x2} ${end} H ${to}`
        return (
          <g key={agent.id}>
            <path d={d} className="net__link" data-live={live} stroke={agent.color}
                  style={{ color: agent.color }} />
            <circle cx={x1} cy={y} r="2.1" fill={agent.color}
                    className="net__node" style={{ color: agent.color }} />
            {/* A real signal reaching the Core, not decoration: this only
                exists while the backend has reported that agent as live. */}
            {live ? (
              <circle r="1.1" fill={agent.color} className="net__spark"
                      style={{ color: agent.color }}>
                <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
              </circle>
            ) : null}
          </g>
        )
      })}
    </svg>
  )

  return side === 'left' ? (
    <>
      {cards}
      {cables}
    </>
  ) : (
    <>
      {cables}
      {cards}
    </>
  )
}

export function AgentNetwork({ style }: { style?: CSSProperties } = {}) {
  const agents = useSession((s) => s.agents)
  const tasks = useSession((s) => s.tasks)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const setView = useSession((s) => s.setView)

  // The callout above the Core only ever shows a task that is genuinely in
  // flight right now — never the last-known task once it's settled, and
  // never placeholder text. When nothing is running it simply isn't there.
  const liveTask = tasks.find((t) => t.id === activeTaskId && LIVE_TASK.includes(t.status))

  const left = railOf(LEFT_IDS)
  const right = railOf(RIGHT_IDS)
  const shown = [...left, ...right]

  const online = AGENTS.filter((a) => a.id !== 'paradox').length
  const shownLive = shown.some((a) => LIVE.includes(agents[a.id].state))
  const busy = LIVE.includes(agents.paradox.state) || shownLive

  // ---- phase: which of think / coordinate / execute is true right now ----
  // Priority is deliberate: a shown agent actually running a tool ("execute")
  // is a stronger signal than the orchestrator's own book-keeping state.
  let phase: CorePhase = 'idle'
  if (shownLive) phase = 'executing'
  else if (agents.paradox.state === 'working') phase = 'coordinating'
  else if (agents.paradox.state === 'thinking') phase = 'thinking'

  // ---- learn: a brief window right after the most recent task succeeded ----
  const [learning, setLearning] = useState(false)
  const lastSeenTaskRef = useRef<{ id: string; status: string } | null>(null)
  useEffect(() => {
    const last = tasks[tasks.length - 1]
    if (!last) return
    const prev = lastSeenTaskRef.current
    if (last.status === 'succeeded' && (prev?.id !== last.id || prev.status !== 'succeeded')) {
      setLearning(true)
      const timer = setTimeout(() => setLearning(false), 2600)
      lastSeenTaskRef.current = { id: last.id, status: last.status }
      return () => clearTimeout(timer)
    }
    lastSeenTaskRef.current = { id: last.id, status: last.status }
  }, [tasks])

  // ---- one soft core pulse per task that just succeeded ----
  const [pulseKey, setPulseKey] = useState(0)
  useEffect(() => {
    if (learning) setPulseKey((k) => k + 1)
  }, [learning])

  const phaseIndex = phase === 'thinking' ? 0 : phase === 'coordinating' ? 1
    : phase === 'executing' ? 2 : learning ? 3 : -1

  return (
    <section className="panel net" style={style}>
      <header className="panel__head">
        <Network size={14} />
        <span className="section-title">AGENT NETWORK</span>
        <button type="button" className="panel__action" onClick={() => setView('agents')}
                title="See all agents">
          <Plus size={13} />
        </button>
      </header>

      <div className="net__body">
        <Rail side="left" defs={left} agents={agents} />

        <div className="core" data-busy={busy}>
          <div className="core__head">
            <div className="core__title">PARADOX CORE</div>

            {/* A stepper, not a caption: the words label the stages and the
                rail under them fills to whichever one is true right now. */}
            <div className="core__steps">
              <div className="core__steps-words">
                {PHASE_WORDS.map((word, i) => (
                  <span key={word} className="core__step-word"
                        data-state={i < phaseIndex ? 'done' : i === phaseIndex ? 'active' : 'pending'}>
                    {word}
                  </span>
                ))}
              </div>
              <div className="core__steps-rail">
                <i className="core__rail" />
                <i className="core__rail-fill"
                   style={{ width: `${Math.max(phaseIndex, 0) * (100 / (PHASE_WORDS.length - 1))}%` }} />
                {PHASE_WORDS.map((word, i) => (
                  <i key={word} className="core__step-dot"
                     data-state={i < phaseIndex ? 'done' : i === phaseIndex ? 'active' : 'pending'} />
                ))}
              </div>
            </div>
          </div>

          {/* What the Core is actually working on right now, in the user's own
              words — not a caption, so it disappears the moment nothing is
              live rather than freezing on the last thing asked. */}
          {liveTask ? (
            <div className="core__ask" key={liveTask.id}>
              <MessageSquare size={11} />
              <span className="core__ask-text">{liveTask.goal}</span>
            </div>
          ) : null}

          <CoreOrb phase={phase} pulseKey={pulseKey} />

          <div className="core__foot">
            <span className="core__pill">
              <i className="core__pill-dot" data-on={online > 0} />
              {online} AGENTS ONLINE
            </span>
          </div>
        </div>

        <Rail side="right" defs={right} agents={agents} />
      </div>
    </section>
  )
}

function sameYs(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function AgentCard({ def, state }: { def: AgentDef; state: AgentState }) {
  const setView = useSession((s) => s.setView)
  const Icon = ICONS[def.id] ?? Globe
  const live = LIVE.includes(state)

  return (
    <button
      type="button"
      className="acard2"
      data-live={live}
      style={{ ['--tone' as string]: def.color }}
      onClick={() => setView('agents')}
    >
      <span className="acard2__icon">
        <Icon size={17} />
      </span>
      <span className="acard2__text">
        {/* The role and the word AGENT are separate spans so the suffix can
            stand down on a narrow card (see dashboard.css). Every card in a
            panel titled AGENT NETWORK is an agent, so it is the one word
            here that carries no information — and dropping it is what keeps
            "COMMUNICATION" on a single readable line at 1366. */}
        <span className="acard2__name">
          <span className="acard2__role">{def.role.replace(' Agent', '').toUpperCase()}</span>
          <span className="acard2__suffix"> AGENT</span>
        </span>
        <span className="acard2__status">
          <span className="acard2__dot-wrap">
            <i className="acard2__pulse" data-live={live} />
            <i className="acard2__dot" data-live={live} />
          </span>
          {statusText(state)}
        </span>
      </span>
      {/* Four bars that only move while the backend has this agent live —
          idle they sit at their resting heights rather than miming work. */}
      <span className="acard2__act" data-live={live} aria-hidden="true">
        {[0.45, 0.85, 0.6, 1].map((tall, i) => (
          <i key={i} style={{ height: `${tall * 100}%`, animationDelay: `${i * 0.14}s` }} />
        ))}
      </span>
      <span className="acard2__edge" />
    </button>
  )
}
