import { useEffect } from 'react'
import { useSession } from '@/store/session'
import { TitleBar } from '@/components/layout/TitleBar'
import { PreviewBar } from '@/components/layout/PreviewBar'
import {
  CurrentTaskCard,
  GlobalActivity,
  Headlines,
  SystemOverview,
} from '@/components/dashboard/LeftColumn'
import { AgentNetwork } from '@/components/dashboard/AgentNetwork'
import { AgentTown } from '@/components/town/AgentTown'
import { ConsoleDock } from '@/components/dashboard/ConsoleDock'
import { NowPlaying } from '@/components/dashboard/NowPlaying'
import { AgentsView } from '@/components/views/AgentsView'
import { SystemView } from '@/components/views/SystemView'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import '@/components/layout/layout.css'

export default function App() {
  const view = useSession((s) => s.view)
  const theme = useSession((s) => s.settings.theme)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const cancelTask = useSession((s) => s.cancelTask)
  const panels = useSession((s) => s.settings.panels)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Esc stops a running task from anywhere.
  useEffect(() => {
    if (!activeTaskId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelTask()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTaskId, cancelTask])

  return (
    <div className="shell">
      <TitleBar />
      <PreviewBar />

      {view === 'command' ? (
        <div className="workspace">
          <div className="wcol wcol--left">
            {panels.monitor ? <SystemOverview /> : null}
            <CurrentTaskCard />
            <GlobalActivity />
            {panels.headlines ? <Headlines /> : null}
          </div>

          <div className="wcol wcol--center">
            <AgentNetwork />
            {panels.agentTown ? <AgentTown /> : null}
          </div>

          {/* Console on top, the media session under it while something plays. */}
          <div className="wcol wcol--right">
            {panels.console ? <ConsoleDock /> : null}
            <NowPlaying />
          </div>
        </div>
      ) : null}

      {view === 'agents' ? <AgentsView /> : null}
      {view === 'system' ? <SystemView /> : null}

      <ConfirmDialog />
    </div>
  )
}
