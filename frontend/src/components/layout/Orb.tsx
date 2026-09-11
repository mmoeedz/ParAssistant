import './layout.css'

/**
 * The Paradox mark: a core with two counter-rotating rings.
 * Rings spin up while a task runs; the whole thing shifts violet while listening.
 */
export function Orb({
  busy = false,
  listening = false,
  size = 'md',
}: {
  busy?: boolean
  listening?: boolean
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span className={`orb orb--${size}`} data-busy={busy} data-listening={listening} aria-hidden="true">
      <span className="orb__halo" />
      <span className="orb__ring orb__ring--a" />
      <span className="orb__ring orb__ring--b" />
      <span className="orb__core" />
    </span>
  )
}
