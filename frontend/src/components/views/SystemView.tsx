import { useState } from 'react'
import { Cpu, ListChecks, Settings2, ShieldCheck } from 'lucide-react'
import { SettingsView } from '@/components/settings/SettingsView'
import { TasksView } from './TasksView'
import {
  BROWSER,
  COMMUNICATION,
  COMPUTER,
  CapabilityView,
  FILES,
  MEDIA,
} from './CapabilityView'
import './views.css'

type Section = 'capabilities' | 'tasks' | 'settings'

const CAPABILITIES = [COMPUTER, BROWSER, COMMUNICATION, FILES, MEDIA]

/**
 * The SYSTEM tab. The reference has three top-level tabs, so everything that
 * is not the command centre or the agent roster lives here.
 */
export function SystemView() {
  const [section, setSection] = useState<Section>('capabilities')
  const [capability, setCapability] = useState(0)

  return (
    <div className="sysview">
      <nav className="sysnav">
        <button type="button" className="sysnav__item" data-active={section === 'capabilities'}
                onClick={() => setSection('capabilities')}>
          <Cpu size={14} /> Capabilities
        </button>
        <button type="button" className="sysnav__item" data-active={section === 'tasks'}
                onClick={() => setSection('tasks')}>
          <ListChecks size={14} /> Tasks
        </button>
        <button type="button" className="sysnav__item" data-active={section === 'settings'}
                onClick={() => setSection('settings')}>
          <Settings2 size={14} /> Settings &amp; permissions
        </button>

        {section === 'capabilities' ? (
          <div className="sysnav__sub">
            {CAPABILITIES.map((config, i) => (
              <button
                key={config.title}
                type="button"
                className="sysnav__subitem"
                data-active={capability === i}
                onClick={() => setCapability(i)}
              >
                {config.title}
              </button>
            ))}
          </div>
        ) : null}

        <div className="sysnav__foot">
          <ShieldCheck size={12} />
          Permissions are enforced by the agent, not this window.
        </div>
      </nav>

      <div className="sysbody">
        {section === 'capabilities' ? <CapabilityView config={CAPABILITIES[capability]} /> : null}
        {section === 'tasks' ? <TasksView /> : null}
        {section === 'settings' ? <SettingsView /> : null}
      </div>
    </div>
  )
}
