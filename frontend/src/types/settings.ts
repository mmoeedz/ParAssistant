import type { PermissionCategory, PermissionPolicy, PermissionTier } from './protocol'

export interface PermissionRule {
  category: PermissionCategory
  tier: PermissionTier
  label: string
  description: string
  policy: PermissionPolicy
}

export interface ProviderSettings {
  /** model provider id, e.g. "anthropic" | "openai" | "local" */
  model: string
  modelName: string
  stt: string
  tts: string
  ttsVoice: string
}

export interface VoiceSettings {
  pushToTalkKey: string
  wakeWordEnabled: boolean
  wakeWord: string
  speakReplies: boolean
}

export interface PanelSettings {
  console: boolean
  monitor: boolean
  headlines: boolean
  agentTown: boolean
}

export interface Settings {
  theme: 'dark' | 'light'
  /** what NEXUS calls the user in the greeting */
  userName: string
  backendUrl: string
  autoConnect: boolean
  /** narrate every low-level action instead of concise summaries */
  verboseActivity: boolean
  panels: PanelSettings
  permissions: PermissionRule[]
  providers: ProviderSettings
  voice: VoiceSettings
}

export const DEFAULT_PERMISSIONS: PermissionRule[] = [
  {
    category: 'open_apps',
    tier: 'safe',
    label: 'Open applications',
    description: 'Launch and switch between installed apps.',
    policy: 'auto',
  },
  {
    category: 'read_screen',
    tier: 'safe',
    label: 'Read the screen',
    description: 'Screenshots, OCR and Windows UI Automation to see what is on screen.',
    policy: 'auto',
  },
  {
    category: 'find_files',
    tier: 'safe',
    label: 'Find files',
    description: 'Search and inspect files and folders. Read only.',
    policy: 'auto',
  },
  {
    category: 'browse_web',
    tier: 'safe',
    label: 'Browse the web',
    description: 'Open URLs, search and navigate pages in Chrome or Edge.',
    policy: 'auto',
  },
  {
    category: 'media_control',
    tier: 'safe',
    label: 'Media and volume',
    description: 'Play, pause, skip, change volume and mute.',
    policy: 'auto',
  },
  {
    category: 'send_messages',
    tier: 'sensitive',
    label: 'Send messages',
    description: 'Send WhatsApp, Telegram or Discord messages on your behalf.',
    policy: 'ask',
  },
  {
    category: 'send_files',
    tier: 'sensitive',
    label: 'Send or upload files',
    description: 'Attach files to a chat, upload to a website or share them.',
    policy: 'ask',
  },
  {
    category: 'send_email',
    tier: 'sensitive',
    label: 'Send email',
    description: 'Compose and send mail from your accounts.',
    policy: 'ask',
  },
  {
    category: 'move_files',
    tier: 'sensitive',
    label: 'Move, rename and copy files',
    description: 'Change where files live on disk. Reversible.',
    policy: 'auto',
  },
  {
    category: 'system_settings',
    tier: 'dangerous',
    label: 'Change system settings',
    description: 'Wi-Fi, Bluetooth, security and Windows settings.',
    policy: 'ask',
  },
  {
    category: 'delete_files',
    tier: 'dangerous',
    label: 'Delete files',
    description: 'Move files to the Recycle Bin or delete them permanently.',
    policy: 'ask',
  },
  {
    category: 'destructive_ops',
    tier: 'dangerous',
    label: 'Destructive system operations',
    description: 'Uninstalls, registry edits, formatting and anything not undoable.',
    policy: 'ask',
  },
]

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  userName: 'Moeed',
  backendUrl: 'ws://127.0.0.1:8765/ws',
  autoConnect: true,
  verboseActivity: false,
  panels: { console: true, monitor: true, headlines: true, agentTown: true },
  permissions: DEFAULT_PERMISSIONS,
  providers: {
    model: 'anthropic',
    modelName: 'claude-opus-5',
    stt: 'faster-whisper (local)',
    tts: 'piper (local)',
    ttsVoice: 'en_GB-alba-medium',
  },
  voice: {
    pushToTalkKey: 'Space',
    wakeWordEnabled: false,
    wakeWord: 'NEXUS',
    speakReplies: true,
  },
}
