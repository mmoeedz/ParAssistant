import { useState } from 'react'
import { Cpu, Maximize2, Monitor, Users } from 'lucide-react'
import { useSession } from '@/store/session'
import { AGENTS } from '@/types/agents'
import { TownStage, WORKING } from './TownStage'
import './town.css'

/**
 * The Agent Town, as the dashboard's centre panel.
 *
 * The room is drawn — see TownFloor — in the reference artwork's coordinates
 * (790 x 350). Nobody is painted into it, so every person on screen is a real
 * agent: it walks from the lounge to its desk when it picks up work and back
 * when it is done, with its name tag following it. Nothing here animates
 * unless the backend reported a real tool call.
 *
 * The room itself lives in TownStage, shared with the full Agents view.
 */

const TABS = ['AGENT TOWN', 'AGENTS', 'VISUAL HUB', 'GESTURE'] as const

export function AgentTown() {
  const agents = useSession((s) => s.agents)
  const stats = useSession((s) => s.stats)
  const backendInfo = useSession((s) => s.backendInfo)
  const setView = useSession((s) => s.setView)
  const [tab, setTab] = useState<(typeof TABS)[number]>('AGENT TOWN')

  const roster = AGENTS.filter((a) => a.id !== 'paradox')
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

      <TownStage />

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
        {/* Both restate the "N/7 agents active" count above from another
            angle, so they are the ones town.css drops on a narrow panel. */}
        <span className="tstat tstat--secondary">
          {roster.length - busy.length}/{roster.length} seated
        </span>
        <span className="tstat tstat--secondary">
          {busy.filter((a) => WORKING.has(agents[a.id].state)).length}/{roster.length} busy
        </span>
        <button type="button" className="tbtn" onClick={() => setView('agents')}>
          Open View
        </button>
      </footer>
    </section>
  )
}
