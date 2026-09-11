import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './ui.css'

/* ---------------------------------------------------------------- button -- */

type ButtonVariant = 'ghost' | 'subtle' | 'primary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: boolean
  block?: boolean
}

export function Button({
  variant = 'subtle',
  size = 'md',
  icon = false,
  block = false,
  className = '',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size === 'sm' ? 'btn--sm' : '',
    icon ? 'btn--icon' : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return <button type="button" className={classes} {...rest} />
}

/* ---------------------------------------------------------------- toggle -- */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  )
}

/* ------------------------------------------------------------- segmented -- */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  tone?: 'good' | 'danger'
  disabled?: boolean
  title?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (next: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          data-active={value === opt.value}
          data-tone={opt.tone}
          className="segmented__item"
          disabled={opt.disabled}
          title={opt.title}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------------- atoms -- */

export function StatusDot({ tone }: { tone: 'online' | 'busy' | 'warn' | 'offline' }) {
  return <span className="dot" data-tone={tone} />
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode
  tone?: 'accent' | 'good' | 'warn' | 'danger'
}) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  )
}
