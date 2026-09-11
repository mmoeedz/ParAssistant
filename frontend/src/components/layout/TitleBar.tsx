import { Maximize2, Minus, X } from 'lucide-react'
import { useSession, type View } from '@/store/session'
import './layout.css'

const TABS: { view: View; label: string }[] = [
  { view: 'command', label: 'COMMAND' },
  { view: 'agents', label: 'AGENTS' },
  { view: 'system', label: 'SYSTEM' },
]

/** Window controls only do something in a packaged desktop build. */
interface DesktopBridge {
  minimize?: () => void
  toggleMaximize?: () => void
  close?: () => void
}

const desktop: DesktopBridge | undefined = (
  window as unknown as { nexusDesktop?: DesktopBridge }
).nexusDesktop

export function TitleBar() {
  const view = useSession((s) => s.view)
  const setView = useSession((s) => s.setView)
  const connection = useSession((s) => s.connection)
  const preview = useSession((s) => s.preview)

  const online = preview || connection === 'online'
  const status = preview ? 'PREVIEW' : connection === 'online' ? 'ONLINE' : 'OFFLINE'

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <NexusMark />
        <span className="titlebar__name">NEXUS</span>
      </div>

      <nav className="titlebar__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            className="ttab"
            data-active={view === tab.view}
            onClick={() => setView(tab.view)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="titlebar__spacer" />

      <div className="titlebar__status" data-online={online} data-preview={preview}>
        <span className="titlebar__dot" />
        {status}
      </div>

      {desktop ? (
        <div className="titlebar__win">
          <button type="button" onClick={() => desktop.minimize?.()} title="Minimize">
            <Minus size={15} />
          </button>
          <button type="button" onClick={() => desktop.toggleMaximize?.()} title="Maximize">
            <Maximize2 size={13} />
          </button>
          <button type="button" className="close" onClick={() => desktop.close?.()} title="Close">
            <X size={15} />
          </button>
        </div>
      ) : null}
    </header>
  )
}

/** The angular N of the reference: a heavy stem, a diagonal, a detached bar. */
function NexusMark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 3h5.4v18H2z" />
      <path d="M7.4 3h5L18 15.4V21h-5L7.4 8.6z" />
      <path d="M17.2 3H22v4.6h-4.8z" />
      <path d="M17.2 9.4H22V21h-4.8z" />
    </svg>
  )
}
