import { useLayoutEffect, useRef, useState } from 'react'
import { Cpu, Maximize2, Monitor, Users } from 'lucide-react'
import { useSession } from '@/store/session'
import { AGENTS, type AgentDef, type AgentRuntime } from '@/types/agents'
import { FLOOR_BASE_H, TownFloor } from './TownFloor'
import './town.css'

/**
 * The Agent Town.
 *
 * The room is drawn — see TownFloor — in the reference artwork's coordinates
 * (790 x 350). Nobody is painted into it, so every person on screen is a real
 * agent: it walks from the lounge to its desk when it picks up work and back
 * when it is done, with its name tag following it. Nothing here animates
 * unless the backend reported a real tool call.
 */

const WORKING = new Set(['working', 'thinking', 'waiting', 'handoff'])

const TABS = ['AGENT TOWN', 'AGENTS', 'VISUAL HUB', 'GESTURE'] as const

/** The floor is 790 units wide; its height follows the panel it is given. */
const FLOOR_W = 790

export function AgentTown() {
  const agents = useSession((s) => s.agents)
  const stats = useSession((s) => s.stats)
  const backendInfo = useSession((s) => s.backendInfo)
  const setView = useSession((s) => s.setView)
  const [tab, setTab] = useState<(typeof TABS)[number]>('AGENT TOWN')
  const roomRef = useRef<HTMLDivElement>(null)
  const [floorH, setFloorH] = useState(FLOOR_BASE_H)

  /**
   * The floor keeps a fixed width and takes whatever height the panel has, so
   * the room fills it without stretching the drawing or cropping it.
   */
  useLayoutEffect(() => {
    const room = roomRef.current
    if (!room) return

    const measure = () => {
      const r = room.getBoundingClientRect()
      if (!r.width || !r.height) return
      const next = Math.round((FLOOR_W * r.height) / r.width)
      setFloorH((prev) => (Math.abs(prev - next) < 2 ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(room)
    return () => observer.disconnect()
  }, [])

  const roster = AGENTS.filter((a) => a.id !== 'nexus')
  const busy = roster.filter((a) => agents[a.id].state !== 'standby')
  const hasModel = backendInfo?.capabilities.includes('model-ready')

  return (
    <section className="panel town panel--grow">
      <header className="town__head">
        <Users size={14} />
        <div className="town__tabs">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              className="ttab2"
              data-active={tab === name}
              onClick={() => (name === 'AGENTS' ? setView('agents') : setTab(name))}
            >
              {name}
            </button>
          ))}
        </div>
        <span className="town__floor">Floor 1</span>
        <button type="button" className="iconbtn" onClick={() => setView('agents')}
                title="Open the agent list">
          <Maximize2 size={13} />
        </button>
      </header>

      <div className="town__stage">
        <div ref={roomRef} className="town__room" role="img"
             aria-label="Agent Town — where the NEXUS agents work">
          <svg viewBox={`0 0 ${FLOOR_W} ${floorH}`} className="town__layer"
               preserveAspectRatio="none">
            <TownFloor height={floorH} />
            {roster.map((agent) => (
              <Character key={agent.id} def={agent} runtime={agents[agent.id]} />
            ))}
          </svg>

          {roster.map((agent) => (
            <NameTag key={agent.id} def={agent} runtime={agents[agent.id]} floorH={floorH} />
          ))}
        </div>
      </div>

      <footer className="town__foot">
        <span className="tstat">
          <i className="tstat__dot" data-on={busy.length > 0} />
          {busy.length}/{roster.length} Agents Active
        </span>
        <span className="tstat" data-warn={!hasModel}>
          <Monitor size={11} />
          {hasModel ? 'Model ready' : 'No model yet'}
        </span>
        <span className="tstat tstat--meter">
          <Cpu size={11} />
          CPU
          <span className="tmeter">
            <b style={{ width: `${stats?.cpu ?? 0}%` }} />
          </span>
          {stats ? `${Math.round(stats.cpu)}%` : '—'}
        </span>
        <span className="tstat">{roster.length - busy.length}/{roster.length} seated</span>
        <span className="tstat">
          {busy.filter((a) => WORKING.has(agents[a.id].state)).length}/{roster.length} busy
        </span>
        <button type="button" className="tbtn" onClick={() => setView('agents')}>
          Open View
        </button>
      </footer>
    </section>
  )
}

/**
 * The name tag that rides above an agent's head. HTML rather than SVG so it
 * can be sized in cqw and stay crisp; it moves on the same 900ms as the walk.
 */
function NameTag({
  def,
  runtime,
  floorH,
}: {
  def: AgentDef
  runtime: AgentRuntime
  floorH: number
}) {
  const live = WORKING.has(runtime.state)
  const label = def.name.charAt(0) + def.name.slice(1).toLowerCase()
  const title = runtime.says
    ? `${label} — ${runtime.says}`
    : `${label} — ${def.role}, ${runtime.state}`

  return (
    <div
      className="seat"
      data-live={live}
      data-away={!runtime.atStation}
      data-state={runtime.state}
      style={{
        left: `${(runtime.x / FLOOR_W) * 100}%`,
        top: `${((runtime.y - 62) / floorH) * 100}%`,
        ['--tone' as string]: def.color,
      }}
      title={title}
    >
      <i className="seat__dot" />
      <span className="seat__name">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------ character -- */

/** Small differences so the agents read as people, not clones. */
const SKIN: Record<string, string> = {
  orion: '#e8c9a8',
  zeno: '#c98f63',
  luna: '#f0d5b8',
  nova: '#a9714a',
  axel: '#e8c9a8',
  aria: '#f2ddc6',
  kai: '#c98f63',
}

const HAIR_COLOR: Record<string, string> = {
  orion: '#2b2118',
  zeno: '#4a2c17',
  luna: '#6b2f4a',
  nova: '#1c1a1f',
  axel: '#3a2a1c',
  aria: '#5a4030',
  kai: '#241d16',
}

// Each path is drawn over the 13-wide head that starts at y = -42.
const HAIR: Record<string, string> = {
  default: 'M-7 -38.5 q0 -5 6.5 -5 q6.5 0 6.5 5 l0 1.5 l-13 0 z',
  // short crop
  orion: 'M-7 -38.5 q0 -5 6.5 -5 q6.5 0 6.5 5 l0 1.5 l-13 0 z',
  // side part
  zeno: 'M-7 -38 q0 -5.5 6.5 -5.5 q6.5 0 6.5 5.5 l0 1 l-9 0 l-1.5 -3 l-2 3 z',
  // long hair down the sides
  luna: 'M-7.5 -38 q0 -5.5 7 -5.5 q7 0 7 5.5 l0 8 l-2.5 0 l0 -7 l-9 0 l0 7 l-2.5 0 z',
  // bun
  nova: 'M-7 -38.5 q0 -5 6.5 -5 q6.5 0 6.5 5 l0 1.5 l-13 0 z M4.5 -44.5 a2.6 2.6 0 1 1 0.1 0 z',
  // messy
  axel: 'M-7 -38 q0 -5.5 6.5 -5.5 q6.5 0 6.5 5.5 l0 1 l-2 -2 l-2 2 l-2.5 -2.5 l-2 2.5 l-2 -2 l-2 2 z',
  // bob
  aria: 'M-7.5 -38 q0 -5.5 7 -5.5 q7 0 7 5.5 l0 4.5 l-2.5 0 l0 -3.5 l-9 0 l0 3.5 l-2.5 0 z',
  // cap
  kai: 'M-7.5 -38.5 q0 -5 7 -5 q7 0 7 5 l0 1 l-14 0 z M6.5 -38.5 l4 1 l0 1.5 l-4 -0.5 z',
}

/** Matched to the people painted into the floor, which are a little taller. */
const SCALE = 1.15

function Character({ def, runtime }: { def: AgentDef; runtime: AgentRuntime }) {
  const seated = runtime.atStation && WORKING.has(runtime.state)
  const walking = runtime.state === 'walking' || runtime.state === 'returning'
  const asleep = runtime.state === 'standby'

  return (
    <g
      className="ch"
      data-state={runtime.state}
      data-walking={walking}
      data-seated={seated}
      style={{
        transform: `translate(${runtime.x}px, ${runtime.y}px) scale(${SCALE})`,
        color: def.color,
      }}
    >
      <ellipse cy="1" rx="13" ry="3.8" fill={def.color} className="ch__shadow" />

      <g className="ch__bob">
        <g className="ch__legs">
          <rect className="ch__leg ch__leg--l" x="-6" y="-13" width="4.5" height="13" rx="1.5"
                fill="#212f38" />
          <rect className="ch__leg ch__leg--r" x="1.5" y="-13" width="4.5" height="13" rx="1.5"
                fill="#212f38" />
        </g>
        {/* shoes */}
        <rect x="-6.5" y="-2" width="5.5" height="2.5" rx="1" fill="#151f26" />
        <rect x="1" y="-2" width="5.5" height="2.5" rx="1" fill="#151f26" />

        {/* torso, in the agent's colour */}
        <rect x="-8.5" y="-28" width="17" height="17" rx="3.5" fill={def.color} />
        <rect x="-8.5" y="-28" width="17" height="5" rx="3" fill="#fff" opacity="0.16" />
        {/* arms */}
        <rect x="-11.5" y="-26" width="3.5" height="12" rx="1.75" fill={def.color} opacity="0.8" />
        <rect x="8" y="-26" width="3.5" height="12" rx="1.75" fill={def.color} opacity="0.8" />
        {/* hands */}
        <circle cx="-9.8" cy="-13.5" r="1.9" fill={SKIN[def.id] ?? '#e8c9a8'} />
        <circle cx="9.8" cy="-13.5" r="1.9" fill={SKIN[def.id] ?? '#e8c9a8'} />

        {/* head */}
        <rect x="-6.5" y="-42" width="13" height="13.5" rx="4" fill={SKIN[def.id] ?? '#e8c9a8'} />
        {/* hair, distinct per agent */}
        <path d={HAIR[def.id] ?? HAIR.default} fill={HAIR_COLOR[def.id] ?? '#2b2118'} />
        <rect x="-3.4" y="-35" width="1.9" height="2.4" rx="0.9" fill="#22303a" />
        <rect x="1.5" y="-35" width="1.9" height="2.4" rx="0.9" fill="#22303a" />
      </g>

      {asleep ? (
        <text x="13" y="-44" className="ch__z" fill={def.color}>
          z
        </text>
      ) : null}

      {runtime.says ? (
        <g className="ch__bubble" transform="translate(14 -60)">
          <rect width={runtime.says.length * 4.6 + 14} height="17" rx="6"
                fill="var(--surface-solid)" stroke={def.color} strokeOpacity="0.6" />
          <text x="7" y="12" className="ch__says" fill="var(--text)">
            {runtime.says}
          </text>
        </g>
      ) : null}
    </g>
  )
}
