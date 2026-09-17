import type { AgentDef } from '@/types/agents'
import { HAIR, HAIR_COLOR, SKIN, TROUSERS } from './TownStage'

/**
 * A standing portrait of an agent's actual Agent Town character — the same
 * skin, hair and trousers TownStage draws it with — for places that want to
 * show *who* an agent is rather than just its accent colour. Deliberately a
 * separate, static drawing rather than a reused Character: that component's
 * groups exist to be individually animated inside the Town's SVG (a walking
 * gait, a seated pose), which a small still icon in a card has no use for.
 * Kept visually identical on purpose — a smaller copy of the same person,
 * not a simplified stand-in for one.
 */
export function AgentPortrait({ def, size = 34 }: { def: AgentDef; size?: number }) {
  const skin = SKIN[def.id] ?? '#e8c9a8'
  const trousers = TROUSERS[def.id] ?? '#212f38'
  const hairColor = HAIR_COLOR[def.id] ?? '#2b2118'
  const hairPath = HAIR[def.id] ?? HAIR.default

  return (
    <svg
      viewBox="-15 -47 30 52"
      width={size}
      height={size * 1.73}
      className="agent-portrait"
      role="img"
      aria-label={`${def.name} — ${def.role}`}
    >
      <g strokeWidth="0">
        {/* legs */}
        <rect x="-6" y="-13" width="4.5" height="13" rx="1.5" fill={trousers} />
        <rect x="-6.8" y="-2.6" width="6" height="3" rx="1.2" fill="#151f26" />
        <rect x="1.5" y="-13" width="4.5" height="13" rx="1.5" fill={trousers} />
        <rect x="0.8" y="-2.6" width="6" height="3" rx="1.2" fill="#151f26" />

        {/* torso, in the agent's colour */}
        <rect x="-8.5" y="-28" width="17" height="17" rx="3.5" fill={def.color} />
        <rect x="-8.5" y="-28" width="17" height="5" rx="3" fill="#fff" opacity="0.16" />
        <rect x="-8.5" y="-14.5" width="17" height="2.6" fill="#000" opacity="0.22" />
        <rect x="-2" y="-28" width="4" height="6" rx="1.4" fill="#fff" opacity="0.2" />

        {/* arms */}
        <rect x="-11.5" y="-26" width="3.5" height="12" rx="1.75" fill={def.color} />
        <circle cx="-9.75" cy="-13.5" r="1.9" fill={skin} />
        <rect x="8" y="-26" width="3.5" height="12" rx="1.75" fill={def.color} />
        <circle cx="9.75" cy="-13.5" r="1.9" fill={skin} />

        {/* head, with hair distinct per agent */}
        <rect x="-6.5" y="-42" width="13" height="13.5" rx="4" fill={skin} />
        <path d={hairPath} fill={hairColor} />
        <rect x="-3.4" y="-35" width="1.9" height="2.4" rx="0.9" fill="#22303a" />
        <rect x="1.5" y="-35" width="1.9" height="2.4" rx="0.9" fill="#22303a" />
      </g>
    </svg>
  )
}
