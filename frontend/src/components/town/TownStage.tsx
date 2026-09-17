import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSession } from '@/store/session'
import { AGENTS, type AgentDef, type AgentRuntime } from '@/types/agents'
import { FLOOR_BASE_H, TownFloor } from './TownFloor'
import './town.css'

/**
 * The room itself, without the chrome around it.
 *
 * Split out of AgentTown so the dashboard panel and the full Agents view can
 * show the same town rather than two drifting copies of it. Everything about
 * the people is here; the header, footer and tabs belong to whoever frames it.
 */

export const WORKING = new Set(['working', 'thinking', 'waiting', 'handoff'])

/** The floor is 790 units wide; its height follows the panel it is given. */
export const FLOOR_W = 790

/** TownFloor's own clamp: it never draws itself shorter than this. */
const FLOOR_MIN_H = 300

export interface FloorBox {
  /** Floor height in the artwork's units — what TownFloor and the viewBox use. */
  floorH: number
  /** Room width in CSS pixels, or 0 before the first measurement. */
  width: number
}

/**
 * Size the room inside a stage.
 *
 * The floor keeps a fixed width of 790 units and takes whatever height it is
 * given, so it fills its panel without the drawing being stretched. Two
 * limits on how wide the room may actually be:
 *
 *  - 790:300 is the flattest the art exists at. Past that TownFloor still
 *    draws itself 300 units tall (it clamps), so the bottom of the room falls
 *    outside the viewBox and is silently cut off — which is what a full-width
 *    stage did before this clamp. Letterbox instead of cropping.
 *  - `maxWidth`, for a stage so wide that filling it would just blow every
 *    desk up to two or three times the size it was drawn at.
 *
 * The stage is measured, not the room, because the room's width is this
 * function's own output — observing it would feed back on itself.
 */
export function useFloorBox(ref: RefObject<HTMLElement | null>, maxWidth = Infinity): FloorBox {
  const [box, setBox] = useState<FloorBox>({ floorH: FLOOR_BASE_H, width: 0 })

  useLayoutEffect(() => {
    const stage = ref.current
    if (!stage) return

    const measure = () => {
      const r = stage.getBoundingClientRect()
      if (!r.width || !r.height) return
      const width = Math.min(r.width, maxWidth, (r.height * FLOOR_W) / FLOOR_MIN_H)
      const floorH = Math.round((FLOOR_W * r.height) / width)
      setBox((prev) =>
        Math.abs(prev.floorH - floorH) < 2 && Math.abs(prev.width - width) < 2
          ? prev
          : { floorH, width },
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [ref, maxWidth])

  return box
}

export function TownStage({ maxWidth }: { maxWidth?: number } = {}) {
  const agents = useSession((s) => s.agents)
  const stageRef = useRef<HTMLDivElement>(null)
  const { floorH, width } = useFloorBox(stageRef, maxWidth)

  const roster = AGENTS.filter((a) => a.id !== 'paradox')

  return (
    <div className="town__stage" ref={stageRef}>
      <div className="town__room" role="img" style={{ width: width || undefined }}
           aria-label="Agent Town — where the Paradox agents work">
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
        ['--move-ms' as string]: `${runtime.moveMs}ms`,
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
        ['--move-ms' as string]: `${runtime.moveMs}ms`,
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
