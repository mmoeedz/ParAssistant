/**
 * Wire contract between the Paradox UI and the agent backend.
 *
 * The UI never invents agent activity: every task, step and observation shown
 * on screen originates from a `ServerEvent` (or from explicitly-labelled
 * preview data, which is visually marked as such).
 */

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline'

/* ------------------------------------------------------------------ chat -- */

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageSource = 'text' | 'voice'

export interface ChatMessage {
  id: string
  role: MessageRole
  text: string
  createdAt: number
  source: MessageSource
  /** assistant message still streaming in */
  streaming?: boolean
  /** rendered as an error notice rather than a normal bubble */
  error?: boolean
  /** id of the task this message reports on, when there is one */
  taskId?: string
}

/* ------------------------------------------------------------------ task -- */

export type StepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'blocked'

export interface TaskStep {
  id: string
  /** concise past/present-tense label, e.g. "Opened WhatsApp" */
  label: string
  status: StepStatus
  /** tool that produced this step, e.g. "window_control" */
  tool?: string
  /** short evidence line from the verify phase, e.g. "active window: WhatsApp" */
  evidence?: string
  startedAt?: number
  endedAt?: number
}

export type TaskStatus =
  | 'planning'
  | 'running'
  | 'awaiting_confirmation'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface Task {
  id: string
  /** the user's goal, in their own words */
  goal: string
  status: TaskStatus
  /** short status line, e.g. "Sending..." */
  statusLine?: string
  steps: TaskStep[]
  startedAt: number
  endedAt?: number
  /** truthful one-line outcome, only set once the task actually finished */
  summary?: string
}

/* ----------------------------------------------------------- permissions -- */

export type PermissionTier = 'safe' | 'sensitive' | 'dangerous'
export type PermissionPolicy = 'auto' | 'ask' | 'never'

export type PermissionCategory =
  | 'open_apps'
  | 'read_screen'
  | 'find_files'
  | 'browse_web'
  | 'media_control'
  | 'send_messages'
  | 'send_files'
  | 'send_email'
  | 'move_files'
  | 'system_settings'
  | 'delete_files'
  | 'destructive_ops'

export interface ConfirmationRequest {
  id: string
  tier: PermissionTier
  category: PermissionCategory
  /** e.g. "Send WhatsApp message to Ahmed" */
  title: string
  /** e.g. the exact message body, or the exact path being deleted */
  detail: string
  tool: string
  params: Record<string, string>
  createdAt: number
}

/* ----------------------------------------------------------- observation -- */

export interface ScreenObservation {
  id: string
  /** data: URL of the screenshot the agent actually captured */
  image?: string
  activeWindow?: string
  /** how the agent read the screen for this step */
  method?: 'uia' | 'ocr' | 'vision' | 'dom'
  capturedAt: number
}

/* ---------------------------------------------------------------- memory -- */

export type MemoryKind = 'preference' | 'person' | 'workflow' | 'note'

export interface MemoryFact {
  id: number
  kind: MemoryKind
  key: string
  value: string
  source: string | null
  createdAt: number
  updatedAt: number
  uses: number
}

export interface MemoryStats {
  facts: number
  tasks: number
  path: string
}

/* -------------------------------------------------------------- headlines -- */

export interface Headline {
  title: string
  url: string
  source: string
  publishedAt: number | null
}

/* ----------------------------------------------------------- now playing -- */

export type PlaybackStatus = 'playing' | 'paused' | 'opened' | 'changing'

/** What Windows reports is playing — Spotify, a browser tab, VLC, anything. */
export interface NowPlaying {
  /** title + artist; the art only travels when this changes */
  key: string
  title: string
  artist: string
  album: string | null
  /** the app's model id, e.g. Spotify's */
  app: string
  status: PlaybackStatus
  /**
   * Whether the track is really moving, read from the timeline rather than
   * `status`. Players get status wrong both ways: Spotify handed off to a phone
   * reports "paused" while it plays and "playing" while it sits still.
   */
  advancing: boolean
  /** seconds — true as of `positionAge` seconds before the agent read it */
  position: number
  /** how stale `position` already was when read; players publish it only every few seconds */
  positionAge: number
  /** playback speed the player reports; 1 when it reports none */
  rate: number
  duration: number
  /** data URI, or null when it has not changed since the last frame */
  art: string | null
  can: { play: boolean; next: boolean; previous: boolean; stop: boolean; seek: boolean }
}

export type MediaAction = 'toggle' | 'next' | 'previous' | 'stop'

/* ---------------------------------------------------------------- system -- */

/** Real telemetry from the agent process. Fields absent = not readable here. */
export interface SystemStats {
  cpu: number
  cores: number
  memory: { percent: number; usedBytes: number; totalBytes: number }
  disk: { percent: number; usedBytes: number; totalBytes: number }
  processes: number
  capturedAt: number
  network?: { up: number; down: number }
  gpu?: number
  /** Hottest matching Windows thermal zone, in °C. Omitted when unreadable. */
  cpuTempC?: number
  gpuTempC?: number
  /** Dedicated video memory. Omitted when no source (nvidia-smi, or the GPU
   *  Adapter Memory counter + registry capacity) can read it. */
  vram?: { percent: number; usedBytes: number; totalBytes: number }
}

/* ----------------------------------------------------------------- voice -- */

export type VoiceState =
  | 'off'
  | 'listening'
  | 'transcribing'
  | 'speaking'

/* ---------------------------------------------------------------- events -- */

export interface ServerHello {
  type: 'hello'
  agent: string
  version: string
  /** capabilities the backend actually has wired up */
  capabilities: string[]
}

export type ServerEvent =
  | ServerHello
  | { type: 'message'; message: ChatMessage }
  | { type: 'message.delta'; id: string; text: string }
  | { type: 'message.done'; id: string }
  | { type: 'task.start'; task: Task }
  | { type: 'task.update'; taskId: string; patch: Partial<Task> }
  | { type: 'task.step'; taskId: string; step: TaskStep }
  | { type: 'confirm.request'; request: ConfirmationRequest }
  | { type: 'confirm.resolved'; requestId: string }
  | { type: 'observation'; observation: ScreenObservation }
  | { type: 'system.stats'; stats: SystemStats }
  | { type: 'memory'; facts: MemoryFact[]; stats: MemoryStats }
  | { type: 'headlines'; items: Headline[] }
  | { type: 'media'; media: NowPlaying | null }
  | { type: 'voice.state'; state: VoiceState }
  | { type: 'transcript'; text: string }
  | { type: 'pong'; id: string }
  | { type: 'error'; message: string; taskId?: string }

export type ClientEvent =
  | { type: 'prompt'; text: string; source: MessageSource }
  | { type: 'cancel'; taskId?: string }
  | { type: 'confirm.response'; requestId: string; approved: boolean; remember: boolean }
  | { type: 'voice.start'; wake?: boolean }
  | { type: 'voice.audio'; chunk: string }
  | { type: 'voice.stop'; wake?: boolean }
  | { type: 'settings.update'; settings: unknown }
  | { type: 'memory.forget'; id: number }
  | { type: 'memory.clear'; kind?: MemoryKind }
  | { type: 'media.control'; action: MediaAction }
  | { type: 'media.seek'; positionSeconds: number }
  | { type: 'ping'; id: string }
