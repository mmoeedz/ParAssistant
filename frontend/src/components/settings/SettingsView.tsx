import { Brain, LayoutGrid, Mic, Plug, ShieldCheck, TriangleAlert, User } from 'lucide-react'
import { useSession } from '@/store/session'
import { Badge, Button, Field, StatusDot, Toggle } from '@/components/ui'
import { PermissionRules } from './PermissionRules'
import './settings.css'

const PTT_KEYS = [
  { code: 'Space', label: 'Space' },
  { code: 'AltLeft', label: 'Left Alt' },
  { code: 'ControlRight', label: 'Right Ctrl' },
  { code: 'F9', label: 'F9' },
]

export function SettingsView() {
  const settings = useSession((s) => s.settings)
  const update = useSession((s) => s.updateSettings)
  const connection = useSession((s) => s.connection)
  const backendInfo = useSession((s) => s.backendInfo)
  const connect = useSession((s) => s.connect)
  const disconnect = useSession((s) => s.disconnect)
  const preview = useSession((s) => s.preview)
  const setPreview = useSession((s) => s.setPreview)

  const panel = (key: keyof typeof settings.panels, value: boolean) =>
    update({ panels: { ...settings.panels, [key]: value } })

  return (
    <div className="view">
      <div className="view__inner">
        <div className="view__head">
          <h2>Settings</h2>
          <p>Who you are, where the agent lives, what it may do on its own, and what is on screen.</p>
        </div>

        {/* ---------------------------------------------------------- you -- */}
        <section className="group">
          <div className="group__head">
            <User size={14} />
            <span className="section-title">Operator</span>
          </div>
          <div className="rows">
            <Field label="Name" hint="Used in the greeting and nowhere else.">
              <input
                className="input"
                value={settings.userName}
                onChange={(e) => update({ userName: e.target.value })}
              />
            </Field>
          </div>
        </section>

        {/* --------------------------------------------------- connection -- */}
        <section className="group">
          <div className="group__head">
            <Plug size={14} />
            <span className="section-title">Agent connection</span>
          </div>
          <div className="rows">
            <Field
              label="Backend address"
              hint="The Paradox agent process on this machine. It does the actual computer control."
            >
              <input
                className="input"
                value={settings.backendUrl}
                spellCheck={false}
                onChange={(e) => update({ backendUrl: e.target.value })}
              />
            </Field>
            <Toggle
              checked={settings.autoConnect}
              onChange={(v) => update({ autoConnect: v })}
              label="Connect automatically on launch"
            />
          </div>
          <div className="conninfo">
            <StatusDot
              tone={connection === 'online' ? 'online' : connection === 'connecting' ? 'busy' : 'offline'}
            />
            {connection === 'online' ? (
              <span>
                Connected to {backendInfo?.agent} {backendInfo?.version}
              </span>
            ) : connection === 'connecting' ? (
              <span>Connecting…</span>
            ) : (
              <span>Not connected — no computer control is available.</span>
            )}
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={() => (connection === 'online' ? disconnect() : connect())}>
              {connection === 'online' ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
          {backendInfo?.capabilities?.length ? (
            <div className="caps">
              {backendInfo.capabilities.map((c) => (
                <Badge key={c}>{c}</Badge>
              ))}
            </div>
          ) : null}
        </section>

        {/* -------------------------------------------------------- model -- */}
        <section className="group">
          <div className="group__head">
            <Brain size={14} />
            <span className="section-title">Model</span>
          </div>
          <div className="rows rows--2">
            <Field label="Provider">
              <select
                className="input"
                value={settings.providers.model}
                onChange={(e) => update({ providers: { ...settings.providers, model: e.target.value } })}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="local">Local (Ollama / vLLM)</option>
              </select>
            </Field>
            <Field label="Model" hint="Needs vision for when UI Automation falls short.">
              <input
                className="input"
                value={settings.providers.modelName}
                spellCheck={false}
                onChange={(e) =>
                  update({ providers: { ...settings.providers, modelName: e.target.value } })
                }
              />
            </Field>
          </div>
          <div className="danger-note" style={{ background: 'transparent' }}>
            <TriangleAlert size={14} />
            <span>
              These fields describe what the agent is configured with. The agent reads its own model
              and API key from its environment — keys never live in this interface or in the source.
            </span>
          </div>
        </section>

        {/* -------------------------------------------------------- voice -- */}
        <section className="group">
          <div className="group__head">
            <Mic size={14} />
            <span className="section-title">Voice</span>
          </div>
          <div className="rows rows--2">
            <Field label="Speech to text">
              <input
                className="input"
                value={settings.providers.stt}
                onChange={(e) => update({ providers: { ...settings.providers, stt: e.target.value } })}
              />
            </Field>
            <Field label="Text to speech">
              <input
                className="input"
                value={settings.providers.tts}
                onChange={(e) => update({ providers: { ...settings.providers, tts: e.target.value } })}
              />
            </Field>
            <Field label="Voice" hint="For spoken replies and for voice messages it records.">
              <input
                className="input"
                value={settings.providers.ttsVoice}
                onChange={(e) =>
                  update({ providers: { ...settings.providers, ttsVoice: e.target.value } })
                }
              />
            </Field>
            <Field label="Push to talk">
              <select
                className="input"
                value={settings.voice.pushToTalkKey}
                onChange={(e) => update({ voice: { ...settings.voice, pushToTalkKey: e.target.value } })}
              >
                {PTT_KEYS.map((k) => (
                  <option key={k.code} value={k.code}>
                    Hold {k.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="rows">
            <Toggle
              checked={settings.voice.speakReplies}
              onChange={(v) => update({ voice: { ...settings.voice, speakReplies: v } })}
              label="Speak replies out loud"
            />
            <Toggle
              checked={settings.voice.wakeWordEnabled}
              onChange={(v) => update({ voice: { ...settings.voice, wakeWordEnabled: v } })}
              label={`Listen for the wake word "${settings.voice.wakeWord}"`}
            />
          </div>
          <div className="danger-note" style={{ background: 'transparent' }}>
            <TriangleAlert size={14} />
            <span>
              Speech recognition and spoken replies both go through Google Cloud — audio and reply
              text leave this machine to be processed there. With the wake word on, the mic stays
              open while this tab is open: every phrase you say is transcribed and checked for the
              wake word, and only what you say after it is ever acted on — this sends more audio to
              Google than push-to-talk, which only transcribes while you hold the key. These
              provider names describe the agent's configuration; it reads the real values from its
              own environment.
            </span>
          </div>
        </section>

        {/* ------------------------------------------------------- panels -- */}
        <section className="group">
          <div className="group__head">
            <LayoutGrid size={14} />
            <span className="section-title">Dashboard panels</span>
          </div>
          <div className="rows">
            <Toggle checked={settings.panels.agentTown} onChange={(v) => panel('agentTown', v)}
                    label="Agent Town" />
            <Toggle checked={settings.panels.console} onChange={(v) => panel('console', v)}
                    label="Console" />
            <Toggle checked={settings.panels.monitor} onChange={(v) => panel('monitor', v)}
                    label="System monitor" />
            <Toggle checked={settings.panels.headlines} onChange={(v) => panel('headlines', v)}
                    label="Today's headlines" />
            <Toggle checked={settings.verboseActivity} onChange={(v) => update({ verboseActivity: v })}
                    label="Show which tool ran each step" />
            <Toggle
              checked={preview}
              onChange={setPreview}
              label="Preview mode — clearly-marked sample data, agent disconnected"
            />
          </div>
          {preview ? (
            <div className="danger-note">
              <TriangleAlert size={14} />
              <span>
                Preview is on. Everything on screen is scripted sample data and nothing on this
                computer is touched.
              </span>
            </div>
          ) : null}
        </section>

        {/* -------------------------------------------------- permissions -- */}
        <div className="view__head" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <ShieldCheck size={18} /> Permissions
          </h2>
          <p>
            Paradox controls a real computer. These rules decide what it does on its own, what it
            checks with you first, and what it never touches. They are enforced by the agent, not by
            this window.
          </p>
        </div>
        <PermissionRules />
      </div>
    </div>
  )
}
