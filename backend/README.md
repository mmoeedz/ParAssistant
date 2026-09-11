# NEXUS — agent

The process that actually controls the computer. Python 3.11+, Windows.

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e .
cp .env.example .env          # then put your ANTHROPIC_API_KEY in it
.venv/Scripts/python.exe -m paradox
```

It listens on `ws://127.0.0.1:8765/ws` and speaks the protocol in
[`frontend/src/types/protocol.ts`](../frontend/src/types/protocol.ts).

Check the machine layer before trusting it with anything:

```bash
.venv/Scripts/python.exe selftest.py
```

17 read-only probes — windows, UI Automation, screen capture, OCR, Start-menu
resolution, Explorer selection, browser attachment, WhatsApp, speech in and out,
memory. It moves no mouse and sends no message.

## Shape

```
paradox/
├── server.py        WebSocket server; one Session per connected UI
├── protocol.py      Event constructors — mirrors the TypeScript types
├── permissions.py   Tiers and policy; the UI owns settings, this enforces them
├── memory.py        SQLite: facts worth keeping, and task history
├── telemetry.py     Real CPU/memory/disk/network for the monitor
├── agent/
│   ├── prompt.py      personality, autonomy, verification, security
│   ├── controller.py  the loop: model turn → tools → evidence → events
│   └── recovery.py    loop detection, transient retry, failure streaks
├── models/          provider abstraction; Claude behind base.ModelClient
├── tools/           46 capabilities, each with a permission category
├── voice/
│   ├── tts.py             Windows SAPI (local) or Edge neural voices (opt-in)
│   ├── stt.py             faster-whisper, managed as a worker process
│   └── whisper_worker.py  where the speech model actually lives
└── computer/
    ├── win.py       windows, input (raw SendInput), screen capture, media keys
    ├── uia.py       UI Automation: shallow reads and deep scans
    ├── ocr.py       the Windows OCR engine
    ├── browser.py   Chrome/Edge over the DevTools Protocol
    ├── whatsapp.py  WhatsApp Desktop through UI Automation
    └── files.py     files, app launching, clipboard, Explorer selection
```

## The design decisions worth knowing

**Tools return evidence, not confirmation.** Every handler observes the world
*after* it acts and reports what it found: `launch_app` waits for a window and
names it, `file_operation` checks the destination exists, `whatsapp_send` reads
the thread back. That string becomes the evidence line under the step in the UI.
It is why the interface can show a verified checkmark without lying.

**UI Automation before pixels, OCR before vision.** `read_window` returns named
controls; `click_element` clicks by name so it survives a window moving.
`read_text_on_screen` uses the Windows OCR engine — no Tesseract, no network —
for what UIA cannot see. A screenshot goes to the model only when both fail.

**The browser is driven over CDP, not through the window.** Real DOM: link text,
form fields, load state. NEXUS attaches to a browser started with a debugging
port, launching one against its own profile if none is listening — Chrome
ignores the flag when an instance is already running on the default profile, so
this is the only way that works reliably. That profile persists, so logins stay
put after the first time.

**WhatsApp verifies the recipient from the app itself.** Its composer is named
"Type a message to <contact>", so after opening a chat the app tells us which
conversation is on screen. Every send reads that name before typing, and reads
the thread back afterwards. Its content sits ~25 levels down a WebView2
automation tree, which is what `uia.deep_scan` exists for.

**A click is only as safe as what it lands on.** Raw input is a safe category,
because gating every keystroke would be theatre. But `click_element` and
`browser_click` compute their permission category *from the arguments*: clicking
something called "Send" is treated as sending, "Delete" as deleting, "Buy"/"Pay"
as a financial action.

**Recovery is machinery, not just prompting.** `recovery.py` refuses a fourth
identical tool call, retries genuinely transient failures once (COM races,
sockets not up yet), and escalates after a streak of failures. The model is told
to recover; this is what happens when it does not.

**Speech runs in its own process.** CTranslate2 takes the interpreter down —
silently, no traceback — when its model loads on a background thread beside a
running asyncio server. The agent always transcribes off-thread, so Whisper
lives in `whisper_worker.py` and is kept warm between phrases.

**Deletes go to the Recycle Bin.** `SHFileOperation` with `FOF_ALLOWUNDO`. There
is no hard-delete path in the tool surface.

**Passwords are refused** in both `type_text` and `browser_fill`, by checking the
focused control rather than trusting the model to comply.

**External content is data.** Screen text, file listings, page content, chat
messages and clipboard contents come back wrapped in `<untrusted_content>` tags,
and the prompt says instructions inside them are not instructions.

**Memory is inspectable.** SQLite at `~/.nexus/memory.db`. Facts are stored only
when the model decides something will matter again or the user says so, each
records its source, and every one can be deleted from the Memory panel. The
stored facts are injected into the system prompt on every task.

## Honest gaps

- **Voice notes are audio attachments.** WhatsApp only records true voice notes
  from a live microphone; NEXUS generates speech and attaches the file, which
  arrives as a playable audio message rather than the blue waveform kind.
- **No wake word.** Push-to-talk only.
- **Volume is not verified** — Windows exposes no simple read-back, so the tool
  says "sent" rather than claiming a level.
- **Email, Telegram and Discord have no tools.** Neither of the latter two is
  installed on this machine.
- **Downloads are not tracked as events** — they land in Downloads and are found
  through `recent_files`.
- **One session, one history.** Conversation is not persisted; memory and task
  history are.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. Without it the agent runs, sees the computer, and refuses to act. |
| `PARADOX_MODEL` | `claude-opus-5` | Needs vision for the fallback path. |
| `PARADOX_EFFORT` | `high` | `low`–`max`. |
| `NEXUS_STT_MODEL` | `base` | Whisper size: `tiny`–`large-v3`. |
| `NEXUS_TTS` | `sapi` | `sapi` (local) or `edge` (neural, sends text to Microsoft). |
| `NEXUS_MEMORY` | `~/.nexus/memory.db` | Where memory lives. |

The model runs with adaptive thinking and server-side refusal fallbacks. The
chain of thought is never sent to the UI.
