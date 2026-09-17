import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSession, WALK_UNITS_PER_MS } from '@/store/session'
import { AGENTS, agentName, type AgentDef, type AgentRuntime } from '@/types/agents'
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
  const overrides = useSession((s) => s.townOverrides)
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
          <NameTag key={agent.id} def={agent} runtime={agents[agent.id]} floorH={floorH}
                   name={agentName(overrides, agent.id)} />
        ))}
      </div>
    </div>
  )
}

/**
 * The name tag that rides above an agent's head. HTML rather than SVG so it
 * can be sized in cqw and stay crisp; it moves on the same duration as the
 * walk, and — unlike the character underneath it — never mirrors, since text
 * read backwards isn't a "turn," just unreadable.
 */
function NameTag({
  def,
  runtime,
  floorH,
  name,
}: {
  def: AgentDef
  runtime: AgentRuntime
  floorH: number
  name: string
}) {
  const live = WORKING.has(runtime.state)
  const label = name.charAt(0) + name.slice(1).toLowerCase()
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
export const SKIN: Record<string, string> = {
  orion: '#e8c9a8',
  zeno: '#c98f63',
  luna: '#f0d5b8',
  nova: '#a9714a',
  axel: '#e8c9a8',
  aria: '#f2ddc6',
  kai: '#c98f63',
}

export const HAIR_COLOR: Record<string, string> = {
  orion: '#2b2118',
  zeno: '#4a2c17',
  luna: '#6b2f4a',
  nova: '#1c1a1f',
  axel: '#3a2a1c',
  aria: '#5a4030',
  kai: '#241d16',
}

// Each path is drawn over the 13-wide head that starts at y = -42.
export const HAIR: Record<string, string> = {
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

/** Trousers, so the agents are not seven people in identical dark jeans. */
export const TROUSERS: Record<string, string> = {
  orion: '#25303c',
  zeno: '#3a2f26',
  luna: '#243528',
  nova: '#2b2f36',
  axel: '#2e2838',
  aria: '#223440',
  kai: '#332f22',
}

/** Matched to the people painted into the floor, which are a little taller. */
const SCALE = 1.15

/**
 * The nominal full stride (both feet down once each) at the walk's own
 * nominal speed — WALK_UNITS_PER_MS, the same number the store's state
 * machine uses to turn a distance into a leg's travel time. Scaled by that
 * same ratio below, so a leg that is covering ground faster than nominal
 * (because its distance was long enough to hit the store's duration cap)
 * gets a brisker cadence, and one covering ground slower than nominal (a
 * short hop, clamped up to the minimum duration) gets a more relaxed one.
 */
const NOMINAL_STEP_MS = 680
const MIN_STEP_MS = 420
const MAX_STEP_MS = 1000

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * A small, deterministic offset per agent id, used as an animation-delay so
 * agents walking at the same time don't all land their footfalls on the same
 * beat — a crowd, not one puppet copied seven times.
 */
function phaseOffset(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 260
}

/**
 * Derives this agent's actual walking cadence and facing from its real
 * movement, instead of a fixed animation period that runs the same whether
 * the body is gliding the width of the floor or hopping half a step.
 *
 * `runtime.x/y` is a target the store's CSS transition (--move-ms, on `.ch`
 * itself) carries the character to — there is no independent "current
 * position" to read a velocity from. What IS knowable is each leg's own true
 * average speed: how far this target is from the last one, divided by how
 * long `moveMs` gives it to get there. That ratio against the nominal walk
 * speed is what scales the step period — a leg going faster than nominal
 * (a long corridor run, capped at the state machine's max duration) gets a
 * brisker cadence; a leg going slower (a short hop, floored at the minimum
 * duration) gets a slower one. Feet never appear to move at a rate
 * unrelated to how fast the body is actually covering ground.
 *
 * Uses the React-documented pattern of adjusting state during render when a
 * derived value (here, the previous target) has changed — see "Storing
 * information from previous renders" — rather than an effect, so the new
 * cadence is in place for the very frame the walk starts instead of one
 * frame behind it.
 */
function useGait(runtime: AgentRuntime): { stepMs: number; facing: 1 | -1 } {
  const [prev, setPrev] = useState({ x: runtime.x, y: runtime.y })
  const [stepMs, setStepMs] = useState(NOMINAL_STEP_MS)
  const [facing, setFacing] = useState<1 | -1>(1)

  const dx = runtime.x - prev.x
  const dy = runtime.y - prev.y
  const dist = Math.hypot(dx, dy)

  if (dist > 0.5 && runtime.moveMs > 0) {
    const speed = dist / runtime.moveMs
    setStepMs(clamp(Math.round(NOMINAL_STEP_MS * (WALK_UNITS_PER_MS / speed)), MIN_STEP_MS, MAX_STEP_MS))
    // Only a horizontal move says anything about which way to face — the
    // corridor's vertical legs (onto it, and off it into a station) carry no
    // left/right information, so facing only updates on the along-corridor leg.
    if (Math.abs(dx) > 0.5) setFacing(dx > 0 ? 1 : -1)
    setPrev({ x: runtime.x, y: runtime.y })
  }

  return { stepMs, facing }
}

/**
 * One agent, drawn as a person.
 *
 * The limbs are real groups rather than decoration: each leg carries its own
 * shoe and pivots at the hip, each arm carries its own hand and pivots at the
 * shoulder, and the head is separate again. That is what lets town.css run an
 * actual gait — contralateral arm and leg, a stance/swing timing rather than
 * a symmetric wag, a body that leans and bounces on the beat — and pose the
 * same body sitting at a desk and typing, instead of sliding a fixed sprite
 * across the floor.
 */
function Character({ def, runtime }: { def: AgentDef; runtime: AgentRuntime }) {
  const seated = runtime.atStation && WORKING.has(runtime.state)
  const walking = runtime.state === 'walking' || runtime.state === 'returning'
  const asleep = runtime.state === 'standby'
  const skin = SKIN[def.id] ?? '#e8c9a8'
  const trousers = TROUSERS[def.id] ?? '#212f38'
  const { stepMs, facing } = useGait(runtime)

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
        ['--step-ms' as string]: `${stepMs}ms`,
        ['--phase-ms' as string]: `${phaseOffset(def.id)}ms`,
      }}
    >
      <ellipse cy="1" rx="13" ry="3.8" fill={def.color} className="ch__shadow" />

      {/* Everything but the shadow mirrors to face the way the character is
          actually travelling — see town.css for why a mirror-flip reads as a
          turn rather than an instant snap. */}
      <g className="ch__facing" style={{ transform: `scaleX(${facing})` }}>
        <g className="ch__body">
          <g className="ch__legs">
            {/* Each leg takes its foot with it — the shoes used to be laid on
                separately, which left them standing still while the legs moved. */}
            <g className="ch__leg ch__leg--l">
              <rect x="-6" y="-13" width="4.5" height="13" rx="1.5" fill={trousers} />
              <rect x="-6.8" y="-2.6" width="6" height="3" rx="1.2" fill="#151f26" />
            </g>
            <g className="ch__leg ch__leg--r">
              <rect x="1.5" y="-13" width="4.5" height="13" rx="1.5" fill={trousers} />
              <rect x="0.8" y="-2.6" width="6" height="3" rx="1.2" fill="#151f26" />
            </g>
          </g>

          {/* torso, in the agent's colour */}
          <rect x="-8.5" y="-28" width="17" height="17" rx="3.5" fill={def.color} />
          <rect x="-8.5" y="-28" width="17" height="5" rx="3" fill="#fff" opacity="0.16" />
          <rect x="-8.5" y="-14.5" width="17" height="2.6" fill="#000" opacity="0.22" />
          <rect x="-2" y="-28" width="4" height="6" rx="1.4" fill="#fff" opacity="0.2" />

          {/* Arms are the agent's own colour at full strength now, not a
              faded 80% of it — the torso, arms and cabin accent should all
              read as the same solid colour, not three shades of it. */}
          <g className="ch__arm ch__arm--l">
            <rect x="-11.5" y="-26" width="3.5" height="12" rx="1.75" fill={def.color} />
            <circle cx="-9.75" cy="-13.5" r="1.9" fill={skin} />
          </g>
          <g className="ch__arm ch__arm--r">
            <rect x="8" y="-26" width="3.5" height="12" rx="1.75" fill={def.color} />
            <circle cx="9.75" cy="-13.5" r="1.9" fill={skin} />
          </g>

          <g className="ch__head">
            <rect x="-6.5" y="-42" width="13" height="13.5" rx="4" fill={skin} />
            {/* hair, distinct per agent */}
            <path d={HAIR[def.id] ?? HAIR.default} fill={HAIR_COLOR[def.id] ?? '#2b2118'} />
            <rect x="-3.4" y="-35" width="1.9" height="2.4" rx="0.9" fill="#22303a" />
            <rect x="1.5" y="-35" width="1.9" height="2.4" rx="0.9" fill="#22303a" />
          </g>
        </g>
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
