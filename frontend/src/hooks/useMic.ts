import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Real microphone capture with a live level meter.
 *
 * The browser only handles capture; transcription happens in the agent backend
 * (configurable STT provider), so `onChunk` receives base64 audio to forward.
 */
export function useMic(onChunk?: (base64: string) => void) {
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkRef = useRef(onChunk)
  chunkRef.current = onChunk

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    recorderRef.current?.state === 'recording' && recorderRef.current.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    setLevel(0)
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return true
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot capture audio.')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      setActive(true)

      const ctx = new AudioContext()
      ctxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i += 1) {
          peak = Math.max(peak, Math.abs(data[i] - 128) / 128)
        }
        setLevel((prev) => prev * 0.65 + peak * 0.35)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()

      if (chunkRef.current && typeof MediaRecorder !== 'undefined') {
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = async (e) => {
          if (!e.data.size || !chunkRef.current) return
          const buf = await e.data.arrayBuffer()
          let binary = ''
          const bytes = new Uint8Array(buf)
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
          chunkRef.current(btoa(binary))
        }
        recorder.start(250)
        recorderRef.current = recorder
      }
      return true
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked.'
          : 'Could not open the microphone.',
      )
      stop()
      return false
    }
  }, [stop])

  useEffect(() => stop, [stop])

  return { level, active, error, start, stop }
}
