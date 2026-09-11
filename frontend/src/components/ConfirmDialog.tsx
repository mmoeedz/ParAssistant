import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useSession } from '@/store/session'
import { Badge, Button, Toggle } from '@/components/ui'
import './confirm.css'

export function ConfirmDialog() {
  const request = useSession((s) => s.confirmation)
  const resolve = useSession((s) => s.resolveConfirmation)
  const [remember, setRemember] = useState(false)

  useEffect(() => setRemember(false), [request?.id])

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolve(false, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, resolve])

  if (!request) return null
  const dangerous = request.tier === 'dangerous'

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm" data-tier={request.tier}>
        <div className="confirm__head">
          {dangerous ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
          <Badge tone={dangerous ? 'danger' : 'warn'}>{request.tier}</Badge>
          <span className="confirm__tool">{request.tool}</span>
        </div>

        <h2 id="confirm-title" className="confirm__title">
          {request.title}
        </h2>

        {request.detail ? <p className="confirm__detail">{request.detail}</p> : null}

        <dl className="confirm__params">
          {Object.entries(request.params).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {!dangerous ? (
          <div className="confirm__remember">
            <Toggle
              checked={remember}
              onChange={setRemember}
              label={<span>Stop asking for this kind of action</span>}
            />
          </div>
        ) : (
          <p className="confirm__note">
            This one always asks. You can change that in Permissions, but it cannot be undone once it
            runs.
          </p>
        )}

        <div className="confirm__actions">
          <Button variant="ghost" onClick={() => resolve(false, false)}>
            Not now
          </Button>
          <Button
            variant={dangerous ? 'danger' : 'primary'}
            onClick={() => resolve(true, remember)}
            autoFocus
          >
            {dangerous ? 'Yes, do it' : 'Go ahead'}
          </Button>
        </div>
      </div>
    </div>
  )
}
