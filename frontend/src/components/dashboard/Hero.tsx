import { useSession } from '@/store/session'
import { Composer } from '@/components/chat/Composer'
import { Message } from '@/components/chat/Message'
import './dashboard.css'

const SUGGESTIONS = [
  'Open WhatsApp and message Ahmed that I will be home at 8',
  'Open the file I just downloaded',
  'Find the PDF I downloaded earlier',
  'Take a screenshot and send it to Ali',
]

function greeting(hour: number): string {
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function Hero() {
  const messages = useSession((s) => s.messages)
  const tasks = useSession((s) => s.tasks)
  const userName = useSession((s) => s.settings.userName)
  const submitPrompt = useSession((s) => s.submitPrompt)
  const connection = useSession((s) => s.connection)
  const preview = useSession((s) => s.preview)

  const recent = messages.slice(-4)

  return (
    <section className="hero">
      <div className="hero__greet">
        <h1>
          {greeting(new Date().getHours())}, <b>{userName}</b>.
        </h1>
        <p>What shall we accomplish today?</p>
      </div>

      <Composer />

      {recent.length === 0 ? (
        <div className="hero__chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => submitPrompt(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="hero__stream">
          {recent.map((m) => (
            <Message key={m.id} message={m} task={tasks.find((t) => t.id === m.taskId)} />
          ))}
        </div>
      )}

      {!preview && connection !== 'online' ? (
        <p className="hero__warn">
          The agent is not connected, so nothing can run on this computer.
        </p>
      ) : null}
    </section>
  )
}
