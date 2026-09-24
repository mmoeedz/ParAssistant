import { useSession } from '@/store/session'
import { useWakeWord } from '@/hooks/useWakeWord'

/**
 * Always-listening, mounted once at the app root.
 *
 * It used to live in the Composer, which only renders inside the Console
 * panel on the Command tab — so the wake word stopped working the moment you
 * opened Agents or System, or hid the Console.
 */
export function WakeWordListener() {
  const wakeWordEnabled = useSession((s) => s.settings.voice.wakeWordEnabled)
  const preview = useSession((s) => s.preview)
  const connection = useSession((s) => s.connection)
  const pushToTalk = useSession((s) => s.pushToTalk)
  const running = useSession((s) => Boolean(s.activeTaskId))
  const voiceState = useSession((s) => s.voice)
  const applyServerEvent = useSession((s) => s.applyServerEvent)

  // Only while connected, never mid push-to-talk (that has the mic), and
  // muted whenever the agent is talking/transcribing/working so it cannot
  // hear itself.
  useWakeWord({
    enabled: wakeWordEnabled && !preview && connection === 'online' && !pushToTalk,
    muted: running || voiceState === 'speaking' || voiceState === 'transcribing',
    onError: (message) => applyServerEvent({ type: 'error', message }),
  })

  return null
}
