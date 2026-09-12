import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ChevronDown,
  Cpu,
  Eye,
  HardDrive,
  MemoryStick,
  Newspaper,
  Radio,
  Square,
  Terminal,
} from 'lucide-react'
import { useSession, type ActivityEntry, type ConsoleLine } from '@/store/session'
import { AGENT_BY_ID, agentForTool } from '@/types/agents'
import { StepList } from '@/components/activity/StepList'
import { Badge, Button, StatusDot } from '@/components/ui'
import { clockTime, duration } from '@/lib/time'
import type { Task } from '@/types/protocol'
import './dashboard.css'

/* -------------------------------------------------------- current task -- */

export function CurrentTask() {
  const tasks = useSession((s) => s.tasks)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const cancelTask = useSession((s) => s.cancelTask)
  const verbose = useSession((s) => s.settings.verboseActivity)

  const task = tasks.find((t) => t.id === activeTaskId) ?? tasks[tasks.length - 1] ?? null
  const live = Boolean(activeTaskId)

  return (
    <section className="panel" data-live={live}>
      <header className="panel__head">
        <StatusDot tone={live ? 'busy' : task ? 'online' : 'offline'} />
        <span className="section-title">{live ? 'Current task' : 'Last task'}</span>
        {live ? (
          <Button variant="danger" size="sm" onClick={cancelTask} title="Stop this task (Esc)">
            <Square size={11} fill="currentColor" /> Stop
          </Button>
        ) : null}
      </header>

      <div className="panel__body">
        {task ? <TaskBody task={task} verbose={verbose} /> : (
          <p className="panel__blank">
            Nothing running. Steps appear here as they happen, each with what was checked
            afterwards.
          </p>
        )}
      </div>
    </section>
  )
}

function TaskBody({ task, verbose }: { task: Task; verbose: boolean }) {
  const total = Math.max(task.steps.length, 1)
  const settled = task.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length
  const pct = task.status === 'succeeded' ? 100 : Math.round((settled / total) * 100)

  return (
    <>
      <p className="task__goal">{task.goal}</p>
      <div className="task__meta">
        <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
        <span>
          {task.statusLine?.toLowerCase() === statusLabel(task.status).toLowerCase()
            ? ''
            : task.statusLine}
        </span>
        <span className="task__spacer" />
        <span>{duration(task.startedAt, task.endedAt ?? Date.now())}</span>
      </div>
      <div className="task__bar" data-state={task.status}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="task__steps">
        <StepList steps={task.steps} showTools={verbose} />
      </div>
      {task.summary ? <p className="task__summary">{task.summary}</p> : null}
    </>
  )
}

export function statusLabel(status: Task['status']): string {
  return {
    planning: 'Planning',
    running: 'Running',
    awaiting_confirmation: 'Needs you',
    succeeded: 'Done',
    failed: 'Failed',
    cancelled: 'Stopped',
  }[status]
}

export function statusTone(status: Task['status']): 'accent' | 'good' | 'warn' | 'danger' | undefined {
  if (status === 'planning' || status === 'running') return 'accent'
  if (status === 'awaiting_confirmation') return 'warn'
  if (status === 'succeeded') return 'good'
  if (status === 'failed') return 'danger'
  return undefined
}

/* ------------------------------------------------------- live activity -- */

export function LiveActivity() {
  const activity = useSession((s) => s.activity)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [activity.length])

  return (
    <section className="panel">
      <header className="panel__head">
        <Activity size={13} />
        <span className="section-title">Live activity</span>
      </header>
      <div className="feed">
        {activity.length === 0 ? (
          <p className="panel__blank">Meaningful events show up here — not every mouse move.</p>
        ) : (
          activity.slice(-14).map((entry) => <ActivityRow key={entry.id} entry={entry} />)
        )}
        <div ref={endRef} />
      </div>
    </section>
  )
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const agent = AGENT_BY_ID[entry.agentId]
  return (
    <div className="feed__row" data-tone={entry.tone}>
      <span className="feed__time">{clockTime(entry.at)}</span>
      <span className="feed__who" style={{ color: agent.color }}>
        {agent.name}
      </span>
      <span className="feed__what">{entry.text}</span>
    </div>
  )
}

/* -------------------------------------------------------------- console -- */

export function ConsolePanel() {
  const lines = useSession((s) => s.console)
  const [open, setOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length, open])

  return (
    <section className="panel">
      <button type="button" className="panel__head panel__head--button" onClick={() => setOpen(!open)}>
        <Terminal size={13} />
        <span className="section-title">Console</span>
        <span className="panel__count">{lines.length}</span>
        <ChevronDown size={14} className={open ? 'rot180' : ''} />
      </button>
      {open ? (
        <div className="console">
          {lines.length === 0 ? (
            <p className="panel__blank">No log lines yet.</p>
          ) : (
            lines.slice(-120).map((line) => <ConsoleRow key={line.id} line={line} />)
          )}
          <div ref={endRef} />
        </div>
      ) : null}
    </section>
  )
}

function ConsoleRow({ line }: { line: ConsoleLine }) {
  return (
    <div className="console__row" data-level={line.level}>
      <span className="console__time">[{clockTime(line.at)}]</span>
      <span className="console__src" style={{ color: AGENT_BY_ID[agentForTool(line.source)].color }}>
        {line.source}
      </span>
      <span className="console__text">{line.text}</span>
    </div>
  )
}

/* ------------------------------------------------------- system monitor -- */

function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

export function SystemMonitor() {
  const stats = useSession((s) => s.stats)
  const connection = useSession((s) => s.connection)

  return (
    <section className="panel">
      <header className="panel__head">
        <Cpu size={13} />
        <span className="section-title">System</span>
        {stats ? <span className="panel__count">{stats.processes} proc</span> : null}
      </header>
      <div className="panel__body">
        {!stats ? (
          <p className="panel__blank">
            {connection === 'online'
              ? 'Waiting for the first sample…'
              : 'Telemetry comes from the agent. Not connected.'}
          </p>
        ) : (
          <div className="meters">
            <Meter icon={<Cpu size={12} />} label={`CPU · ${stats.cores} cores`}
                   percent={stats.cpu} color="var(--a-zeno)" value={`${stats.cpu.toFixed(0)}%`} />
            <Meter icon={<MemoryStick size={12} />} label="Memory" percent={stats.memory.percent}
                   color="var(--a-orion)"
                   value={`${bytes(stats.memory.usedBytes)} / ${bytes(stats.memory.totalBytes)}`} />
            <Meter icon={<HardDrive size={12} />} label="Disk C:" percent={stats.disk.percent}
                   color="var(--a-luna)"
                   value={`${bytes(stats.disk.usedBytes)} / ${bytes(stats.disk.totalBytes)}`} />
            {stats.network ? (
              <div className="meters__net">
                <Radio size={12} />
                <span>↓ {bytes(stats.network.down)}/s</span>
                <span>↑ {bytes(stats.network.up)}/s</span>
                {stats.temperature ? <span>{stats.temperature}°C</span> : null}
              </div>
            ) : null}
            <p className="meters__note">
              GPU and temperature need a vendor library Windows does not expose here, so they are
              left out rather than guessed.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function Meter({
  icon,
  label,
  percent,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  percent: number
  value: string
  color: string
}) {
  return (
    <div className="meter">
      <div className="meter__top">
        <span className="meter__icon" style={{ color }}>{icon}</span>
        <span className="meter__label">{label}</span>
        <span className="meter__value">{value}</span>
      </div>
      <div className="meter__track">
        <span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ headlines -- */

export function Headlines() {
  return (
    <section className="panel">
      <header className="panel__head">
        <Newspaper size={13} />
        <span className="section-title">Today</span>
      </header>
      <div className="panel__body">
        <p className="panel__blank">
          No news source is configured, so there is nothing real to show here. Turn this panel off
          in Settings, or wire a feed into the agent.
        </p>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------- observation -- */

export function LastObservation() {
  const observation = useSession((s) => s.observation)
  return (
    <section className="panel">
      <header className="panel__head">
        <Eye size={13} />
        <span className="section-title">Last observation</span>
        {observation?.method ? <Badge>{observation.method}</Badge> : null}
      </header>
      <div className="screen">
        {observation?.image ? (
          <img src={observation.image} alt="What Paradox last saw on screen" />
        ) : (
          <div className="screen__none">Nothing observed yet</div>
        )}
      </div>
      {observation?.activeWindow ? (
        <div className="screen__meta">{observation.activeWindow}</div>
      ) : null}
    </section>
  )
}
