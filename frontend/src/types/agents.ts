/**
 * The Paradox agent roster.
 *
 * These are not decoration. Each agent owns a real slice of the tool registry,
 * and its state in the UI is derived from tools the backend actually ran — so
 * an agent that lights up is an agent that did something.
 */

export type AgentId = 'paradox' | 'zeno' | 'orion' | 'luna' | 'nova' | 'axel' | 'aria' | 'kai'

export type AgentState =
  | 'standby'
  | 'waking'
  | 'walking'
  | 'working'
  | 'thinking'
  | 'waiting'
  | 'handoff'
  | 'completed'
  | 'blocked'
  | 'error'
  | 'returning'

export interface Station {
  id: string
  label: string
  /** Seat position in the Agent Town coordinate space (1000 x 560). */
  x: number
  y: number
}

export interface AgentDef {
  id: AgentId
  name: string
  role: string
  /** CSS custom property holding this agent's accent. */
  color: string
  station: Station
  /** Where it sits when there is nothing to do. */
  home: { x: number; y: number }
  /** Tool names this agent owns. Empty = the capability is not built yet. */
  tools: string[]
  /** Honest note when the agent has no tools wired up. */
  pending?: string
}

/**
 * Positions are in the Agent Town floor's own coordinates (790 x 350 — the
 * artwork's pixels). A station is where an agent stands to work: the walkway
 * directly under its desk, so the character lines up with its badge.
 */
/**
 * The corridor is the one obstruction-free path across the whole floor — a
 * full-width band painted into TownFloor at y = 133-152. Every walk to or
 * from a station routes through this y first, instead of cutting a diagonal
 * line through walls and furniture.
 */
export const CORRIDOR_Y = 142

/** Fallback transition duration before any walk has set a real one. */
export const DEFAULT_MOVE_MS = 900

export const STATIONS: Record<string, Station> = {
  core: { id: 'core', label: 'Paradox Core', x: 395, y: 200 },
  browser: { id: 'browser', label: 'Browser Station', x: 62, y: 138 },
  files: { id: 'files', label: 'File Room', x: 175, y: 138 },
  vision: { id: 'vision', label: 'Vision Lab', x: 282, y: 138 },
  comms: { id: 'comms', label: 'Comms Station', x: 378, y: 138 },
  computer: { id: 'computer', label: 'Computer Station', x: 464, y: 138 },
  voice: { id: 'voice', label: 'Voice Booth', x: 569, y: 138 },
  research: { id: 'research', label: 'Research Desk', x: 600, y: 232 },
  server: { id: 'server', label: 'Server Room', x: 700, y: 232 },
}

export const AGENTS: AgentDef[] = [
  {
    id: 'paradox',
    name: 'PARADOX',
    role: 'Orchestrator',
    color: 'var(--a-paradox)',
    station: STATIONS.core,
    home: { x: 395, y: 276 },
    tools: [],
  },
  {
    id: 'zeno',
    name: 'ZENO',
    role: 'Computer Agent',
    color: 'var(--a-zeno)',
    station: STATIONS.computer,
    home: { x: 546, y: 262 },
    tools: [
      'launch_app', 'list_windows', 'focus_window', 'window_action',
      'click', 'click_element', 'type_text', 'press_keys', 'scroll', 'drag', 'wait',
      'volume', 'media',
    ],
  },
  {
    id: 'nova',
    name: 'NOVA',
    role: 'Vision Agent',
    color: 'var(--a-nova)',
    station: STATIONS.vision,
    home: { x: 212, y: 260 },
    tools: ['observe_screen', 'read_window', 'find_ui_element', 'read_text_on_screen'],
  },
  {
    id: 'axel',
    name: 'AXEL',
    role: 'File & System Agent',
    color: 'var(--a-axel)',
    station: STATIONS.files,
    home: { x: 146, y: 292 },
    tools: [
      'current_selection', 'find_files', 'recent_files', 'open_file',
      'file_operation', 'extract_archive', 'clipboard',
    ],
  },
  {
    id: 'orion',
    name: 'ORION',
    role: 'Browser Agent',
    color: 'var(--a-orion)',
    station: STATIONS.browser,
    home: { x: 72, y: 260 },
    tools: [
      'browser_open', 'browser_navigate', 'browser_read', 'browser_find', 'browser_click',
      'browser_fill', 'browser_tabs', 'browser_scroll', 'browser_upload', 'browser_dialog',
    ],
  },
  {
    id: 'luna',
    name: 'LUNA',
    role: 'Communication Agent',
    color: 'var(--a-luna)',
    station: STATIONS.comms,
    home: { x: 278, y: 292 },
    tools: [
      'whatsapp_open', 'whatsapp_search', 'whatsapp_open_chat', 'whatsapp_read',
      'whatsapp_send', 'whatsapp_send_file', 'whatsapp_send_voice',
    ],
  },
  {
    id: 'aria',
    name: 'ARIA',
    role: 'Voice Agent',
    color: 'var(--a-aria)',
    station: STATIONS.voice,
    home: { x: 648, y: 294 },
    tools: ['speak', 'save_speech'],
  },
  {
    id: 'kai',
    name: 'KAI',
    role: 'Memory & Research',
    color: 'var(--a-kai)',
    station: STATIONS.research,
    home: { x: 722, y: 262 },
    tools: ['remember', 'recall', 'forget'],
  },
]

export const AGENT_BY_ID: Record<AgentId, AgentDef> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
) as Record<AgentId, AgentDef>

const TOOL_OWNER = new Map<string, AgentId>()
for (const agent of AGENTS) {
  for (const tool of agent.tools) TOOL_OWNER.set(tool, agent.id)
}

/** Which agent ran this tool. Unknown tools fall to the orchestrator. */
export function agentForTool(tool: string | undefined): AgentId {
  if (!tool) return 'paradox'
  return TOOL_OWNER.get(tool) ?? 'paradox'
}

export interface AgentRuntime {
  id: AgentId
  state: AgentState
  /** What it is doing, in the user's language. */
  activity: string | null
  /** Current position in town space; drives the walk animation. */
  x: number
  y: number
  atStation: boolean
  /** Short line shown in a speech bubble on wake. */
  says: string | null
  lastActiveAt: number | null
  /** Tool calls this agent has run this session. */
  runs: number
  /** Duration of the walk currently in flight to (x, y); drives the CSS transition. */
  moveMs: number
}

export function initialRuntime(): Record<AgentId, AgentRuntime> {
  return Object.fromEntries(
    AGENTS.map((a) => [
      a.id,
      {
        id: a.id,
        state: 'standby' as AgentState,
        activity: null,
        x: a.home.x,
        y: a.home.y,
        atStation: a.id === 'paradox',
        says: null,
        lastActiveAt: null,
        runs: 0,
        moveMs: DEFAULT_MOVE_MS,
      },
    ]),
  ) as Record<AgentId, AgentRuntime>
}

export const WAKE_LINES = [
  'On it.',
  'Got it.',
  'Heading over.',
  'Taking this one.',
  'My turn.',
]
