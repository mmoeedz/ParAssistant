/**
 * The Paradox mark: a small AI core with translucent energy ribbons orbiting
 * it. Replaces the old flat "P" glyph.
 *
 * Every ribbon exists twice — once drawn *behind* the core, once drawn
 * *after* it but clipped to the core's own silhouette. Both copies share one
 * rotation, so wherever a ribbon's path crosses the disc, the clipped copy
 * paints over the unclipped one and it reads as passing in front; everywhere
 * else the behind copy shows through untouched. That is real depth from pure
 * 2D compositing — no 3D transform needed for something this small.
 *
 * All motion is native SVG animation (SMIL) plus a couple of CSS keyframes
 * for the breathing glow — no per-frame JS, so it costs nothing sitting in a
 * title bar that never unmounts.
 *
 * The project's global reduced-motion rule (base.css) zeroes CSS animation
 * durations everywhere, but that rule cannot reach SMIL — <animate*> keeps
 * running under it. So the orbit/morph/particle motion is skipped here,
 * read once from prefers-reduced-motion, rather than left running.
 */
const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

export function ParadoxOrb() {
  return (
    <svg className="orb" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="orbCoreFill" cx="42%" cy="38%" r="75%">
          <stop offset="0%" stopColor="#20242c" />
          <stop offset="45%" stopColor="#0a0c11" />
          <stop offset="100%" stopColor="#020204" />
        </radialGradient>

        <radialGradient id="orbHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6fd8ff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#8b6bff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#8b6bff" stopOpacity="0" />
        </radialGradient>

        {/* The holographic palette. Rotating this gradient's own space (see
            below) is what makes color travel along every ribbon that uses
            it — one animation, shared by all of them. First and last stops
            match so the rotation loops with no seam. */}
        <linearGradient id="orbRibbon" gradientUnits="userSpaceOnUse"
                         x1="20" y1="50" x2="80" y2="50">
          <stop offset="0%" stopColor="#2be2ff" />
          <stop offset="18%" stopColor="#4a7dff" />
          <stop offset="36%" stopColor="#8a5cff" />
          <stop offset="54%" stopColor="#c150ec" />
          <stop offset="70%" stopColor="#ff4fc7" />
          <stop offset="85%" stopColor="#ff9bd6" />
          <stop offset="94%" stopColor="#ffb27a" />
          <stop offset="100%" stopColor="#2be2ff" />
          {reduceMotion ? null : (
            <animateTransform attributeName="gradientTransform" type="rotate"
                               from="0 50 50" to="360 50 50" dur="10s"
                               repeatCount="indefinite" />
          )}
        </linearGradient>

        <filter id="orbBlurSoft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <filter id="orbBlurHalo" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="6" />
        </filter>

        <clipPath id="orbCoreClip">
          <circle cx="50" cy="50" r="12.5" />
        </clipPath>
      </defs>

      {/* breathing halo, behind everything */}
      <circle className="orb__halo" cx="50" cy="50" r="24" fill="url(#orbHalo)"
              filter="url(#orbBlurHalo)" />

      {/* ---- ribbons, behind the core ---- */}
      <g opacity="0.55" filter="url(#orbBlurSoft)">
        <Ribbon rx={22} ry={9} rotateFrom={0} rotateTo={360} dur="9s"
                morph="22;24.5;20.5;22" morphRy="9;7.5;10.5;9" morphDur="15s" />
        <Ribbon rx={25} ry={7} rotateFrom={120} rotateTo={-240} dur="13s"
                morph="25;22.5;27;25" morphRy="7;9;5.5;7" morphDur="18s" />
        <Ribbon rx={19} ry={11} rotateFrom={240} rotateTo={600} dur="16s"
                morph="19;21;17.5;19" morphRy="11;9;12.5;11" morphDur="12s" />
      </g>

      {/* ---- the core ---- */}
      <g className="orb__core">
        <circle cx="50" cy="50" r="12.5" fill="url(#orbCoreFill)" />
        <circle cx="50" cy="50" r="12.5" fill="none" stroke="url(#orbRibbon)"
                strokeOpacity="0.5" strokeWidth="0.6" />
        {/* the two "eyes" */}
        <g className="orb__eyes">
          <rect x="44.4" y="46.3" width="2.1" height="7.4" rx="1.05" fill="#bff3ff" />
          <rect x="53.5" y="46.3" width="2.1" height="7.4" rx="1.05" fill="#bff3ff" />
        </g>
      </g>

      {/* ---- same ribbons again, but only visible where they cross the core ---- */}
      <g opacity="0.95" clipPath="url(#orbCoreClip)">
        <Ribbon rx={22} ry={9} rotateFrom={0} rotateTo={360} dur="9s"
                morph="22;24.5;20.5;22" morphRy="9;7.5;10.5;9" morphDur="15s" />
        <Ribbon rx={25} ry={7} rotateFrom={120} rotateTo={-240} dur="13s"
                morph="25;22.5;27;25" morphRy="7;9;5.5;7" morphDur="18s" />
        <Ribbon rx={19} ry={11} rotateFrom={240} rotateTo={600} dur="16s"
                morph="19;21;17.5;19" morphRy="11;9;12.5;11" morphDur="12s" />
      </g>

      {/* ---- drifting particles: a few riding the orbits, a few free ---- */}
      <g fill="#dff6ff">
        <Particle pathRx={22} pathRy={9} dur="9s" begin="0s" r={0.8} />
        <Particle pathRx={25} pathRy={7} dur="13s" begin="-4s" r={0.65} />
        <Particle pathRx={19} pathRy={11} dur="16s" begin="-8s" r={0.9} />
        <circle className="orb__free-particle orb__free-particle--a" cx="24" cy="30" r="0.7" />
        <circle className="orb__free-particle orb__free-particle--b" cx="76" cy="66" r="0.6" />
        <circle className="orb__free-particle orb__free-particle--c" cx="72" cy="28" r="0.55" />
      </g>
    </svg>
  )
}

function Ribbon({
  rx,
  ry,
  rotateFrom,
  rotateTo,
  dur,
  morph,
  morphRy,
  morphDur,
}: {
  rx: number
  ry: number
  rotateFrom: number
  rotateTo: number
  dur: string
  morph: string
  morphRy: string
  morphDur: string
}) {
  return (
    <g transform={`rotate(${rotateFrom} 50 50)`}>
      {reduceMotion ? null : (
        <animateTransform attributeName="transform" type="rotate" additive="sum"
                           from={`0 50 50`} to={`${rotateTo - rotateFrom} 50 50`}
                           dur={dur} repeatCount="indefinite" />
      )}
      <ellipse cx="50" cy="50" rx={rx} ry={ry} fill="none" stroke="url(#orbRibbon)"
               strokeWidth="1.7" strokeLinecap="round">
        {reduceMotion ? null : (
          <>
            <animate attributeName="rx" values={morph} dur={morphDur} repeatCount="indefinite" />
            <animate attributeName="ry" values={morphRy} dur={morphDur} repeatCount="indefinite" />
          </>
        )}
      </ellipse>
    </g>
  )
}

function Particle({
  pathRx,
  pathRy,
  dur,
  begin,
  r,
}: {
  pathRx: number
  pathRy: number
  dur: string
  begin: string
  r: number
}) {
  const d = `M ${50 - pathRx} 50 A ${pathRx} ${pathRy} 0 1 0 ${50 + pathRx} 50 `
    + `A ${pathRx} ${pathRy} 0 1 0 ${50 - pathRx} 50`
  if (reduceMotion) return null

  return (
    <circle r={r} opacity="0">
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={d} rotate="auto" />
      <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.08;0.85;1"
                dur={dur} begin={begin} repeatCount="indefinite" />
    </circle>
  )
}
