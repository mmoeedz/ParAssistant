import { useEffect, useRef } from 'react'
import { agentSocket } from '@/transport/socket'
import { recorderOptions } from './audioFormat'

/**
 * Always-on listening for a wake word.
 *
 * This is the simple version, not a dedicated low-power wake-word engine:
 * the mic stays open and a basic energy VAD segments speech into utterances.
 * Every utterance is sent to the agent and transcribed by Google
 * Speech-to-Text, same as push-to-talk — the agent then checks whether the
 * configured wake word ("paradox" by default) was actually said, and only
 * acts on the words that came after it. Nothing here inspects the audio for
 * the word itself; that check happens once transcribed, server-side.
 *
 * Because every utterance gets sent to Google and transcribed while this is
 * on, it sends more audio off this machine than push-to-talk does — that's
 * the trade-off for not needing a dedicated wake-word model.
 */

const SPEECH_THRESHOLD = 0.05 // energy level treated as "someone is talking"
const SILENCE_HOLD_MS = 900 // silence this long ends the utterance
const MIN_SPEECH_MS = 250 // ignore blips shorter than this (clicks, breath)
const MAX_SEGMENT_MS = 12_000 // hard cap so a stuck-open segment can't run forever

interface Options {
  /** Master switch — mic is only opened while this is true. */
  enabled: boolean
  /** True while the agent is talking, transcribing, or a task is running —
   *  suppresses new segments so the agent doesn't hear (and act on) itself. */
  muted: boolean
  onError?: (message: string) => void
}

export function useWakeWord({ enabled, muted, onError }: Options) {
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingRef = useRef(false)
  const speechStartRef = useRef(0)
  const silenceStartRef = useRef<number | null>(null)
  const mutedRef = useRef(muted)
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

    const startRecording = () => {
      recordingRef.current = true
      speechStartRef.current = performance.now()
      silenceStartRef.current = null
      agentSocket.send({ type: 'voice.start', wake: true })
    }

    const stopRecording = () => {
      recordingRef.current = false
      agentSocket.send({ type: 'voice.stop', wake: true })
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const ctx = new AudioContext()
        ctxRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)

        const recorder = new MediaRecorder(stream, recorderOptions())
        recorder.ondataavailable = async (e) => {
          if (!e.data.size || !recordingRef.current) return
          const buf = await e.data.arrayBuffer()
          let binary = ''
          const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
          agentSocket.send({ type: 'voice.audio', chunk: btoa(binary) })
        }
        recorder.start(250)
        recorderRef.current = recorder

        const tick = () => {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (let i = 0; i < data.length; i += 1) {
            peak = Math.max(peak, Math.abs(data[i] - 128) / 128)
          }
          const now = performance.now()

          if (mutedRef.current) {
            // The agent is talking, transcribing, or busy — drop anything
            // mid-flight rather than let it feed back into itself.
            if (recordingRef.current) stopRecording()
          } else if (peak > SPEECH_THRESHOLD) {
            silenceStartRef.current = null
            if (!recordingRef.current) startRecording()
            else if (now - speechStartRef.current > MAX_SEGMENT_MS) stopRecording()
          } else if (recordingRef.current) {
            if (silenceStartRef.current === null) silenceStartRef.current = now
            const longEnough = now - speechStartRef.current > MIN_SPEECH_MS
            if (longEnough && now - silenceStartRef.current > SILENCE_HOLD_MS) stopRecording()
          }

          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        onErrorRef.current?.(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone access was blocked.'
            : 'Could not open the microphone.',
        )
      }
    })()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (recordingRef.current) {
        recordingRef.current = false
        agentSocket.send({ type: 'voice.stop', wake: true })
      }
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      void ctxRef.current?.close()
      ctxRef.current = null
    }
  }, [enabled])
}
