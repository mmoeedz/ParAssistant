import { useState } from 'react'
import { ChevronDown, ChevronRight, Mic, TriangleAlert } from 'lucide-react'
import type { ChatMessage, Task } from '@/types/protocol'
import { Orb } from '@/components/layout/Orb'
import { StepList } from '@/components/activity/StepList'
import { clockTime, duration } from '@/lib/time'
import './chat.css'

export function Message({ message, task }: { message: ChatMessage; task?: Task }) {
  if (message.role === 'system') {
    return (
      <div className="msg msg--system">
        <div className="notice" data-tone={message.error ? 'error' : undefined}>
          {message.error ? <TriangleAlert size={15} /> : null}
          <span>{message.text}</span>
        </div>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="msg msg--user">
        <div>
          <div className="msg__bubble">{message.text}</div>
          <div className="msg__meta" style={{ justifyContent: 'flex-end' }}>
            {message.source === 'voice' ? <Mic size={11} /> : null}
            {clockTime(message.createdAt)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="msg">
      <Orb />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="msg__body">
          {message.text}
          {message.streaming ? <span className="msg__caret" /> : null}
        </div>
        {task ? <Receipt task={task} /> : null}
      </div>
    </div>
  )
}

function Receipt({ task }: { task: Task }) {
  const [open, setOpen] = useState(false)
  const done = task.steps.filter((s) => s.status === 'done').length
  const took = task.endedAt ? duration(task.startedAt, task.endedAt) : null

  return (
    <div className="receipt">
      <button type="button" className="receipt__head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <strong>{done} verified steps</strong>
        {took ? <span>· {took}</span> : null}
        <span style={{ flex: 1 }} />
        <span>{open ? 'Hide' : 'Show what it did'}</span>
      </button>
      {open ? (
        <div className="receipt__body">
          <StepList steps={task.steps} />
        </div>
      ) : null}
    </div>
  )
}
