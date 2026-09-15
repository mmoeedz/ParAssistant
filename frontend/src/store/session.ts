import { create } from 'zustand'
import { agentSocket } from '@/transport/socket'
import { uid } from '@/lib/id'
import type {
  ChatMessage,
  ConfirmationRequest,
  ConnectionState,
  Headline,
  MediaAction,
  MemoryFact,
  MemoryStats,
  NowPlaying,
  PermissionCategory,
  PermissionPolicy,
  ScreenObservation,
  ServerEvent,
  SystemStats,
  Task,
  VoiceState,
} from '@/types/protocol'
import {
  AGENTS,
  AGENT_BY_ID,
  CORRIDOR_Y,
  WAKE_LINES,
  agentForTool,
  initialRuntime,
  type AgentId,
  type AgentRuntime,
  type AgentState,
} from '@/types/agents'
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings'
import { projectPosition } from '@/lib/mediaClock'

/** The reference has three top-level tabs; everything else lives inside them. */
export type View = 'command' | 'agents' | 'system'

export interface ActivityEntry {
  id: string
  at: number
  agentId: AgentId
  text: string
  tone: 'info' | 'good' | 'warn' | 'bad'
}

export interface ConsoleLine {
  id: string
  at: number
  level: 'info' | 'ok' | 'warn' | 'error'
  source: string
  text: string
}

const SETTINGS_KEY = 'paradox.settings.v1'
const MAX_ACTIVITY = 60
const MAX_CONSOLE = 200

/** Walk timings, shared by the store's state machine and the town's CSS. */
export const WAKE_MS = 520
export const WALK_MS = 900

/**
 * A leg's duration scales with how far it actually travels, so a short hop
 * onto the corridor doesn't take as long as crossing the whole floor on it —
 * both play at roughly the same walking speed instead of the same duration.
 */
const WALK_UNITS_PER_MS = 0.45
const MIN_LEG_MS = 220
const MAX_LEG_MS = 1200

function legDuration(dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return 0
  return Math.round(Math.min(MAX_LEG_MS, Math.max(MIN_LEG_MS, dist / WALK_UNITS_PER_MS)))
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      providers: { ...DEFAULT_SETTINGS.providers, ...saved.providers },
      voice: { ...DEFAULT_SETTINGS.voice, ...saved.voice },
      panels: { ...DEFAULT_SETTINGS.panels, ...saved.panels },
      permissions: saved.permissions?.length ? saved.permissions : DEFAULT_SETTINGS.permissions,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function persistSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* storage can be unavailable; settings stay session-only */
  }
}

interface SessionState {
  view: View
  connection: ConnectionState
  backendInfo: { agent: string; version: string; capabilities: string[] } | null
  preview: boolean

  messages: ChatMessage[]
  tasks: Task[]
  activeTaskId: string | null
  confirmation: ConfirmationRequest | null
  observation: ScreenObservation | null
  voice: VoiceState
  stats: SystemStats | null
  /** Round-trip time to the agent, from the last answered ping. Null until one lands. */
  latencyMs: number | null
  headlines: Headline[]
  /** What is playing on the machine, or null when nothing is. */
  media: NowPlaying | null
  /** performance.now() when `media.position` was last known true — the
   *  baseline the now-playing clock extrapolates forward from. */
  mediaSampledAt: number | null
  memory: { facts: MemoryFact[]; stats: MemoryStats | null }
  settings: Settings

  agents: Record<AgentId, AgentRuntime>
  activity: ActivityEntry[]
  console: ConsoleLine[]

  setView: (view: View) => void
  connect: () => void
  disconnect: () => void
  submitPrompt: (text: string, source?: 'text' | 'voice') => void
  cancelTask: () => void
  resolveConfirmation: (approved: boolean, remember: boolean) => void
  setPermission: (category: PermissionCategory, policy: PermissionPolicy) => void
  updateSettings: (patch: Partial<Settings>) => void
  setVoice: (state: VoiceState) => void
  forgetMemory: (id: number) => void
  clearMemory: () => void
  clearConsole: () => void
  applyServerEvent: (event: ServerEvent) => void
  setPreview: (on: boolean) => void
  mediaControl: (action: MediaAction) => void
  mediaSeek: (positionSeconds: number) => void
  clearConversation: () => void
  log: (level: ConsoleLine['level'], source: string, text: string) => void
}

function isTerminal(status?: Task['status']) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/**
 * Connection latency: a plain WebSocket ping/pong, timed with performance.now()
 * on this side. It measures the real round trip through the same pipeline
 * every other event travels — not a synthetic number.
 */
const PING_INTERVAL_MS = 4000
const PING_STALE_MS = 20_000
const pendingPings = new Map<string, number>()
let pingTimer: ReturnType<typeof setInterval> | null = null

function sendPing() {
  if (!agentSocket.isOpen) return
  const now = performance.now()
  for (const [id, sentAt] of pendingPings) {
    if (now - sentAt > PING_STALE_MS) pendingPings.delete(id) // its pong is never coming
  }
  const id = uid('ping')
  pendingPings.set(id, now)
  agentSocket.send({ type: 'ping', id })
}

function startPingLoop() {
  if (pingTimer) return
  sendPing()
  pingTimer = setInterval(sendPing, PING_INTERVAL_MS)
}

function stopPingLoop() {
  if (pingTimer) clearInterval(pingTimer)
  pingTimer = null
  pendingPings.clear()
}

/** Timers driving wake → walk → work. Cleared whenever an agent is retasked. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(key: string) {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  timers.delete(key)
}

function schedule(key: string, ms: number, fn: () => void) {
  clearTimer(key)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      fn()
    }, ms),
  )
}

export const useSession = create<SessionState>((set, get) => {
  const patchAgent = (id: AgentId, patch: Partial<AgentRuntime>) =>
    set((s) => ({ agents: { ...s.agents, [id]: { ...s.agents[id], ...patch } } }))

  /**
   * Send an agent to its station. The animation is cosmetic; the trigger is
   * not — this only ever runs because the backend reported a real tool call.
   */
  const activateAgent = (id: AgentId, activity: string) => {
    const def = AGENT_BY_ID[id]
    const current = get().agents[id]

    if (current.state === 'working' && current.atStation) {
      patchAgent(id, { activity, lastActiveAt: Date.now(), runs: current.runs + 1 })
      return
    }

    patchAgent(id, {
      state: 'waking',
      activity,
      says: WAKE_LINES[Math.floor(Math.random() * WAKE_LINES.length)],
      lastActiveAt: Date.now(),
      runs: current.runs + 1,
    })

    schedule(`${id}:leg1`, WAKE_MS, () => {
      const home = def.home
      const toCorridorMs = legDuration(0, home.y - CORRIDOR_Y)
      patchAgent(id, {
        state: 'walking',
        x: home.x,
        y: CORRIDOR_Y,
        atStation: false,
        moveMs: toCorridorMs,
      })
      schedule(`${id}:leg2`, toCorridorMs, () => {
        const alongMs = legDuration(def.station.x - home.x, 0)
        patchAgent(id, { x: def.station.x, y: CORRIDOR_Y, moveMs: alongMs })
        schedule(`${id}:leg3`, alongMs, () => {
          const toStationMs = legDuration(0, CORRIDOR_Y - def.station.y)
          patchAgent(id, { x: def.station.x, y: def.station.y, moveMs: toStationMs })
          schedule(`${id}:work`, toStationMs, () => {
            patchAgent(id, { state: 'working', atStation: true, says: null })
          })
        })
      })
    })
  }

  const standDown = (id: AgentId, state: AgentState = 'completed') => {
    const def = AGENT_BY_ID[id]
    if (get().agents[id].state === 'standby') return
    clearTimer(`${id}:leg1`)
    clearTimer(`${id}:leg2`)
    clearTimer(`${id}:leg3`)
    clearTimer(`${id}:work`)
    patchAgent(id, { state, says: null })
    schedule(`${id}:home`, 900, () => {
      const station = def.station
      const toCorridorMs = legDuration(0, CORRIDOR_Y - station.y)
      patchAgent(id, {
        state: 'returning',
        x: station.x,
        y: CORRIDOR_Y,
        atStation: false,
        moveMs: toCorridorMs,
      })
      schedule(`${id}:rleg1`, toCorridorMs, () => {
        const alongMs = legDuration(def.home.x - station.x, 0)
        patchAgent(id, { x: def.home.x, y: CORRIDOR_Y, moveMs: alongMs })
        schedule(`${id}:rleg2`, alongMs, () => {
          const toHomeMs = legDuration(0, CORRIDOR_Y - def.home.y)
          patchAgent(id, { x: def.home.x, y: def.home.y, moveMs: toHomeMs })
          schedule(`${id}:idle`, toHomeMs, () => {
            patchAgent(id, { state: 'standby', activity: null, atStation: id === 'paradox' })
          })
        })
      })
    })
  }

  const releaseAll = (state: AgentState = 'completed') => {
    for (const agent of AGENTS) standDown(agent.id, state)
  }

  const pushActivity = (agentId: AgentId, text: string, tone: ActivityEntry['tone'] = 'info') =>
    set((s) => ({
      activity: [
        ...s.activity.slice(-(MAX_ACTIVITY - 1)),
        { id: uid('act'), at: Date.now(), agentId, text, tone },
      ],
    }))

  const pushLog = (level: ConsoleLine['level'], source: string, text: string) =>
    set((s) => ({
      console: [
        ...s.console.slice(-(MAX_CONSOLE - 1)),
        { id: uid('log'), at: Date.now(), level, source, text },
      ],
    }))

  return {
    view: 'command',
    connection: 'idle',
    backendInfo: null,
    preview: false,

    messages: [],
    tasks: [],
    activeTaskId: null,
    confirmation: null,
    observation: null,
    voice: 'off',
    stats: null,
    latencyMs: null,
    headlines: [],
    media: null,
    mediaSampledAt: null,
    memory: { facts: [], stats: null },
    settings: loadSettings(),

    agents: initialRuntime(),
    activity: [],
    console: [],

    setView: (view) => set({ view }),
    log: pushLog,

    connect: () => agentSocket.connect(get().settings.backendUrl),

    disconnect: () => {
      stopPingLoop()
      agentSocket.disconnect()
      set({ connection: 'idle', backendInfo: null, stats: null, media: null, mediaSampledAt: null, latencyMs: null })
    },

    submitPrompt: (text, source = 'text') => {
      const trimmed = text.trim()
      if (!trimmed) return

      set((s) => ({
        messages: [
          ...s.messages,
          { id: uid('msg'), role: 'user', text: trimmed, createdAt: Date.now(), source },
        ],
      }))

      if (get().preview) {
        void import('@/transport/preview').then((m) => m.runPreview(trimmed, get().applyServerEvent))
        return
      }

      const sent = agentSocket.send({ type: 'prompt', text: trimmed, source })
      if (!sent) {
        pushLog('error', 'transport', 'prompt dropped — no agent connected')
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: uid('msg'),
              role: 'system',
              text: 'Not connected to the Paradox agent, so nothing ran. Start the backend, then reconnect from Settings.',
              createdAt: Date.now(),
              source: 'text',
              error: true,
            },
          ],
        }))
      }
    },

    cancelTask: () => {
      const { activeTaskId, preview } = get()
      if (preview) {
        void import('@/transport/preview').then((m) => m.stopPreview())
      } else {
        agentSocket.send({ type: 'cancel', taskId: activeTaskId ?? undefined })
      }
      if (!activeTaskId) return
      pushLog('warn', 'paradox', 'task cancelled by the user')
      pushActivity('paradox', 'Task stopped', 'warn')
      releaseAll('completed')
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === activeTaskId
            ? {
                ...t,
                status: 'cancelled' as const,
                statusLine: 'Cancelled',
                endedAt: Date.now(),
                steps: t.steps.map((step) =>
                  step.status === 'running' ? { ...step, status: 'skipped' as const } : step,
                ),
              }
            : t,
        ),
        activeTaskId: null,
      }))
    },

    resolveConfirmation: (approved, remember) => {
      const request = get().confirmation
      if (!request) return
      if (get().preview) {
        void import('@/transport/preview').then((m) => m.resolvePreviewConfirmation(approved))
      } else {
        agentSocket.send({ type: 'confirm.response', requestId: request.id, approved, remember })
      }
      if (remember && approved) get().setPermission(request.category, 'auto')
      pushLog(approved ? 'ok' : 'warn', 'permissions',
        `${approved ? 'approved' : 'declined'}: ${request.title}`)
      set({ confirmation: null })
    },

    setPermission: (category, policy) => {
      set((s) => {
        const settings: Settings = {
          ...s.settings,
          permissions: s.settings.permissions.map((rule) =>
            rule.category === category ? { ...rule, policy } : rule,
          ),
        }
        persistSettings(settings)
        agentSocket.send({ type: 'settings.update', settings })
        return { settings }
      })
    },

    updateSettings: (patch) => {
      set((s) => {
        const settings: Settings = { ...s.settings, ...patch }
        persistSettings(settings)
        agentSocket.send({ type: 'settings.update', settings })
        return { settings }
      })
    },

    setVoice: (voice) => set({ voice }),

    forgetMemory: (id) => {
      agentSocket.send({ type: 'memory.forget', id })
      pushLog('info', 'memory', `forgot fact #${id}`)
    },

    clearMemory: () => {
      agentSocket.send({ type: 'memory.clear' })
      pushLog('warn', 'memory', 'cleared all stored memory')
    },

    clearConsole: () => set({ console: [] }),

    setPreview: (on) => {
      const reset = {
        messages: [],
        tasks: [],
        activeTaskId: null,
        confirmation: null,
        observation: null,
        voice: 'off' as VoiceState,
        activity: [],
        console: [],
        agents: initialRuntime(),
      }
      timers.forEach((t) => clearTimeout(t))
      timers.clear()

      if (on) {
        stopPingLoop()
        agentSocket.disconnect()
        set({
          preview: true,
          connection: 'idle',
          backendInfo: null,
          stats: null,
          latencyMs: null,
          ...reset,
        })
        void import('@/transport/preview').then((m) => m.startAmbient(get().applyServerEvent))
        return
      }
      void import('@/transport/preview').then((m) => {
        m.stopPreview()
        m.stopAmbient()
      })
      set({ preview: false, stats: null, headlines: [], media: null, mediaSampledAt: null, ...reset })
      if (get().settings.autoConnect) get().connect()
    },

    mediaControl: (action) => {
      // Flip play/pause straight away. The player takes up to a poll to report
      // the change, and a button that looks dead for a second reads as broken;
      // the next frame from the agent corrects this if the app refused.
      //
      // The freeze/resume point has to be where the clock actually is right
      // now, not the last sample it arrived with — pausing mid-song must not
      // snap the bar back to a position from up to a second ago.
      const current = get().media
      const anchor = get().mediaSampledAt
      if (action === 'toggle' && current) {
        // What the button means is whatever it is currently showing, and a
        // stalled player is shown stopped however it labels itself — so a
        // press on a "playing" session that is not moving reads as play, the
        // same way the real session will take it.
        const running = current.advancing ?? current.status === 'playing'
        const now = performance.now()
        set({
          media: {
            ...current,
            // Freeze exactly where the player's clock is at the press (rate
            // included), not where the last sample happened to leave it.
            position: running && anchor != null ? projectPosition(current, anchor, now) : current.position,
            status: running ? 'paused' : 'playing',
            // Start the clock on the press, not on the agent's next poll —
            // and never leave it running into a pause.
            advancing: !running,
          },
          mediaSampledAt: now,
        })
      }

      if (get().preview) {
        void import('@/transport/preview').then((m) => m.previewMedia(action, get().applyServerEvent))
        return
      }
      agentSocket.send({ type: 'media.control', action })
    },

    mediaSeek: (positionSeconds) => {
      // Scrubbing needs the same zero-latency treatment as pause/resume: jump
      // the bar to the dropped position immediately rather than waiting for
      // the agent to confirm the real player actually moved there.
      const current = get().media
      if (!current) return
      const position = Math.max(0, Math.min(current.duration, positionSeconds))
      set({ media: { ...current, position }, mediaSampledAt: performance.now() })

      if (get().preview) {
        void import('@/transport/preview').then((m) => m.previewSeek(position, get().applyServerEvent))
        return
      }
      agentSocket.send({ type: 'media.seek', positionSeconds: position })
    },

    clearConversation: () =>
      set({ messages: [], tasks: [], activeTaskId: null, confirmation: null, activity: [] }),

    applyServerEvent: (event) => {
      switch (event.type) {
        case 'hello':
          set({
            backendInfo: {
              agent: event.agent,
              version: event.version,
              capabilities: event.capabilities,
            },
          })
          pushLog('ok', 'paradox', `${event.agent} ${event.version} online — ${event.capabilities.join(', ')}`)
          break

        case 'message':
          set((s) => ({ messages: [...s.messages, event.message] }))
          if (event.message.role === 'system' && event.message.error) {
            pushLog('error', 'paradox', event.message.text)
          }
          break

        case 'message.delta':
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === event.id ? { ...m, text: m.text + event.text, streaming: true } : m,
            ),
          }))
          break

        case 'message.done':
          set((s) => ({
            messages: s.messages.map((m) => (m.id === event.id ? { ...m, streaming: false } : m)),
          }))
          break

        case 'task.start':
          set((s) => ({ tasks: [...s.tasks, event.task], activeTaskId: event.task.id }))
          patchAgent('paradox', { state: 'thinking', activity: 'Analysing the request', atStation: true })
          pushActivity('paradox', `Task received: ${event.task.goal}`)
          pushLog('info', 'paradox', `task received: ${event.task.goal}`)
          break

        case 'task.update': {
          const patch = event.patch
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === event.taskId ? { ...t, ...patch } : t)),
            activeTaskId: isTerminal(patch.status) ? null : s.activeTaskId,
          }))
          if (patch.status === 'awaiting_confirmation') {
            patchAgent('paradox', { state: 'waiting', activity: 'Waiting for you' })
          }
          if (patch.status === 'running') {
            patchAgent('paradox', { state: 'working', activity: 'Coordinating' })
          }
          if (isTerminal(patch.status)) {
            const tone = patch.status === 'succeeded' ? 'good' : 'bad'
            pushActivity('paradox', patch.summary ?? `Task ${patch.status}`, tone)
            pushLog(patch.status === 'succeeded' ? 'ok' : 'error', 'paradox',
              `task ${patch.status}${patch.summary ? ` — ${patch.summary}` : ''}`)
            releaseAll(patch.status === 'succeeded' ? 'completed' : 'error')
          }
          break
        }

        case 'task.step': {
          const step = event.step
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (t.id !== event.taskId) return t
              const exists = t.steps.some((existing) => existing.id === step.id)
              return {
                ...t,
                steps: exists
                  ? t.steps.map((existing) =>
                      existing.id === step.id ? { ...existing, ...step } : existing,
                    )
                  : [...t.steps, step],
              }
            }),
          }))

          const owner = agentForTool(step.tool)
          if (step.status === 'running') {
            activateAgent(owner, step.label)
            pushLog('info', step.tool ?? 'paradox', step.label)
          } else if (step.status === 'done') {
            patchAgent(owner, { activity: step.label })
            pushActivity(owner, step.label, 'good')
            pushLog('ok', step.tool ?? 'paradox',
              step.evidence ? `${step.label} — ${step.evidence}` : step.label)
          } else if (step.status === 'failed' || step.status === 'blocked') {
            patchAgent(owner, { state: step.status === 'blocked' ? 'blocked' : 'error' })
            pushActivity(owner, step.label, step.status === 'blocked' ? 'warn' : 'bad')
            pushLog(step.status === 'blocked' ? 'warn' : 'error', step.tool ?? 'paradox',
              step.evidence ? `${step.label} — ${step.evidence}` : step.label)
          }
          break
        }

        case 'confirm.request':
          set({ confirmation: event.request })
          pushActivity('paradox', `Needs your approval: ${event.request.title}`, 'warn')
          pushLog('warn', 'permissions', `awaiting approval — ${event.request.title}`)
          break

        case 'confirm.resolved':
          set((s) => (s.confirmation?.id === event.requestId ? { confirmation: null } : s))
          break

        case 'observation':
          set({ observation: event.observation })
          break

        case 'system.stats':
          set({ stats: event.stats })
          break

        case 'memory':
          set({ memory: { facts: event.facts, stats: event.stats } })
          break

        case 'headlines':
          set({ headlines: event.items })
          break

        case 'media': {
          const incoming = event.media
          if (!incoming) {
            set({ media: null, mediaSampledAt: null })
            break
          }
          // Art is only sent when the track changes; keep the one we have.
          const held = get().media
          const art = incoming.art ?? (held?.key === incoming.key ? held.art : null)

          // The position was true when the player last published it, not when
          // it reached us — up to several seconds earlier. Anchoring it at that
          // real instant puts every sample on the player's own timeline, so a
          // repeat of the same publish lands exactly where the rail already is
          // and a fresh one only corrects by transit time. Anchoring at receipt
          // instead is what made the rail lag, then leap 3-6s on each publish.
          const age = Number.isFinite(incoming.positionAge) ? incoming.positionAge : 0
          set({ media: { ...incoming, art }, mediaSampledAt: performance.now() - age * 1000 })
          break
        }

        case 'voice.state':
          set({ voice: event.state })
          break

        case 'pong': {
          const sentAt = pendingPings.get(event.id)
          if (sentAt !== undefined) {
            pendingPings.delete(event.id)
            set({ latencyMs: Math.round(performance.now() - sentAt) })
          }
          break
        }

        case 'transcript':
          // What Google Speech-to-Text actually heard, shown before the task
          // starts — the only way to tell "it understood me" from "it heard
          // something else".
          pushLog('ok', 'voice', `heard: "${event.text}"`)
          break

        case 'error':
          pushLog('error', 'paradox', event.message)
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: uid('msg'),
                role: 'system',
                text: event.message,
                createdAt: Date.now(),
                source: 'text',
                error: true,
                taskId: event.taskId,
              },
            ],
          }))
          break
      }
    },
  }
})

/** Wire the socket callbacks into the store once, at boot. */
export function bootstrapTransport() {
  agentSocket.onEvent = (event) => useSession.getState().applyServerEvent(event)
  agentSocket.onState = (state) => {
    if (useSession.getState().preview) return
    useSession.setState({ connection: state })
    if (state === 'online') {
      // The UI owns the permission settings; the agent enforces them. Push them
      // on every connect so a restarted agent never runs on stale policy.
      agentSocket.send({ type: 'settings.update', settings: useSession.getState().settings })
      startPingLoop()
    }
    if (state === 'offline') {
      useSession.getState().log('warn', 'transport', 'agent connection lost')
      // Nothing is known about the machine now, the music included — a bar
      // left showing the last track would be claiming something it cannot see.
      stopPingLoop()
      useSession.setState({ stats: null, media: null, mediaSampledAt: null, latencyMs: null })
    }
  }
  const { settings, connect } = useSession.getState()
  if (settings.autoConnect) connect()
}
