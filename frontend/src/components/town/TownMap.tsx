import { useRef } from 'react'
import { useSession } from '@/store/session'
import { AGENTS, STATIONS, type AgentDef } from '@/types/agents'
import { TownFloor } from './TownFloor'
import { FLOOR_W, WORKING, useFloorBox } from './TownStage'
import './town.css'

/**
 * The same floor, read as a plan instead of a scene: every station in the
 * town with the agent that owns it pinned to its real seat coordinates.
 *
 * Nothing here is invented — the pins are STATIONS, the owners are the
 * roster's own `station` field, and a station with no pin genuinely has no
 * agent assigned to it yet.
 */

const OWNER = new Map<string, AgentDef>()
for (const agent of AGENTS) OWNER.set(agent.station.id, agent)

export function TownMap({ maxWidth }: { maxWidth?: number } = {}) {
  const agents = useSession((s) => s.agents)
  const stageRef = useRef<HTMLDivElement>(null)
  const { floorH, width } = useFloorBox(stageRef, maxWidth)

  return (
    <div className="town__stage" ref={stageRef}>
      <div className="town__room" role="img" style={{ width: width || undefined }}
           aria-label="Agent Town floor plan — which agent works at which station">
        <svg viewBox={`0 0 ${FLOOR_W} ${floorH}`} className="town__layer"
             preserveAspectRatio="none">
          <TownFloor height={floorH} />
        </svg>

        {Object.values(STATIONS).map((station) => {
          const owner = OWNER.get(station.id)
          const runtime = owner ? agents[owner.id] : null
          const live = runtime ? WORKING.has(runtime.state) : false

          return (
            <div
              key={station.id}
              className="tmark"
              data-live={live}
              data-empty={!owner}
              style={{
                left: `${(station.x / FLOOR_W) * 100}%`,
                top: `${(station.y / floorH) * 100}%`,
                ['--tone' as string]: owner?.color ?? 'var(--text-faint)',
              }}
              title={
                owner
                  ? `${station.label} — ${owner.name}, ${runtime?.state}`
                  : `${station.label} — no agent assigned`
              }
            >
              <i className="tmark__pin" />
              <span className="tmark__label">
                <b>{owner ? owner.name : 'UNASSIGNED'}</b>
                <em>{station.label}</em>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
