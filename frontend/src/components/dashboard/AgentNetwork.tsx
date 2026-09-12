import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * The four words under the core title are not decoration — each maps to a
 * real signal already in the store (see PHASES below and how `learnAt` is
 * set). "Learn" specifically: the backend records every task to memory in
 * its `finally` block regardless of outcome, so lighting it up right after a
 * task succeeds is describing something that is actually happening then, not
 * an invented fourth beat.
 */
const PHASE_WORDS = ['THINK', 'COORDINATE', 'EXECUTE', 'LEARN'] as const

const LIVE_TASK: Task['status'][] = ['planning', 'running', 'awaiting_confirmation']

export function AgentNetwork() {
  const agents = useSession((s) => s.agents)
  const tasks = useSession((s) => s.tasks)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const setView = useSession((s) => s.setView)

  // The callout above the Core only ever shows a task that is genuinely in
  // flight right now — never the last-known task once it's settled, and
  // never placeholder text. When nothing is running it simply isn't there.
  const liveTask = tasks.find((t) => t.id === activeTaskId && LIVE_TASK.includes(t.status))

  // The reference lists these four, in this order.
  const shown = ['orion', 'zeno', 'luna', 'nova']
    .map((id) => AGENTS.find((a) => a.id === id))
    .filter((a): a is AgentDef => Boolean(a))

  const cardsRef = useRef<HTMLDivElement>(null)
  const linksRef = useRef<SVGSVGElement>(null)
  const [wires, setWires] = useState<Wires>({ w: 104, h: 260, ys: [] })

  /**
   * The connectors are measured rather than assumed. Card height moves with the
   * font and with the panel's own height, so coordinates written by hand drift
   * out of line with the dots they are supposed to leave from.
   */
  useLayoutEffect(() => {
    const cards = cardsRef.current
    const svg = linksRef.current
    if (!cards || !svg) return

    const measure = () => {
      const base = svg.getBoundingClientRect()
      if (!base.height) return
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
  }, [shown.length])

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
    <section className="panel net">
      <header className="panel__head">
        <Network size={14} />
        <span className="section-title">AGENT NETWORK</span>
        <button type="button" className="panel__action" onClick={() => setView('agents')}
                title="See all agents">
          <Plus size={13} />
        </button>
      </header>

      <div className="net__body">
        <div className="net__cards" ref={cardsRef}>
          {shown.map((agent) => (
            <AgentCard key={agent.id} def={agent} state={agents[agent.id].state} />
          ))}
        </div>

        <svg ref={linksRef} className="net__links" viewBox={`0 0 ${wires.w} ${wires.h}`}>
          {wires.ys.map((y, i) => {
            const agent = shown[i]
            if (!agent) return null
            const live = LIVE.includes(agents[agent.id].state)
            // Cable routing, as in the reference: a short run out of the
            // card, one smooth S-bend across the gap, then a run into the
            // core's edge. Each cable leaves its own column so the four
            // bends stay separate instead of overlapping into a bundle.
            const end = wires.h / 2 + (i - (wires.ys.length - 1) / 2) * 15
            const x1 = 16 + i * 6
            const x2 = wires.w - 14
            const k = (x2 - x1) * 0.5
            const d = `M 0 ${y} H ${x1} C ${x1 + k} ${y}, ${x2 - k} ${end}, ${x2} ${end}`
              + ` H ${wires.w}`
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
        <span className="acard2__name">{def.role.replace(' Agent', '').toUpperCase()} AGENT</span>
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
