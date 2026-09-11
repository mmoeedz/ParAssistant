import { Check, CircleDot, LoaderCircle, Minus, Pause, X } from 'lucide-react'
import type { TaskStep } from '@/types/protocol'
import './activity.css'

function Marker({ status }: { status: TaskStep['status'] }) {
  switch (status) {
    case 'done':
      return <Check size={12} strokeWidth={3} />
    case 'running':
      return <LoaderCircle size={12} className="spin" />
    case 'failed':
      return <X size={12} strokeWidth={3} />
    case 'blocked':
      return <Pause size={11} strokeWidth={3} />
    case 'skipped':
      return <Minus size={12} strokeWidth={3} />
    default:
      return <CircleDot size={10} />
  }
}

export function StepList({ steps, showTools = false }: { steps: TaskStep[]; showTools?: boolean }) {
  if (!steps.length) {
    return <p className="step__label">Working out the steps…</p>
  }

  return (
    <ul className="steps">
      {steps.map((step) => (
        <li key={step.id} className="step" data-status={step.status}>
          <span className="step__marker">
            <Marker status={step.status} />
          </span>
          <div>
            <div className="step__label">
              {step.label}
              {showTools && step.tool ? <span className="step__tool">{step.tool}</span> : null}
            </div>
            {step.evidence ? (
              <div className="step__evidence" title="Checked after the action ran">
                <Check size={11} strokeWidth={3} />
                {step.evidence}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
