import { useEffect, useRef, useState } from 'react'
import { Activity, ChevronRight, Pencil, Users } from 'lucide-react'
import { useSession } from '@/store/session'
import {
  AGENTS,
  agentForTool,
  agentName,
  type AgentDef,
  type AgentId,
  type AgentRuntime,
  type AgentState,
} from '@/types/agents'
import type { Task } from '@/types/protocol'
import { TownStage } from '@/components/town/TownStage'
import { TownMap } from '@/components/town/TownMap'
import { AgentPortrait } from '@/components/town/AgentPortrait'
import { Badge, Segmented } from '@/components/ui'
import { relative } from '@/lib/time'
import './views.css'

/**
 * The Agents tab: the town large, with the roster's live state under it.
 *
 * Every number on this page comes from something the backend reported — an
 * agent's state, the tool calls it has run, and the steps of the task that is
 * actually in flight. Nothing on an idle agent's card moves, because nothing
 * about an idle agent is moving.
 */

const TABS = [
  { value: 'TOWN' as const, label: 'Town', tone: 'accent' as const },
  { value: 'MAP' as const, label: 'Map', tone: 'accent' as const },
  { value: 'LIST' as const, label: 'List', tone: 'accent' as const },
]

type Tab = (typeof TABS)[number]['value']

/** The header keeps its name; the line under it says which view you are on. */
const SUBTITLE: Record<Tab, string> = {
  TOWN: 'Live view of your AI agent network',
  MAP: 'The floor plan — which agent works at which station',
  LIST: 'Every agent, the tools it owns and what it last did',
}

const STATE_TONE: Record<string, 'accent' | 'good' | 'warn' | 'danger' | undefined> = {
  working: 'accent',
  thinking: 'accent',
  waking: 'accent',
  walking: 'accent',
  waiting: 'warn',
  blocked: 'warn',
  error: 'danger',
  completed: 'good',
  returning: undefined,
  standby: undefined,
  handoff: 'accent',
}

const BUSY: AgentState[] = ['waking', 'walking', 'working', 'thinking', 'handoff', 'waiting']

function statusText(state: AgentState): string {
  if (state === 'standby' || state === 'returning' || state === 'completed') return 'Idle'
  if (state === 'working' || state === 'walking' || state === 'waking') return 'Working'
  if (state === 'thinking') return 'Thinking'
  if (state === 'waiting') return 'Waiting'
  if (state === 'blocked') return 'Blocked'
  return 'Error'
}

export function AgentsView() {
  const agents = useSession((s) => s.agents)
  const tasks = useSession((s) => s.tasks)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const overrides = useSession((s) => s.townOverrides)
  const [tab, setTab] = useState<Tab>('TOWN')

  const roster = AGENTS.filter((a) => a.id !== 'paradox')
  const live = tasks.find((t) => t.id === activeTaskId) ?? null
  const active = roster.filter((a) => BUSY.includes(agents[a.id].state)).length

  return (
    <div className="agview">
      <section className="panel agview__stage">
        <header className="panel__head agview__head">
          <Users size={15} />
          <div className="agview__title">
            <span className="section-title">AGENT TOWN</span>
            <span className="agview__sub">{SUBTITLE[tab]}</span>
          </div>
          <Segmented value={tab} options={TABS} onChange={setTab} ariaLabel="Agent Town view" />
        </header>

        <div className="agview__body">
          {/* Uncapped: the town fills the page at any size, drawing a deeper
              floor on a tall screen (see useFloorH) rather than sitting as a
              1400px island in the middle of a 4K display. */}
          {tab === 'TOWN' ? <TownStage /> : null}
          {tab === 'MAP' ? <TownMap /> : null}
          {tab === 'LIST' ? (
            <div className="agview__list">
              <div className="cards">
                {AGENTS.map((def) => (
                  <AgentCard key={def.id} def={def} runtime={agents[def.id]} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Only under Town — the Map is about where a desk is, and the List is
          about what an agent owns; neither needs a live feed duplicating what
          the Town's own name tags and the strip below it already show. */}
      {tab === 'TOWN' ? (
        <section className="panel agview__live">
          <header className="panel__head">
            <Activity size={14} />
            <span className="section-title">LIVE AGENT ACTIVITY</span>
            <span className="panel__count">
              {active}/{roster.length} active
            </span>
            <button type="button" className="panel__action" onClick={() => setTab('LIST')}>
              See all
              <ChevronRight size={12} />
            </button>
          </header>

          <div className="agview__strip">
            {roster.map((def) => (
              <LiveCard key={def.id} def={def} runtime={agents[def.id]} task={live}
                        name={agentName(overrides, def.id)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- live card -- */

interface Share {
  done: number
  total: number
  pct: number
  running: boolean
}

/**
 * How far this agent is through its own part of the task that is running now.
 *
 * The steps are the backend's, and `agentForTool` is the same mapping that
 * decides who walks to a desk — so the bar tracks work that really happened
 * rather than a timer pretending to be progress. No live task, or no step of
 * it belonging to this agent, means there is nothing to report.
 */
function shareOf(task: Task | null, id: AgentId): Share | null {
  if (!task) return null
  const mine = task.steps.filter((s) => agentForTool(s.tool) === id)
  if (!mine.length) return null
  const done = mine.filter((s) => s.status === 'done' || s.status === 'skipped').length
  return {
    done,
    total: mine.length,
    pct: Math.round((done / mine.length) * 100),
    running: mine.some((s) => s.status === 'running'),
  }
}

function LiveCard({
  def,
  runtime,
  task,
  name,
}: {
  def: AgentDef
  runtime: AgentRuntime
  task: Task | null
  name: string
}) {
  const live = BUSY.includes(runtime.state)
  const share = shareOf(task, def.id)
  const label = name.charAt(0) + name.slice(1).toLowerCase()

  // What the agent is doing right now if it is doing anything — the store only
  // sets `activity` from a real step — and otherwise what it is there for.
  const what = runtime.activity ?? def.role

  const note = share
    ? `${share.done}/${share.total} steps`
    : runtime.lastActiveAt
      ? relative(runtime.lastActiveAt)
      : 'No calls yet'

  const value = share
    ? `${share.pct}%`
    : runtime.runs
      ? `${runtime.runs} ${runtime.runs === 1 ? 'run' : 'runs'}`
      : '—'

  return (
    <article className="lacard" data-live={live} style={{ ['--tone' as string]: def.color }}>
      <header className="lacard__top">
        <span className="lacard__dotwrap">
          <i className="lacard__pulse" data-live={live} />
          <i className="lacard__dot" data-live={live} />
        </span>
        <span className="lacard__name">{label}</span>
        <span className="lacard__state" data-live={live}>
          {statusText(runtime.state)}
        </span>
      </header>

      <p className="lacard__what" title={what}>
        {what}
      </p>

      <div className="lacard__meterline">
        <span className="lacard__note">{note}</span>
        <span className="lacard__value">{value}</span>
      </div>

      <span className="lacard__bar" data-idle={!share}>
        <b style={{ width: `${share?.pct ?? 0}%` }} data-running={share?.running ?? false} />
      </span>
    </article>
  )
}

/* ------------------------------------------------------------ roster card -- */

function AgentCard({ def, runtime }: { def: AgentDef; runtime: AgentRuntime }) {
  const dormant = def.tools.length === 0 && def.id !== 'paradox'
  const overrides = useSession((s) => s.townOverrides)
  const renameAgent = useSession((s) => s.renameAgent)
  const name = agentName(overrides, def.id)

  return (
    <article className="acard" style={{ ['--tone' as string]: def.color }} data-dormant={dormant}>
      <header className="acard__head">
        {/* Paradox is the orchestrator, not a person walking the town floor —
            it keeps the plain accent mark rather than a portrait it doesn't
            have. Every other agent gets its actual Agent Town character. */}
        {def.id === 'paradox' ? (
          <span className="acard__mark" />
        ) : (
          <span className="acard__portrait">
            <AgentPortrait def={def} />
          </span>
        )}
        <div>
          <EditableName value={name} onSave={(next) => renameAgent(def.id, next)} />
          <div className="acard__role">{def.role}</div>
        </div>
        <Badge tone={STATE_TONE[runtime.state]}>{runtime.state}</Badge>
      </header>

      <p className="acard__activity">
        {runtime.activity ?? (dormant ? def.pending : 'Nothing assigned.')}
      </p>

      <dl className="acard__stats">
        <div>
          <dt>Station</dt>
          <dd>{def.station.label}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{def.tools.length || '—'}</dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{runtime.runs}</dd>
        </div>
        <div>
          <dt>Last active</dt>
          <dd>{runtime.lastActiveAt ? relative(runtime.lastActiveAt) : 'never'}</dd>
        </div>
      </dl>

      {def.tools.length ? (
        <div className="acard__tools">
          {def.tools.map((tool) => (
            <span key={tool} className="tool-chip">
              {tool}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

/* --------------------------------------------------------------- rename -- */

/**
 * The agent's name, click-to-rename. Only the display name changes — the
 * agent's id, and everything keyed off it (tools, colour, routing), stays
 * exactly what it was, so a rename can't quietly break anything.
 */
function EditableName({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    setDraft(value)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing, value])

  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== value) onSave(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="acard__name-input"
        value={draft}
        maxLength={24}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button type="button" className="acard__name-edit" onClick={() => setEditing(true)}
            title={`Rename ${value}`}>
      <span className="acard__name">{value}</span>
      <Pencil size={10} className="acard__name-pencil" />
    </button>
  )
}
