import { useEffect, useRef, useState } from 'react'
import { Paperclip, Mic, Send, Square, Ear } from 'lucide-react'
import { useSession } from '@/store/session'
import { useMic } from '@/hooks/useMic'
import { agentSocket } from '@/transport/socket'
import './chat.css'

const PREVIEW_TRANSCRIPT = 'Send Ahmed the screenshot I just took and tell him I will explain it tonight'
/** A press shorter than this is a click: it latches recording on instead. */
const TAP_MS = 350
const MAX_LATCHED_MS = 60_000

export function Composer() {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const submitPrompt = useSession((s) => s.submitPrompt)
  const cancelTask = useSession((s) => s.cancelTask)
  const activeTaskId = useSession((s) => s.activeTaskId)
  const connection = useSession((s) => s.connection)
  const preview = useSession((s) => s.preview)
  const setVoice = useSession((s) => s.setVoice)
  const applyServerEvent = useSession((s) => s.applyServerEvent)
  const pushToTalkKey = useSession((s) => s.settings.voice.pushToTalkKey)
  const wakeWordEnabled = useSession((s) => s.settings.voice.wakeWordEnabled)
  const wakeWord = useSession((s) => s.settings.voice.wakeWord)
  const voiceState = useSession((s) => s.voice)

  const mic = useMic((chunk) => agentSocket.send({ type: 'voice.audio', chunk }))
  const running = Boolean(activeTaskId)

  /**
   * Push-to-talk phases. Refs, not state: the key and pointer handlers need
   * the current phase synchronously — a release that lands while the mic is
   * still opening (the permission prompt, say) has to be seen by the start
   * that is waiting on it.
   */
  const phaseRef = useRef<'idle' | 'starting' | 'recording' | 'stopping'>('idle')
  const stopWantedRef = useRef(false)
  /** Tap-to-talk: a quick click latches recording on until the next click. */
  const [latched, setLatched] = useState(false)
  const latchedRef = useRef(false)
  const pressAtRef = useRef(0)
  // Always-listening (WakeWordListener) releases the mic while this is set.
  const setMicBusy = useSession((s) => s.setPushToTalk)
  // Unmounted mid-recording (a tab switch): useMic releases the device; this
  // hands the mic back to always-listening.
  useEffect(() => () => setMicBusy(false), [setMicBusy])

  // auto-grow
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [text])

  const send = () => {
    if (!text.trim()) return
    submitPrompt(text)
    setText('')
  }

  const setLatch = (on: boolean) => {
    latchedRef.current = on
    setLatched(on)
  }

  const startVoice = async () => {
    if (phaseRef.current !== 'idle') return
    if (!preview && connection !== 'online') {
      applyServerEvent({
        type: 'error',
        message:
          'Speech-to-text runs in the Paradox agent, which is not connected. Nothing was recorded.',
      })
      return
    }
    phaseRef.current = 'starting'
    stopWantedRef.current = false
    setMicBusy(true)
    const failure = await mic.start(() => {
      if (!preview) agentSocket.send({ type: 'voice.start', format: 'webm', sampleRate: 48_000 })
    })
    if (failure) {
      phaseRef.current = 'idle'
      setMicBusy(false)
      setLatch(false)
      if (failure !== 'cancelled') applyServerEvent({ type: 'error', message: failure })
      return
    }
    phaseRef.current = 'recording'
    setListening(true)
    setVoice('listening')
    // Released while the mic was still opening: that release is this stop.
    if (stopWantedRef.current) void stopVoice()
  }

  const stopVoice = async () => {
    if (phaseRef.current === 'starting') {
      stopWantedRef.current = true
      return
    }
    if (phaseRef.current !== 'recording') return
    phaseRef.current = 'stopping'
    setLatch(false)
    setListening(false)
    if (!preview) setVoice('transcribing')
    // Waits for the recorder's last chunk to go out before voice.stop does.
    const { peak } = await mic.stop()
    phaseRef.current = 'idle'
    setMicBusy(false)
    if (preview) {
      setVoice('off')
      submitPrompt(PREVIEW_TRANSCRIPT, 'voice')
      return
    }
    agentSocket.send({ type: 'voice.stop', peak })
  }

  // A latched recording has no key being held to end it; cap it.
  useEffect(() => {
    if (!latched) return undefined
    const timer = setTimeout(() => void stopRef.current(), MAX_LATCHED_MS)
    return () => clearTimeout(timer)
  }, [latched])

  // push-to-talk: hold the configured key while not typing.
  // Reads through refs and subscribes once — with no dependency array this
  // used to re-subscribe on every render, which during a hold is ~60/sec
  // (the mic level state driving the ring updates every animation frame).
  const startRef = useRef(startVoice)
  startRef.current = startVoice
  const stopRef = useRef(stopVoice)
  stopRef.current = stopVoice

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName) || el.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code !== pushToTalkKey || e.repeat || isTyping()) return
      e.preventDefault()
      void startRef.current()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== pushToTalkKey || latchedRef.current) return
      void stopRef.current()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [pushToTalkKey])

  const ringScale = 1 + Math.min(mic.level, 1) * 0.45

  return (
    <div className="composer">
      <div className="composer__box" data-listening={listening}>
        <textarea
          ref={areaRef}
          rows={1}
          value={listening ? '' : text}
          placeholder={
            listening
              ? latched
                ? 'Listening… click the mic again to send'
                : 'Listening… release to send'
              : voiceState === 'transcribing'
                ? 'Transcribing…'
                : 'Type a command or ask anything...'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
            if (e.key === 'Escape' && running) cancelTask()
          }}
        />

        <button type="button" className="cbtn" title="Attach a file (use a full path in the message)"
                onClick={() => areaRef.current?.focus()}>
          <Paperclip size={15} />
        </button>

        {wakeWordEnabled ? (
          <span
            className="cbtn cbtn--wake"
            data-armed={!listening && !running && voiceState !== 'speaking'}
            title={
              voiceState === 'speaking'
                ? 'Muted while speaking'
                : running
                  ? 'Muted while working'
                  : `Always listening for "${wakeWord}"`
            }
          >
            <Ear size={14} />
          </span>
        ) : null}

        <button
          type="button"
          className="cbtn"
          data-listening={listening}
          aria-pressed={listening}
          aria-label={listening ? 'Stop recording' : 'Talk to Paradox'}
          title={
            latched
              ? 'Recording — click to send'
              : `Click to talk, or hold (or hold ${pushToTalkKey}) and release to send`
          }
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            if (latchedRef.current) {
              void stopVoice()
              return
            }
            // Capture the pointer so pointerup still fires on this element even
            // if the cursor drifts off the icon mid-hold — without this, a
            // small hand tremor during a real click-and-hold fires pointerleave
            // first, cutting the recording off mid-word.
            e.currentTarget.setPointerCapture(e.pointerId)
            pressAtRef.current = performance.now()
            void startVoice()
          }}
          onPointerUp={() => {
            if (latchedRef.current || phaseRef.current === 'idle') return
            if (performance.now() - pressAtRef.current < TAP_MS) setLatch(true)
            else void stopVoice()
          }}
          onPointerCancel={() => {
            if (!latchedRef.current) void stopVoice()
          }}
          onKeyDown={(e) => {
            // Keyboard activation of the button itself: Enter toggles.
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (phaseRef.current === 'idle') {
              setLatch(true)
              void startVoice()
            } else {
              void stopVoice()
            }
          }}
        >
          {listening ? (
            <span className="mic__ring" style={{ ['--mic-level' as string]: ringScale }} />
          ) : null}
          <Mic size={15} />
        </button>

        {running ? (
          <button type="button" className="send send--stop" onClick={cancelTask} title="Stop (Esc)">
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="send" disabled={!text.trim()} onClick={send} title="Send">
            <Send size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
