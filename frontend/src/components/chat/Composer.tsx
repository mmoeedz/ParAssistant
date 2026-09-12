import { useEffect, useRef, useState } from 'react'
import { Paperclip, Mic, Send, Square, Ear } from 'lucide-react'
import { useSession } from '@/store/session'
import { useMic } from '@/hooks/useMic'
import { useWakeWord } from '@/hooks/useWakeWord'
import { agentSocket } from '@/transport/socket'
import './chat.css'

const PREVIEW_TRANSCRIPT = 'Send Ahmed the screenshot I just took and tell him I will explain it tonight'

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

  // Always-listening: only while connected (or previewing), never mid push-to-talk,
  // and muted whenever the agent is talking/transcribing/working so it can't hear itself.
  useWakeWord({
    enabled: wakeWordEnabled && !preview && connection === 'online' && !listening,
    muted: running || voiceState === 'speaking' || voiceState === 'transcribing',
    onError: (message) => applyServerEvent({ type: 'error', message }),
  })

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

  const startVoice = async () => {
    if (listening) return
    if (!preview && connection !== 'online') {
      applyServerEvent({
        type: 'error',
        message:
          'Speech-to-text runs in the Paradox agent, which is not connected. Nothing was recorded.',
      })
      return
    }
    const ok = await mic.start()
    if (!ok) {
      applyServerEvent({ type: 'error', message: mic.error ?? 'Could not open the microphone.' })
      return
    }
    setListening(true)
    setVoice('listening')
    if (!preview) agentSocket.send({ type: 'voice.start' })
  }

  const stopVoice = () => {
    if (!listening) return
    mic.stop()
    setListening(false)
    if (preview) {
      setVoice('off')
      submitPrompt(PREVIEW_TRANSCRIPT, 'voice')
      return
    }
    setVoice('transcribing')
    agentSocket.send({ type: 'voice.stop' })
  }

  // push-to-talk: hold the configured key while not typing.
  // Reads through refs and subscribes once — with no dependency array this
  // used to re-subscribe on every render, which during a hold is ~60/sec
  // (the mic level state driving the ring updates every animation frame).
  const startRef = useRef(startVoice)
  startRef.current = startVoice
  const stopRef = useRef(stopVoice)
  stopRef.current = stopVoice

  useEffect(() => {
    const isTyping = () =>
      document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT'
    const down = (e: KeyboardEvent) => {
      if (e.code !== pushToTalkKey || e.repeat || isTyping()) return
      e.preventDefault()
      void startRef.current()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== pushToTalkKey) return
      stopRef.current()
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
          placeholder={listening ? 'Listening…' : 'Type a command or ask anything...'}
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
          title={`Hold to talk (or hold ${pushToTalkKey})`}
          onPointerDown={(e) => {
            e.preventDefault()
            // Capture the pointer so pointerup still fires on this element even
            // if the cursor drifts off the icon mid-hold — without this, a
            // small hand tremor during a real click-and-hold fires pointerleave
            // first, cutting the recording off mid-word.
            e.currentTarget.setPointerCapture(e.pointerId)
            void startVoice()
          }}
          onPointerUp={stopVoice}
          onPointerCancel={stopVoice}
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
