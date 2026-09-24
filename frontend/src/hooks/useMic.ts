import { useCallback, useEffect, useRef, useState } from 'react'
import { MIC_CONSTRAINTS, micErrorMessage, recorderOptions, toBase64 } from './audioFormat'

/**
 * Real microphone capture with a live level meter.
 *
 * The browser only handles capture; transcription happens in the agent
 * backend, so `onChunk` receives base64 audio to forward.
 *
 * `stop()` resolves only once the recorder's final chunk has been handed to
 * `onChunk`. MediaRecorder delivers that last chunk asynchronously after
 * stop() is called, and the caller used to send `voice.stop` before it
 * arrived — the agent then dropped up to the last quarter-second of every
 * recording, usually the end of the last word.
 */
export interface MicStopResult {
  /** Loudest sample level seen while recording, 0-1. Near 0 = muted input. */
  peak: number
}

export function useMic(onChunk?: (base64: string) => void) {
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const sampleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  /** Chunks are converted asynchronously; chaining keeps them in order. */
  const sendingRef = useRef<Promise<void>>(Promise.resolve())
  const peakRef = useRef(0)
  /** Bumped by every start and stop, so a start that is still waiting on
   *  getUserMedia can tell it has been overtaken by a stop. */
  const genRef = useRef(0)
  const chunkRef = useRef(onChunk)
  chunkRef.current = onChunk

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (sampleRef.current) clearInterval(sampleRef.current)
    sampleRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    setLevel(0)
    setActive(false)
  }, [])

  const stop = useCallback(async (): Promise<MicStopResult> => {
    genRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== 'inactive') {
      // 'dataavailable' for the tail fires before 'stop', so once this
      // resolves every chunk has at least been queued on sendingRef.
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    await sendingRef.current
    teardown()
    return { peak: peakRef.current }
  }, [teardown])

  /**
   * Open the mic and start recording. Resolves to null on success, or the
   * reason it could not. `onReady` runs just before the first byte is
   * recorded — the place to tell the agent a recording is starting, so that
   * message is guaranteed to reach it ahead of any audio.
   */
  const start = useCallback(
    async (onReady?: () => void): Promise<string | null> => {
      if (streamRef.current) return null
      if (!navigator.mediaDevices?.getUserMedia) return 'This browser cannot capture audio.'
      const gen = ++genRef.current

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
      } catch (err) {
        return micErrorMessage(err)
      }
      if (gen !== genRef.current) {
        // Released while the permission prompt (or device) was still opening.
        stream.getTracks().forEach((t) => t.stop())
        return 'cancelled'
      }

      streamRef.current = stream
      peakRef.current = 0
      setActive(true)

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const analyser = ctx.createAnalyser()
      // ~43ms of audio per read at 48kHz, so a 40ms sampler sees every peak.
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Float32Array(analyser.fftSize)
      let latest = 0

      // The peak feeds the agent's muted-mic check, so it is sampled on a
      // timer: requestAnimationFrame stops whenever the page is not being
      // drawn, and a recording measured that way came back as "silent".
      const sample = () => {
        analyser.getFloatTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]))
        latest = peak
        peakRef.current = Math.max(peakRef.current, peak)
      }
      sampleRef.current = setInterval(sample, 40)
      // The meter only needs to move while someone can see it.
      const tick = () => {
        setLevel((prev) => prev * 0.65 + latest * 0.35)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()

      onReady?.()
      if (chunkRef.current && typeof MediaRecorder !== 'undefined') {
        const recorder = new MediaRecorder(stream, recorderOptions())
        sendingRef.current = Promise.resolve()
        recorder.ondataavailable = (e) => {
          if (!e.data.size) return
          const blob = e.data
          sendingRef.current = sendingRef.current.then(async () => {
            const bytes = new Uint8Array(await blob.arrayBuffer())
            chunkRef.current?.(toBase64(bytes))
          })
        }
        recorder.start(250)
        recorderRef.current = recorder
      }
      return null
    },
    [],
  )

  // Unmount: release the device. Nothing is waiting on the result.
  useEffect(
    () => () => {
      genRef.current += 1
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      recorderRef.current = null
      teardown()
    },
    [teardown],
  )

  return { level, active, start, stop }
}
