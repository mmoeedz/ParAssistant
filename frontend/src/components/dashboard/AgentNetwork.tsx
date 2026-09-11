import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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

/** A fixed particle field for the core — deterministic, so it never re-shuffles. */
function coreParticles(count = 220) {
  const points: { x: number; y: number; r: number; o: number }[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2
    const radius = Math.sqrt(1 - y * y)
    const theta = golden * i
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    const depth = (z + 1) / 2
    points.push({
      x: 50 + x * 42,
      y: 50 + y * 42,
      r: 0.5 + depth * 0.9,
      o: 0.18 + depth * 0.8,
    })
  }
  return points
}

interface Wires {
  w: number
  h: number
  ys: number[]
}

export function AgentNetwork() {
  const agents = useSession((s) => s.agents)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const setView = useSession((s) => s.setView)

  const particles = useMemo(() => coreParticles(), [])
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
  const online = AGENTS.filter((a) => a.id !== 'nexus').length
  const busy = LIVE.includes(agents.nexus.state) || shown.some((a) => LIVE.includes(agents[a.id].state))

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
            // Circuit routing, as in the reference: a run out of the card, one
            // diagonal, then a parallel run into the core's edge. The ends are
            // staggered so the four lines bundle instead of crossing.
            const end = wires.h / 2 + (i - (wires.ys.length - 1) / 2) * 16
            const turn = Math.min(24 + Math.abs(end - y), wires.w - 16)
            return (
              <path
                key={agent.id}
                d={`M 0 ${y} H 24 L ${turn} ${end} H ${wires.w}`}
                className="net__link"
                data-live={live}
                stroke={agent.color}
              />
            )
          })}
        </svg>

        <div className="core" data-busy={busy}>
          <div className="core__head">
            <div className="core__title">NEXUS CORE</div>
            <div className="core__words">
              <span>THINK</span>
              <span>COORDINATE</span>
              <span>EXECUTE</span>
              <span>LEARN</span>
            </div>
          </div>

          <svg viewBox="0 0 100 100" className="core__sphere">
            <defs>
              <radialGradient id="coreHalo">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
                <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.08" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="46" fill="url(#coreHalo)" className="core__halo" />
            <g className="core__spin">
              {particles.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="var(--accent)" opacity={p.o} />
              ))}
            </g>
            <circle cx="50" cy="50" r="3.2" fill="var(--accent-hi)" className="core__heart" />
          </svg>

          <div className="core__foot">
            <span className="core__pill">
              {online} AGENTS ONLINE
              {activeTaskId ? ' · WORKING' : ''}
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
          <i className="acard2__dot" data-live={live} />
          {statusText(state)}
        </span>
      </span>
      <span className="acard2__edge" />
    </button>
  )
}
