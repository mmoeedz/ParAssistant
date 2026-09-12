import { History } from 'lucide-react'
import { useSession } from '@/store/session'
import { Badge, Toggle } from '@/components/ui'
import { StepList } from '@/components/activity/StepList'
import { statusLabel, statusTone } from '@/components/dashboard/panels'
import { AGENT_BY_ID, agentForTool } from '@/types/agents'
import { duration, relative } from '@/lib/time'
import './views.css'

export function TasksView() {
  const tasks = useSession((s) => s.tasks)
  const verbose = useSession((s) => s.settings.verboseActivity)
  const updateSettings = useSession((s) => s.updateSettings)
  const ordered = [...tasks].reverse()

  return (
    <div className="view">
      <div className="view__inner">
        <div className="view__head">
          <h2>Tasks</h2>
          <p>
            Every task this session, the steps that ran, and what was checked afterwards. Nothing is
            listed here unless the agent reported it.
          </p>
        </div>

        <Toggle
          checked={verbose}
          onChange={(v) => updateSettings({ verboseActivity: v })}
          label="Show which tool ran each step"
        />

        {ordered.length === 0 ? (
          <div className="blank">
            <History size={20} />
            <span>No tasks yet this session</span>
          </div>
        ) : (
          <div className="history">
            {ordered.map((task) => {
              const agents = [
                ...new Set(task.steps.map((s) => agentForTool(s.tool)).filter((a) => a !== 'paradox')),
              ]
              return (
                <article key={task.id} className="history__item">
                  <div className="history__top">
                    <span className="history__goal">{task.goal}</span>
                    <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
                    <span className="history__time">
                      {relative(task.startedAt)} ·{' '}
                      {duration(task.startedAt, task.endedAt ?? Date.now())}
                    </span>
                  </div>

                  {agents.length ? (
                    <div className="acard__tools" style={{ marginBottom: 'var(--sp-3)' }}>
                      {agents.map((id) => (
                        <span
                          key={id}
                          className="tool-chip"
                          style={{ color: AGENT_BY_ID[id].color, borderColor: 'currentColor' }}
                        >
                          {AGENT_BY_ID[id].name}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <StepList steps={task.steps} showTools={verbose} />
                  {task.summary ? <p className="task__summary">{task.summary}</p> : null}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
