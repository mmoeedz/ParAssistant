import { useSession } from '@/store/session'
import { AGENT_BY_ID, type AgentId } from '@/types/agents'
import { Badge, Button } from '@/components/ui'
import './views.css'

/**
 * The per-capability sections (Computer, Browser, Communication, Files, Media).
 *
 * These do not invent state. They show which agent owns the area, whether it is
 * actually wired up, the real tools behind it, and quick ways to ask for
 * something in that area — which go through the same prompt path as typing.
 */

export interface CapabilityConfig {
  agent: AgentId
  title: string
  blurb: string
  examples: string[]
  /** Extra tools owned by other agents but belonging to this section. */
  extraTools?: string[]
  notes?: string[]
}

export function CapabilityView({ config }: { config: CapabilityConfig }) {
  const def = AGENT_BY_ID[config.agent]
  const runtime = useSession((s) => s.agents[config.agent])
  const submitPrompt = useSession((s) => s.submitPrompt)
  const setView = useSession((s) => s.setView)
  const connection = useSession((s) => s.connection)
  const preview = useSession((s) => s.preview)

  const tools = [...def.tools, ...(config.extraTools ?? [])]
  const wired = tools.length > 0
  const canRun = preview || connection === 'online'

  const ask = (text: string) => {
    submitPrompt(text)
    setView('command')
  }

  return (
    <div className="view" style={{ ['--tone' as string]: def.color }}>
      <div className="view__inner">
        <div className="view__head">
          <h2>{config.title}</h2>
          <p>{config.blurb}</p>
        </div>

        <div className="owner">
          <span className="owner__mark" />
          <div className="owner__text">
            <div className="owner__name">
              {def.name} <span>· {def.role}</span>
            </div>
            <div className="owner__state">
              {runtime.activity ?? (wired ? 'On standby.' : def.pending)}
            </div>
          </div>
          <Badge tone={wired ? 'good' : 'warn'}>{wired ? 'wired up' : 'not built yet'}</Badge>
        </div>

        {wired ? (
          <section className="group">
            <div className="group__head">
              <span className="section-title">Tools behind this</span>
              <span className="panel__count">{tools.length}</span>
            </div>
            <div className="group__body">
              <div className="acard__tools">
                {tools.map((tool) => (
                  <span key={tool} className="tool-chip">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {config.notes?.length ? (
          <section className="group">
            <div className="group__head">
              <span className="section-title">Honest limits</span>
            </div>
            <div className="group__body">
              <ul className="notes">
                {config.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="group">
          <div className="group__head">
            <span className="section-title">Try it</span>
          </div>
          <div className="group__body">
            <div className="hero__chips">
              {config.examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="chip"
                  disabled={!canRun}
                  onClick={() => ask(example)}
                >
                  {example}
                </button>
              ))}
            </div>
            {!canRun ? (
              <p className="notes__warn">
                The agent is offline, so these would do nothing.{' '}
                <Button size="sm" variant="ghost" onClick={() => setView('system')}>
                  Connect
                </Button>
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

export const COMPUTER: CapabilityConfig = {
  agent: 'zeno',
  title: 'Computer',
  blurb:
    'Applications, windows, mouse and keyboard. ZENO prefers named UI Automation controls and falls back to coordinates only when a window exposes nothing readable.',
  examples: [
    'Open Notepad',
    'What windows do I have open?',
    'Read the text on my screen',
    'Minimise everything',
  ],
  notes: [
    'Clicking a control called Send, Delete, Buy or Pay is escalated to the matching permission tier — a click is only as safe as what it lands on.',
    'Typing into a password field is refused outright.',
    'When a window exposes no UI Automation, NOVA reads it with the Windows OCR engine before anything is sent to the model to look at.',
  ],
}

export const BROWSER: CapabilityConfig = {
  agent: 'orion',
  title: 'Browser',
  blurb:
    'Chrome and Edge over the DevTools Protocol, so ORION works with real page elements — link text, form fields, load state — instead of guessing at pixels.',
  examples: [
    'Search the web for RTX 5070 prices and tell me the cheapest',
    'Open YouTube',
    'Read this page and summarise it',
  ],
  notes: [
    'Paradox drives a browser started with automation enabled, using its own profile. The first visit to a site will not be logged in as you.',
    'Downloads land in the normal Downloads folder, where AXEL can find them.',
  ],
}

export const COMMUNICATION: CapabilityConfig = {
  agent: 'luna',
  title: 'Communication',
  blurb:
    'WhatsApp Desktop, read and written through UI Automation. Every send confirms the recipient from the app itself before typing, then reads the thread back to check the message actually arrived.',
  examples: [
    'Message Ahmed that I will be home at 8',
    'Read my last messages with Ahmed',
    'Send Ahmed a voice message saying I will call him tonight',
  ],
  notes: [
    'A voice message goes as a playable audio attachment, not a recorded voice note — WhatsApp only records those from a live microphone.',
    'Sending is gated by the "send messages" permission, which asks by default and shows you the exact recipient and text.',
    'Telegram and Discord are not installed on this machine, and email has no tools yet.',
  ],
}

export const FILES: CapabilityConfig = {
  agent: 'axel',
  title: 'Files',
  blurb:
    'Finding, opening, moving and unpacking. AXEL also resolves what you mean by "this" — the Explorer selection, the clipboard, and recently changed files.',
  examples: [
    'Open the file I just downloaded',
    'What is selected right now?',
    'Find the PDFs in my Downloads',
    'Move this to my desktop',
  ],
  notes: [
    'Deleting moves files to the Recycle Bin. There is no permanent-delete path in the tool surface.',
    'Searches cover Downloads, Desktop, Documents, Pictures, Videos and Music unless you name a folder.',
  ],
}

export const MEDIA: CapabilityConfig = {
  agent: 'aria',
  title: 'Media & voice',
  blurb:
    'Playback and volume, plus speech in and out. Hold the talk key and Paradox transcribes what you said locally with Whisper; replies can be spoken back through the Windows voices.',
  examples: ['Play some music', 'Turn the volume up', 'Open Spotify', 'Read that back to me'],
  extraTools: ['volume', 'media'],
  notes: [
    'Speech recognition runs on this machine — the audio never leaves it.',
    'Windows voices are used by default. Neural voices are available but send the text to Microsoft, so they are opt-in.',
    'Windows exposes no reliable read-back for the volume level, so a volume change is reported as sent, not as verified.',
    'The wake word is not implemented; use push-to-talk.',
  ],
}
