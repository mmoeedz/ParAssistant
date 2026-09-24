import { useEffect, useRef } from 'react'
import { agentSocket } from '@/transport/socket'
import { MIC_CONSTRAINTS, micErrorMessage, toBase64 } from './audioFormat'

/**
 * Always-on listening for a wake word.
 *
 * This is the simple version, not a dedicated low-power wake-word engine:
 * the mic stays open and a basic energy VAD segments speech into utterances.
 * Every utterance is sent to the agent and transcribed, same as push-to-talk
 * — the agent then checks whether the configured wake word ("paradox" by
 * default) was actually said, and only acts on the words that came after it.
 * Nothing here inspects the audio for the word itself; that check happens
 * once transcribed, server-side.
 *
 * Audio goes out as raw 16 kHz PCM, not MediaRecorder's WebM. This used to
 * run one MediaRecorder for the life of the mic and forward only the chunks
 * inside each utterance — but a WebM chunk from the middle of a recording
 * has no container header, so no transcriber could decode a single
 * utterance and the mode never heard anything. PCM also makes a pre-roll
 * trivial: the half-second before the VAD tripped is sent too, so the start
 * of the wake word is not clipped off.
 *
 * Levels come from an AudioWorklet rather than requestAnimationFrame, which
 * browsers pause in background tabs — listening kept stopping whenever the
 * Paradox tab was not the one on screen.
 *
 * Because every utterance gets transcribed while this is on, it sends more
 * audio off this machine than push-to-talk does — the trade-off for not
 * needing a dedicated wake-word model.
 */

const TARGET_RATE = 16_000
const SPEECH_THRESHOLD = 0.05 // peak level treated as "someone is talking"
const SILENCE_HOLD_MS = 900 // silence this long ends the utterance
const MIN_SPEECH_MS = 250 // ignore blips shorter than this (clicks, breath)
const MAX_SEGMENT_MS = 12_000 // hard cap so a stuck-open segment can't run forever
const PRE_ROLL_MS = 500 // audio kept from just before speech was detected
const SEND_EVERY_SAMPLES = TARGET_RATE / 4 // batch the upload into ~250ms frames
const UNMUTE_GRACE_MS = 400 // let the agent's own voice die away before listening

/** Forwards raw mic frames to the page in ~40ms blocks. */
const TAP_WORKLET = `
class ParadoxTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('paradox-tap', ParadoxTap)
`

/** Box-filter decimation to the target rate; carries its phase across blocks. */
class Downsampler {
  private acc = 0
  private count = 0
  private next: number
  constructor(private readonly ratio: number) {
    this.next = ratio
  }
  process(input: Float32Array): Int16Array {
    const out = new Int16Array(Math.ceil(input.length / this.ratio) + 1)
    let k = 0
    for (let i = 0; i < input.length; i += 1) {
      this.acc += input[i]
      this.count += 1
      if (this.count >= this.next) {
        const v = Math.max(-1, Math.min(1, this.acc / this.count))
        out[k++] = v < 0 ? v * 0x8000 : v * 0x7fff
        this.next += this.ratio - this.count
        this.acc = 0
        this.count = 0
      }
    }
    return out.subarray(0, k)
  }
}

function concat(parts: Int16Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Int16Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  // Int16Array is platform-endian; every browser we run on is little-endian,
  // which is what the agent reads.
  return new Uint8Array(out.buffer)
}

interface Options {
  /** Master switch — mic is only opened while this is true. */
  enabled: boolean
  /** True while the agent is talking, transcribing, or a task is running —
   *  suppresses new segments so the agent doesn't hear (and act on) itself. */
  muted: boolean
  onError?: (message: string) => void
}

export function useWakeWord({ enabled, muted, onError }: Options) {
  const mutedRef = useRef(muted)
  const unmutedAtRef = useRef(0)
  if (mutedRef.current && !muted) unmutedAtRef.current = performance.now()
  mutedRef.current = muted
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!enabled) return undefined
    if (!navigator.mediaDevices?.getUserMedia) {
      onErrorRef.current?.('This browser cannot capture audio.')
      return undefined
    }

    let cancelled = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let workletUrl: string | null = null

    // Utterance state.
    let recording = false
    let speechStart = 0
    let silenceStart: number | null = null
    let peak = 0
    let pending: Int16Array[] = []
    let pendingSamples = 0
    const preRoll: Int16Array[] = []
    let preRollSamples = 0
    const preRollMax = (TARGET_RATE * PRE_ROLL_MS) / 1000

    const flush = () => {
      if (!pending.length) return
      agentSocket.send({ type: 'voice.audio', chunk: toBase64(concat(pending)) })
      pending = []
      pendingSamples = 0
    }

    const begin = (now: number) => {
      recording = true
      speechStart = now
      silenceStart = null
      peak = 0
      agentSocket.send({ type: 'voice.start', wake: true, format: 'pcm16', sampleRate: TARGET_RATE })
      pending = preRoll.splice(0)
      pendingSamples = preRollSamples
      preRollSamples = 0
    }

    const end = (discard: boolean) => {
      recording = false
      if (discard) {
        pending = []
        pendingSamples = 0
      } else {
        flush()
      }
      agentSocket.send({ type: 'voice.stop', wake: true, peak, discard })
    }

    const onBlock = (block: Float32Array, pcm: Int16Array) => {
      const now = performance.now()
      let level = 0
      for (let i = 0; i < block.length; i += 1) level = Math.max(level, Math.abs(block[i]))

      if (mutedRef.current || now - unmutedAtRef.current < UNMUTE_GRACE_MS) {
        // The agent is talking, transcribing, or busy — throw away anything
        // mid-flight rather than let it feed back into itself.
        if (recording) end(true)
        preRoll.length = 0
        preRollSamples = 0
        return
      }

      if (!recording) {
        preRoll.push(pcm)
        preRollSamples += pcm.length
        while (preRollSamples - preRoll[0].length >= preRollMax) preRollSamples -= preRoll.shift()!.length
        if (level > SPEECH_THRESHOLD) begin(now)
        return
      }

      pending.push(pcm)
      pendingSamples += pcm.length
      peak = Math.max(peak, level)
      if (pendingSamples >= SEND_EVERY_SAMPLES) flush()

      if (level > SPEECH_THRESHOLD) {
        silenceStart = null
        if (now - speechStart > MAX_SEGMENT_MS) end(false)
      } else {
        if (silenceStart === null) silenceStart = now
        const longEnough = now - speechStart > MIN_SPEECH_MS
        if (longEnough && now - silenceStart > SILENCE_HOLD_MS) end(false)
      }
    }

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        ctx = new AudioContext()
        if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable')
        workletUrl = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }))
        await ctx.audioWorklet.addModule(workletUrl)
        if (cancelled) return

        const source = ctx.createMediaStreamSource(stream)
        const tap = new AudioWorkletNode(ctx, 'paradox-tap')
        // Pulled through a muted gain so the graph keeps rendering without
        // playing the mic back out of the speakers.
        const sink = ctx.createGain()
        sink.gain.value = 0
        source.connect(tap).connect(sink).connect(ctx.destination)

        const down = new Downsampler(ctx.sampleRate / TARGET_RATE)
        tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (!cancelled) onBlock(e.data, down.process(e.data))
        }
        // An AudioContext created outside a click can start suspended.
        if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
      } catch (err) {
        if (cancelled) return
        onErrorRef.current?.(
          err instanceof DOMException ? micErrorMessage(err) : 'Always-listening could not start in this browser.',
        )
      }
    })()

    return () => {
      cancelled = true
      if (recording) end(true)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
      if (workletUrl) URL.revokeObjectURL(workletUrl)
    }
  }, [enabled])
}
