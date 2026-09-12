# Paradox — frontend

The command centre. React 19 + TypeScript + Vite, no UI framework — the design system is CSS
driven by tokens in `src/styles/tokens.css`.

```bash
npm install
npm run dev      # http://localhost:5183
npm run build    # typecheck + production build
```

## Layout

Built to the command-centre reference: a title bar with three tabs, then three columns.

```
P PARADOX │ COMMAND · AGENTS · SYSTEM                            ● ONLINE
├────────────────┬────────────────────────────────┬──────────────────────┐
│ SYSTEM OVERVIEW│ AGENT NETWORK                  │ CONSOLE LOGS MEMORY  │
│ CURRENT TASK   │   4 agent cards → Paradox Core │  > SYSTEM            │
│ GLOBAL ACTIVITY│                                │  > AGENT             │
│ TODAY'S        │ AGENT TOWN                     │  > TOOL              │
│  HEADLINES     │   the office, live             │  > RESULT            │
│                │                                │ [ command input ]    │
```

`COMMAND` is the dashboard above. `AGENTS` is the roster. `SYSTEM` holds capabilities, task
history, settings and permissions.

| Surface | File | What it is |
| --- | --- | --- |
| Agent Town | `components/town/AgentTown.tsx` | The office. Characters wake, walk, work, return |
| Agent Network | `components/dashboard/AgentNetwork.tsx` | Core and spokes; links light on real delegation |
| Left column | `components/dashboard/LeftColumn.tsx` | Ring gauges, current task, world map, headlines |
| Console dock | `components/dashboard/ConsoleDock.tsx` | CONSOLE / LOGS / MEMORY, plus the command bar |
| Command bar | `components/chat/Composer.tsx` | Text + hold-to-talk with a real mic level meter |
| Agents | `components/views/AgentsView.tsx` | Per-agent state, tools, run counts |
| Capabilities | `components/views/CapabilityView.tsx` | Computer / Browser / Communication / Files / Media |
| Roster | `types/agents.ts` | Names, colours, stations, and the tool→agent map |

## The agents are not decoration

`types/agents.ts` maps every backend tool to an owner:

```
ZENO  Computer       launch_app, focus_window, click_element, type_text, press_keys, volume …
NOVA  Vision         observe_screen, read_window, find_ui_element, read_text_on_screen
AXEL  Files          current_selection, find_files, recent_files, file_operation, clipboard …
ORION Browser        browser_open, browser_navigate, browser_read, browser_click, browser_fill …
LUNA  Communication  whatsapp_open, whatsapp_search, whatsapp_send, whatsapp_send_file …
ARIA  Voice          speak, save_speech
KAI   Memory         remember, recall, forget
```

When the backend reports `task.step` with `tool: "launch_app"`, ZENO wakes, walks to the Computer
Station and starts working. Nothing in the town moves without a real tool call behind it.

They are a tool-ownership layer over one model loop, not seven independent agents with their own
contexts — the attribution is real, the delegation is a view of it.

The state machine lives in the store (`activateAgent` / `standDown`); the town only renders it.
`WAKE_MS` and `WALK_MS` in `store/session.ts` must stay in step with the transition duration in
`town.css`.

## Visual language

Jet-black ground, one accent per agent, colour used for meaning only.

- **Two type roles** — UI sans for prose; mono, uppercase, wide-tracked for machine readouts:
  panel titles, evidence lines, tool names, badges, the clock, the console.
- **Motion is state** — the core spins up while a task runs, links animate only during delegation,
  station monitors glow in their agent's colour, the stop button pulses. All of it collapses under
  `prefers-reduced-motion`.
- Both themes are complete: dark is native, light is the same system in daylight.

## The honesty rule

Spec §42: never fake an action. That constrains the code:

- Nothing renders as agent activity unless it arrived as a `ServerEvent`.
- With no backend connected, a prompt produces an explicit "nothing ran" notice.
- Step rows show the *evidence* the agent verified with, not just a checkmark.
- The ring gauges are real CPU / RAM / GPU / disk from the agent process, and the sparkline is a
  rolling window of actual CPU samples. A gauge with no source reads `—` rather than `0%`.
- The headlines are a real RSS fetch. If the feeds are unreachable the panel says so; it never
  invents a story.
- The world map behind GLOBAL ACTIVITY is a decorative backdrop and is labelled as one — the four
  counters over it (requests, active agents, running, errors) are real.
- Preview mode (SYSTEM → Settings) replays a scripted sample under a hazard-striped banner, and its
  script calls the *real* tool names — so the delegation it demonstrates is the real mapping.

## Talking to the agent

One WebSocket, JSON frames, typed in `src/types/protocol.ts`. Default `ws://127.0.0.1:8765/ws`.

**Client → server**: `prompt`, `cancel`, `confirm.response`, `voice.start|audio|stop`,
`settings.update`, `memory.forget`, `memory.clear`.

**Server → client**: `hello`, `message` / `message.delta` / `message.done`, `task.start` /
`task.update` / `task.step`, `confirm.request` / `confirm.resolved`, `observation`, `system.stats`,
`memory`, `headlines`, `voice.state`, `error`.

Notes for the backend implementer:

- A `TaskStep` is a *user-visible* step ("Opened WhatsApp"), not a tool call. Emit it `running`,
  then re-emit the same `id` as `done` with an `evidence` string from the verify phase. The `tool`
  field is what routes the step to an agent, so always set it.
- `summary` is shown verbatim as the outcome — only set it once the work is verified.
- `capabilities` from `hello` is rendered in Settings, so list what is actually wired up.
- Permission policy lives in the UI and is pushed on every connect; the agent enforces it.
