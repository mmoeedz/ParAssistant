/**
 * Preview driver — scripted sample data for designing and reviewing the UI.
 *
 * This module NEVER touches the computer. It exists so the interface can be
 * built and judged before the agent backend is wired up, and the UI marks
 * every preview session with a visible "Preview data" banner so nothing shown
 * here can be mistaken for a real action.
 */
import { uid } from '@/lib/id'
import type { MediaAction, NowPlaying, ServerEvent, Task } from '@/types/protocol'

type Emit = (event: ServerEvent) => void

interface Beat {
  after: number
  event?: ServerEvent
  /** built at emit time, for events that carry a timestamp */
  make?: () => ServerEvent
  /** pause the script until the user answers the pending confirmation */
  gate?: boolean
}

let timers: ReturnType<typeof setTimeout>[] = []
let pendingResume: ((approved: boolean) => void) | null = null

export function stopPreview() {
  timers.forEach(clearTimeout)
  timers = []
  pendingResume = null
}

export function resolvePreviewConfirmation(approved: boolean) {
  pendingResume?.(approved)
  pendingResume = null
}

/* ----------------------------------------------------------- ambient -- */

/**
 * The panels that are fed by the machine rather than by a task: the gauges,
 * the CPU history behind them, and the headline feed. Preview has to drive
 * these too, or half the dashboard sits empty while the script runs.
 *
 * Kept on its own timer so starting a task (which resets the script) does not
 * stop the gauges.
 */
let ambient: ReturnType<typeof setInterval> | null = null

const GB = 1024 ** 3

const PREVIEW_HEADLINES = [
  { title: 'NVIDIA RTX 5070 prices drop further', source: 'sample', hours: 2 },
  { title: 'OpenAI announces new agent tools', source: 'sample', hours: 4 },
  { title: 'Windows 11 new update released', source: 'sample', hours: 6 },
  { title: 'Samsung Galaxy S25 officially announced', source: 'sample', hours: 6 },
]

/** A slow random walk, so the rings and the sparkline move like real telemetry. */
function drift(value: number, low: number, high: number): number {
  const next = value + (Math.random() - 0.5) * 9
  return Math.min(high, Math.max(low, next))
}

export function startAmbient(emit: Emit) {
  stopAmbient()

  emit({
    type: 'headlines',
    items: PREVIEW_HEADLINES.map((h) => ({
      title: h.title,
      url: '',
      source: h.source,
      publishedAt: Date.now() - h.hours * 3_600_000,
    })),
  })

  let cpu = 18
  let ram = 36
  let gpu = 62
  const disk = 41

  const tick = () => {
    tickMedia(emit)
    cpu = drift(cpu, 6, 74)
    ram = drift(ram, 28, 62)
    gpu = drift(gpu, 34, 88)
    emit({
      type: 'system.stats',
      stats: {
        cpu: Math.round(cpu),
        cores: 16,
        memory: { percent: Math.round(ram), usedBytes: ram * 0.32 * GB, totalBytes: 32 * GB },
        disk: { percent: disk, usedBytes: 410 * GB, totalBytes: 1000 * GB },
        processes: 214,
        capturedAt: Date.now(),
        gpu: Math.round(gpu),
      },
    })
  }

  tick()
  ambient = setInterval(tick, 1200)
}

export function stopAmbient() {
  if (ambient) clearInterval(ambient)
  ambient = null
}

/* ------------------------------------------------------- preview player -- */

/**
 * A scripted now-playing bar, so the player can be seen without the agent
 * running. The real one reads the Windows media session; this one is obviously
 * sample data, like the rest of preview mode.
 */
function cover(from: string, to: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>` +
    `</linearGradient></defs><rect width="120" height="120" fill="url(#g)"/>` +
    `<circle cx="60" cy="60" r="26" fill="rgba(0,0,0,0.35)"/>` +
    `<circle cx="60" cy="60" r="7" fill="rgba(255,255,255,0.8)"/></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

const TRACKS = [
  { title: 'Midnight Protocol', artist: 'Sample Artist', album: 'Preview', duration: 214,
    art: cover('#0f5f6d', '#123a55') },
  { title: 'Quiet Machines', artist: 'Sample Artist', album: 'Preview', duration: 187,
    art: cover('#6d3f5f', '#2a1f45') },
  { title: 'Long Way Round', artist: 'Another Sample', album: 'Preview', duration: 256,
    art: cover('#6d5a2a', '#3a2a12') },
]

let trackIndex = 0
let position = 42
let playing = true

function nowPlaying(): NowPlaying {
  const track = TRACKS[trackIndex]
  return {
    key: `${track.title}␟${track.artist}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    app: 'Preview',
    status: playing ? 'playing' : 'paused',
    position,
    duration: track.duration,
    art: track.art,
    can: { play: true, next: true, previous: true, stop: true },
  }
}

function tickMedia(emit: Emit) {
  if (playing) {
    position += 1.2
    if (position >= TRACKS[trackIndex].duration) {
      trackIndex = (trackIndex + 1) % TRACKS.length
      position = 0
    }
  }
  emit({ type: 'media', media: nowPlaying() })
}

/** Transport buttons in preview drive the scripted track, nothing else. */
export function previewMedia(action: MediaAction, emit: Emit) {
  if (action === 'toggle') playing = !playing
  if (action === 'stop') {
    playing = false
    position = 0
  }
  if (action === 'next') {
    trackIndex = (trackIndex + 1) % TRACKS.length
    position = 0
  }
  if (action === 'previous') {
    if (position > 4) position = 0
    else {
      trackIndex = (trackIndex - 1 + TRACKS.length) % TRACKS.length
      position = 0
    }
  }
  emit({ type: 'media', media: nowPlaying() })
}

export function runPreview(prompt: string, emit: Emit) {
  stopPreview()
  const script = pickScript(prompt)
  const taskId = uid('task')
  const task: Task = {
    id: taskId,
    goal: prompt,
    status: 'planning',
    statusLine: 'Working out how',
    steps: [],
    startedAt: Date.now(),
  }

  const beats: Beat[] = [{ after: 220, event: { type: 'task.start', task } }]
  let clock = 220

  script.steps.forEach((s, i) => {
    const id = uid('step')
    clock += 480
    beats.push({
      after: clock,
      event: { type: 'task.step', taskId, step: { id, label: s.label, status: 'running', tool: s.tool } },
    })
    if (i === 0) {
      beats.push({
        after: clock + 40,
        event: { type: 'task.update', taskId, patch: { status: 'running', statusLine: script.statusLine } },
      })
    }
    clock += s.ms
    beats.push({
      after: clock,
      event: {
        type: 'task.step',
        taskId,
        step: { id, label: s.done, status: 'done', tool: s.tool, evidence: s.evidence },
      },
    })
    if (s.observe) {
      beats.push({
        after: clock + 60,
        event: {
          type: 'observation',
          observation: {
            id: uid('obs'),
            activeWindow: s.observe,
            method: s.method ?? 'uia',
            capturedAt: Date.now(),
          },
        },
      })
    }
  })

  if (script.confirm) {
    clock += 320
    const confirm = script.confirm
    beats.push({
      after: clock,
      event: {
        type: 'task.update',
        taskId,
        patch: { status: 'awaiting_confirmation', statusLine: 'Waiting for you' },
      },
    })
    beats.push({
      after: clock + 60,
      event: { type: 'confirm.request', request: { ...confirm, id: uid('req'), createdAt: Date.now() } },
    })
    beats.push({ after: clock + 80, gate: true })
  }

  // Beats after the gate are scheduled relative to the answer.
  const tail: Beat[] = []
  let tailClock = 0
  script.after.forEach((s) => {
    const id = uid('step')
    tailClock += 380
    tail.push({
      after: tailClock,
      event: { type: 'task.step', taskId, step: { id, label: s.label, status: 'running', tool: s.tool } },
    })
    tailClock += s.ms
    tail.push({
      after: tailClock,
      event: {
        type: 'task.step',
        taskId,
        step: { id, label: s.done, status: 'done', tool: s.tool, evidence: s.evidence },
      },
    })
  })
  tailClock += 260
  tail.push({
    after: tailClock,
    make: () => ({
      type: 'task.update',
      taskId,
      patch: {
        status: 'succeeded',
        statusLine: 'Verified',
        summary: script.summary,
        endedAt: Date.now(),
      },
    }),
  })
  tail.push({
    after: tailClock + 60,
    event: {
      type: 'message',
      message: {
        id: uid('msg'),
        role: 'assistant',
        text: script.reply,
        createdAt: Date.now(),
        source: 'text',
        taskId,
      },
    },
  })

  const schedule = (list: Beat[], offset = 0) => {
    list.forEach((beat) => {
      if (beat.gate) {
        timers.push(
          setTimeout(() => {
            pendingResume = (approved) => {
              if (!approved) {
                emit({
                  type: 'task.update',
                  taskId,
                  patch: { status: 'cancelled', statusLine: 'Cancelled', endedAt: Date.now() },
                })
                emit({
                  type: 'message',
                  message: {
                    id: uid('msg'),
                    role: 'assistant',
                    text: 'Left it alone.',
                    createdAt: Date.now(),
                    source: 'text',
                    taskId,
                  },
                })
                return
              }
              schedule(tail)
            }
          }, beat.after + offset),
        )
        return
      }
      const build = beat.make ?? (beat.event ? () => beat.event as ServerEvent : null)
      if (!build) return
      timers.push(setTimeout(() => emit(build()), beat.after + offset))
    })
  }

  schedule(beats)
  if (!script.confirm) schedule(tail, clock)
}

/* ------------------------------------------------------------- scripts -- */

interface ScriptStep {
  label: string
  done: string
  tool: string
  ms: number
  evidence?: string
  observe?: string
  method?: 'uia' | 'ocr' | 'vision' | 'dom'
}

interface Script {
  statusLine: string
  steps: ScriptStep[]
  confirm?: Omit<import('@/types/protocol').ConfirmationRequest, 'id' | 'createdAt'>
  after: ScriptStep[]
  summary: string
  reply: string
}

const whatsappScript: Script = {
  statusLine: 'Sending to Ahmed',
  steps: [
    {
      label: 'Locating the screenshot',
      done: 'Located the screenshot',
      tool: 'recent_files',
      ms: 700,
      evidence: 'Screenshot 2026-09-07 171204.png · 1.4 MB · 2 min ago',
    },
    {
      label: 'Opening WhatsApp',
      done: 'Opened WhatsApp',
      tool: 'launch_app',
      ms: 900,
      evidence: 'active window: WhatsApp',
      observe: 'WhatsApp',
    },
    {
      label: 'Finding Ahmed',
      done: 'Found Ahmed',
      tool: 'find_ui_element',
      ms: 800,
      evidence: 'one match in contacts: Ahmed Raza',
      observe: 'WhatsApp — Ahmed Raza',
    },
    {
      label: 'Attaching the screenshot',
      done: 'Attached the screenshot',
      tool: 'click_element',
      ms: 950,
      evidence: 'preview shows 1 image ready to send',
    },
  ],
  confirm: {
    tier: 'sensitive',
    category: 'send_messages',
    title: 'Click "Send" in WhatsApp?',
    detail: "I'll explain it tonight",
    tool: 'click_element',
    params: {
      Control: 'Send (Button)',
      Contact: 'Ahmed Raza (+92 300 •••4417)',
      Attachment: 'Screenshot 2026-09-07 171204.png',
      Message: "I'll explain it tonight",
    },
  },
  after: [
    {
      label: 'Sending',
      done: 'Sent',
      tool: 'click_element',
      ms: 900,
      evidence: 'message shows a delivered tick in the thread',
    },
  ],
  summary: 'Screenshot and message delivered to Ahmed Raza.',
  reply: 'Done. Sent the screenshot with the note.',
}

const genericScript: Script = {
  statusLine: 'Working',
  steps: [
    {
      label: 'Reading the screen',
      done: 'Read the screen',
      tool: 'find_ui_element',
      ms: 600,
      evidence: 'active window: File Explorer — Downloads',
      observe: 'File Explorer — Downloads',
      method: 'uia',
    },
    {
      label: 'Working out the steps',
      done: 'Planned 3 steps',
      tool: 'observe_screen',
      ms: 700,
    },
    {
      label: 'Carrying them out',
      done: 'Carried them out',
      tool: 'focus_window',
      ms: 900,
      evidence: 'verified against the screen after each step',
    },
  ],
  after: [],
  summary: 'Preview script finished.',
  reply: 'Done. (Preview data - nothing on this computer was touched.)',
}

function pickScript(prompt: string): Script {
  const p = prompt.toLowerCase()
  if (p.includes('whatsapp') || p.includes('ahmed') || p.includes('send') || p.includes('message')) {
    return whatsappScript
  }
  return genericScript
}
