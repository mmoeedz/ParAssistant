import { useSession } from '@/store/session'
import { AGENTS, type AgentDef, type AgentRuntime } from '@/types/agents'
import { Badge } from '@/components/ui'
import { relative } from '@/lib/time'
import './views.css'

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

export function AgentsView() {
  const agents = useSession((s) => s.agents)

  return (
    <div className="view">
      <div className="view__inner">
        <div className="view__head">
          <h2>Agents</h2>
          <p>
            NEXUS delegates to these. An agent's state here is derived from tool calls the backend
            actually reported — if a card says working, something ran.
          </p>
        </div>

        <div className="cards">
          {AGENTS.map((def) => (
            <AgentCard key={def.id} def={def} runtime={agents[def.id]} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentCard({ def, runtime }: { def: AgentDef; runtime: AgentRuntime }) {
  const dormant = def.tools.length === 0 && def.id !== 'nexus'

  return (
    <article className="acard" style={{ ['--tone' as string]: def.color }} data-dormant={dormant}>
      <header className="acard__head">
        <span className="acard__mark" />
        <div>
          <div className="acard__name">{def.name}</div>
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
