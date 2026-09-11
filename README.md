# NEXUS

A Windows AI computer assistant. You say what you want; it works out how.

> Build specs: [`frontend/Paradox— Full Product & UI Master Prompt.md`](./frontend/Paradox—%20Full%20Product%20&%20UI%20Master%20Prompt.md)
> (product + UI, current) and [`Paradox Windows Computer Assistant — Master Build Prompt.md`](./Paradox%20Windows%20Computer%20Assistant%20—%20Master%20Build%20Prompt.md)
> (the original agent spec).

## Status

| Stage | Scope | State |
| --- | --- | --- |
| 1 | UI shell: sidebar, top bar, dashboard, Agent Town, network, task panel, console, monitor | **built** |
| 2 | Windows computer control | **built** — apps, windows, mouse, keyboard, files |
| 3 | Screen understanding | **built** — UI Automation, Windows OCR, vision fallback |
| 4 | Browser agent (ORION) | **built** — Chrome/Edge over the DevTools Protocol |
| 5 | Voice agent (ARIA) | **built** — local Whisper in, Windows voices out |
| 6 | Communication agent (LUNA) | **built** — WhatsApp: search, read, send, files, audio |
| 7 | File/system agent (AXEL) | **built** |
| 8 | Real Agent Town behaviour | **built** — idle → wake → walk → work → standby, from real tool calls |
| 9 | Persistent memory | **built** — SQLite, injected into every task, deletable |
| 10 | Security, permissions, recovery | **built** — tiers, escalation, loop detection, retries |
| 11 | Polish | ongoing — incl. the now-playing bar over the Windows media session |

All eleven stages are implemented: 46 tools across seven agents.

The agent controls the computer for real. With no model key set it still runs, still sees the
machine, and refuses to act rather than pretending.

It runs on **Claude, GPT or Gemini** — set one key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or
`GEMINI_API_KEY`) and it picks the provider from whichever is present. Claude is the most reliable
for the long tool-use loops this does; Gemini Flash (`gemini-3.6-flash`) is the cheapest and its
vision is strong. `backend/.env.example` lists the models and the per-provider install extra.

## Run it

Two processes. The agent owns all computer control; the frontend is its client.

```bash
cd backend && python -m venv .venv && .venv/Scripts/python.exe -m pip install -e . && .venv/Scripts/python.exe -m paradox
```

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5183; the UI connects on its own. Put a model key in `backend/.env` first
(copy `.env.example`), or the agent will connect and then tell you it cannot decide anything. For
OpenAI or Gemini also install the extra — `pip install -e ".[openai]"` or `".[google]"`. Before
trusting it with your desktop, run `backend/selftest.py` — read-only probes of the Windows layer.

Turn on **Preview mode** under System → Settings & permissions to walk the whole interface on
clearly-marked sample data — gauges, headlines, task and console included.

## The agent team

NEXUS Core orchestrates; each agent owns a real slice of the tool registry.

| Agent | Role | State |
| --- | --- | --- |
| **ZENO** | Computer — apps, windows, mouse, keyboard, media | 13 tools |
| **NOVA** | Vision — UI Automation, screenshots, Windows OCR | 4 tools |
| **AXEL** | Files & system — search, open, move, unpack, clipboard, "this" | 7 tools |
| **ORION** | Browser — Chrome/Edge over CDP, real DOM | 10 tools |
| **LUNA** | Communication — WhatsApp: search, read, send, files, audio | 7 tools |
| **ARIA** | Voice — speech in (local Whisper) and out | 2 tools |
| **KAI** | Memory & research — what NEXUS keeps between sessions | 3 tools |

Below the console sits the now-playing bar. Windows publishes whatever is playing — Spotify, a
YouTube tab, VLC — through the system media session; the agent reads the track, artist, album art
and position from it, and the transport buttons drive that same session. Nothing playing, no bar.

The Agent Town floor is drawn, not a picture, and nobody is painted into it — so everyone standing in
the room is a live agent. One walks from the lounge to its desk when it picks up work and back when
it is done, name tag in tow. All of it is derived from tool calls the backend actually reported — the
town never mimes work.

## Layout

```
NEXUS/
├── frontend/          React 19 + TS + Vite — the command centre
│   ├── src/types/protocol.ts   ← the contract, defined here
│   ├── src/types/agents.ts     ← roster, stations, tool→agent map
│   └── src/components/town/    ← the Agent Town
└── backend/           Python agent: controller, 46 tools, permissions, memory
    ├── paradox/agent/          observe → act → verify loop, plus recovery
    ├── paradox/computer/       SendInput, UI Automation, OCR, browser CDP, WhatsApp
    ├── paradox/voice/          Whisper (worker process) and Windows speech
    ├── paradox/memory.py       what NEXUS keeps between sessions
    └── selftest.py             17 read-only probes of the machine layer
```

The agent is a separate process that owns all computer control and speaks one WebSocket protocol to
the frontend. That split keeps the model, the OS automation and the permission enforcement out of
the renderer, and it is what makes local-first enforceable: screen captures and file contents never
leave the agent process unless a step genuinely needs the model to look.

> The Python package is still named `paradox` from the earlier spec. Renaming it is mechanical and
> has not been done yet; everything user-facing says NEXUS.
