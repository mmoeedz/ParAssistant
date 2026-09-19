import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import { useSession } from '@/store/session'
import {
  AGENTS,
  STATIONS,
  agentName,
  agentStation,
  type AgentDef,
  type AgentId,
} from '@/types/agents'
import { TownFloor } from './TownFloor'
import { AgentPortrait } from './AgentPortrait'
import { FLOOR_W, WORKING, stageStyle, useFloorH } from './TownStage'
import './town.css'

/**
 * The same floor, read as a plan instead of a scene: every agent pinned to
 * its real desk, drawn as its actual Agent Town character rather than a bare
 * colour dot. The one station nobody owns (the Server Room — no agent's
 * tools are wired to it yet) stays a plain, undraggable marker, because
 * there is honestly nothing there to place.
 *
 * Positions come from `agentStation`, which prefers a saved override over
 * the roster's default — see types/agents.ts. Dragging a pin only edits a
 * local draft; nothing moves for real, for the walk state machine included,
 * until "Save Positions" commits the draft to that override.
 */

const SERVER_STATION = STATIONS.server

/** Keep a pin's centre out of the walls at the very edge of the floor. */
const MARGIN = 22

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function TownMap({ maxWidth }: { maxWidth?: number } = {}) {
  const agents = useSession((s) => s.agents)
  const overrides = useSession((s) => s.townOverrides)
  const setAgentStation = useSession((s) => s.setAgentStation)
  const resetAgentStation = useSession((s) => s.resetAgentStation)

  const roomRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const floorH = useFloorH(stageRef, maxWidth)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Partial<Record<AgentId, { x: number; y: number }>>>({})
  const [draggingId, setDraggingId] = useState<AgentId | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const positionOf = useCallback(
    (id: AgentId) => draft[id] ?? agentStation(overrides, id),
    [draft, overrides],
  )

  const onPointerDown = (id: AgentId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingId(id)
  }

  const onPointerMove = (id: AgentId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingId !== id) return
    const room = roomRef.current
    if (!room) return
    const rect = room.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.round(clamp(((e.clientX - rect.left) / rect.width) * FLOOR_W, MARGIN, FLOOR_W - MARGIN))
    const y = Math.round(clamp(((e.clientY - rect.top) / rect.height) * floorH, MARGIN, floorH - MARGIN))
    setDraft((prev) => ({ ...prev, [id]: { x, y } }))
  }

  const onPointerUp = (id: AgentId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingId !== id) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDraggingId(null)
  }

  const save = () => {
    for (const [id, pos] of Object.entries(draft)) {
      if (pos) setAgentStation(id as AgentId, pos)
    }
    setDraft({})
    setEditing(false)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1800)
  }

  const cancel = () => {
    setDraft({})
    setEditing(false)
  }

  const resetAll = () => {
    for (const agent of AGENTS) resetAgentStation(agent.id)
    setDraft({})
  }

  return (
    <>
      <div className="tmap__bar">
        <span className="tmap__hint">
          {editing
            ? 'Drag an agent to move its desk, then save — or cancel to leave it where it was.'
            : savedFlash
              ? 'Saved. Desks moved for real — the walk goes there now.'
              : 'The floor plan. Edit Layout to drag any agent to a new desk.'}
        </span>
        {editing ? (
          <>
            <button type="button" className="tbtn" onClick={resetAll} title="Reset every agent to its default desk">
              <RotateCcw size={12} />
              Reset all
            </button>
            <button type="button" className="tbtn" onClick={cancel}>
              <X size={12} />
              Cancel
            </button>
            <button type="button" className="tbtn tbtn--accent" onClick={save}>
              <Check size={12} />
              Save positions
            </button>
          </>
        ) : (
          <button type="button" className="tbtn" onClick={() => setEditing(true)}>
            Edit layout
          </button>
        )}
      </div>

      <div className="town__stage" ref={stageRef} style={stageStyle(floorH, maxWidth)}>
        <div ref={roomRef} className="town__room" role="img"
             aria-label="Agent Town floor plan — which agent works at which station">
          <svg viewBox={`0 0 ${FLOOR_W} ${floorH}`} className="town__layer"
               preserveAspectRatio="none">
            <TownFloor height={floorH} />
          </svg>

          {AGENTS.map((agent) => (
            <AgentPin
              key={agent.id}
              def={agent}
              label={agentStation(overrides, agent.id).label}
              name={agentName(overrides, agent.id)}
              pos={positionOf(agent.id)}
              floorH={floorH}
              live={WORKING.has(agents[agent.id].state)}
              editing={editing}
              dragging={draggingId === agent.id}
              onPointerDown={onPointerDown(agent.id)}
              onPointerMove={onPointerMove(agent.id)}
              onPointerUp={onPointerUp(agent.id)}
            />
          ))}

          {/* The one station nobody owns — nothing to drag, so it stays put. */}
          <div
            className="tmark"
            data-empty="true"
            style={{
              left: `${(SERVER_STATION.x / FLOOR_W) * 100}%`,
              top: `${(SERVER_STATION.y / floorH) * 100}%`,
              ['--tone' as string]: 'var(--text-faint)',
            }}
            title={`${SERVER_STATION.label} — no agent assigned`}
          >
            <i className="tmark__pin" />
            <span className="tmark__label">
              <b>UNASSIGNED</b>
              <em>{SERVER_STATION.label}</em>
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

function AgentPin({
  def,
  label,
  name,
  pos,
  floorH,
  live,
  editing,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  def: AgentDef
  label: string
  name: string
  pos: { x: number; y: number }
  floorH: number
  live: boolean
  editing: boolean
  dragging: boolean
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className="tmark"
      data-live={live}
      data-draggable={editing}
      data-dragging={dragging}
      style={{
        left: `${(pos.x / FLOOR_W) * 100}%`,
        top: `${(pos.y / floorH) * 100}%`,
        ['--tone' as string]: def.color,
      }}
      title={editing ? `Drag to move ${name}'s desk` : `${label} — ${name}, ${live ? 'working' : 'idle'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="tmark__avatar">
        <AgentPortrait def={def} size={26} />
      </span>
      <span className="tmark__label">
        <b>{name}</b>
        <em>{label}</em>
      </span>
    </div>
  )
}
