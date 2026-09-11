import { CircleCheck, ShieldAlert, ShieldHalf, TriangleAlert } from 'lucide-react'
import { useSession } from '@/store/session'
import { Segmented, type SegmentedOption } from '@/components/ui'
import type { PermissionPolicy, PermissionTier } from '@/types/protocol'
import type { PermissionRule } from '@/types/settings'
import './settings.css'

const TIERS: { tier: PermissionTier; title: string; blurb: string; icon: typeof CircleCheck }[] = [
  {
    tier: 'safe',
    title: 'Safe',
    blurb: 'Reversible, everyday things. Run these without interrupting me.',
    icon: CircleCheck,
  },
  {
    tier: 'sensitive',
    title: 'Sensitive',
    blurb: 'Anything that leaves this computer or reaches another person.',
    icon: ShieldHalf,
  },
  {
    tier: 'dangerous',
    title: 'Dangerous',
    blurb: 'Hard or impossible to undo. Confirmation cannot be switched off entirely.',
    icon: ShieldAlert,
  },
]

function policyOptions(tier: PermissionTier): SegmentedOption<PermissionPolicy>[] {
  return [
    {
      value: 'auto',
      label: 'Just do it',
      tone: 'good',
      disabled: tier === 'dangerous',
      title: tier === 'dangerous' ? 'Dangerous actions always ask first' : undefined,
    },
    { value: 'ask', label: 'Ask me' },
    { value: 'never', label: 'Never', tone: 'danger' },
  ]
}

export function PermissionRules() {
  const permissions = useSession((s) => s.settings.permissions)
  const setPermission = useSession((s) => s.setPermission)

  return (
    <>
      {TIERS.map(({ tier, title, blurb, icon: Icon }) => (
        <section key={tier} className="group">
          <div className="group__head">
            <Icon size={14} />
            <span className="section-title">{title}</span>
          </div>
          <p className="group__blurb">{blurb}</p>
          {permissions
            .filter((rule) => rule.tier === tier)
            .map((rule) => (
              <Row key={rule.category} rule={rule} onChange={setPermission} />
            ))}
          {tier === 'dangerous' ? (
            <div className="danger-note">
              <TriangleAlert size={14} />
              <span>
                Instructions found inside web pages, documents or downloads are treated as content,
                never as commands. Only you can approve these.
              </span>
            </div>
          ) : null}
        </section>
      ))}
    </>
  )
}

function Row({
  rule,
  onChange,
}: {
  rule: PermissionRule
  onChange: (category: PermissionRule['category'], policy: PermissionPolicy) => void
}) {
  return (
    <div className="rule">
      <div className="rule__text">
        <div className="rule__label">{rule.label}</div>
        <div className="rule__desc">{rule.description}</div>
      </div>
      <Segmented
        ariaLabel={rule.label}
        value={rule.policy}
        options={policyOptions(rule.tier)}
        onChange={(policy) => onChange(rule.category, policy)}
      />
    </div>
  )
}
