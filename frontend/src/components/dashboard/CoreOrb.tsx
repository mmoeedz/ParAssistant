import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

/**
 * The Agent Network's core visualization: a ringed planet. A dark
 * point-cloud globe with amber cloud bands, wrapped by a Saturn-style ring
 * system, two moons in orbit, a starfield, and a meteor shower that makes
 * the planet recoil where each one lands.
 *
 * Everything that should pass behind the planet is drawn before it and
 * everything that should pass in front is drawn after — the rings' far and
 * near halves, and each moon's two copies. That ordering is the whole depth
 * illusion; there is no 3D here.
 *
 * The panel this sits in is wide, not square. A fixed square viewBox would
 * letterbox under the browser's default `preserveAspectRatio` — fitted to
 * the shorter side, wasting most of the panel's width. This measures its
 * real box instead (the same ResizeObserver pattern the connector wires
 * beside it already use) and sizes everything off the true pixel dimensions.
 * A shallow ring plane is a good fit for that shape: wide but not tall.
 *
 * `phase` and `pulseKey` are driven from real store state by the caller (see
 * AgentNetwork.tsx) — there is no state invented here that doesn't correspond
 * to something the backend actually reported.
 */
export type CorePhase = 'idle' | 'thinking' | 'coordinating' | 'executing'

const TIMING: Record<CorePhase, { halo: string; rain: number }> = {
  idle: { halo: '4.6s', rain: 1 },
  thinking: { halo: '2.4s', rain: 0.74 },
  coordinating: { halo: '2s', rain: 0.6 },
  executing: { halo: '1.3s', rain: 0.44 },
}

const INTENSITY: Record<CorePhase, number> = { idle: 1, thinking: 1.1, coordinating: 1.18, executing: 1.3 }

/** How far the ring plane is tipped out of the horizontal, in degrees. */
const RING_TILT = -17
/** How open the plane is: the ry/rx ratio every ring shares. */
const FLAT = 0.25

/**
 * The ring system: concentric arcs all in the one plane, with gaps between
 * the groups. `r` is the semi-major axis as a multiple of the planet radius.
 */
const RINGS: { r: number; w: number; o: number; c: string }[] = [
  { r: 1.22, w: 0.06, o: 0.3, c: '#b07a3a' },
  { r: 1.34, w: 0.12, o: 0.62, c: '#e0a24e' },
  { r: 1.5, w: 0.17, o: 0.9, c: '#ffc76b' },
  { r: 1.66, w: 0.05, o: 0.35, c: '#c98a3c' },
  { r: 1.8, w: 0.13, o: 0.7, c: '#ffb347' },
  { r: 1.94, w: 0.06, o: 0.32, c: '#d59a4e' },
]

/**
 * Moons. Each is drawn twice — once before the planet and once after — with
 * the two copies taking alternate halves of the loop, so a moon emerges from
 * behind the planet, crosses in front of it, and passes back round the far
 * side. The handover happens at the limb, where the moon is edge-on to the
 * silhouette and the swap can't be seen.
 */
const MOONS: { rx: number; ry: number; rot: number; dur: number; size: number; begin: number }[] = [
  { rx: 1.62, ry: 0.42, rot: RING_TILT, dur: 23, size: 0.085, begin: 0 },
  { rx: 1.16, ry: 0.62, rot: 34, dur: 31, size: 0.055, begin: -14 },
]

/**
 * The incoming shower. The first is the hero — a long-tailed fireball out of
 * the upper right; the rest are smaller. Each runs its own loop so the
 * impacts never fall into a visible rhythm.
 */
const ASTEROIDS: { angle: number; dur: number; size: number; big?: boolean }[] = [
  { angle: 326, dur: 7.4, size: 1, big: true },
  { angle: 208, dur: 4.2, size: 0.85 },
  { angle: 24, dur: 5.6, size: 0.65 },
  { angle: 148, dur: 6.3, size: 1 },
]

/** When in each loop the meteor lands — every impact cue keys off this. */
const HIT = 0.34

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

/** A deterministic Fibonacci-sphere point cloud — never re-shuffles. */
function spherePoints(count: number, radius: number) {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const points: { x: number; y: number; r: number; o: number; near: boolean; lit: boolean }[] = []
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2
    const ring = Math.sqrt(1 - y * y)
    const theta = golden * i
    const depth = (Math.sin(theta) * ring + 1) / 2 // 0 = far side, 1 = near side
    points.push({
      x: Math.cos(theta) * ring * radius,
      y: y * radius,
      r: radius * (0.0055 + depth * 0.0085),
      o: 0.18 + depth * 0.72,
      near: depth > 0.5,
      // Only some twinkle: animating the whole cloud costs far more than it
      // adds, and a still majority is what reads as a solid surface.
      lit: i % 6 === 0,
    })
  }
  return points
}

/**
 * Background stars, scattered over the whole panel but kept clear of the
 * planet and its rings. Deterministic from a fixed seed so they hold still
 * between renders instead of re-scattering on every state change.
 */
function starField(count: number, w: number, h: number, cx: number, cy: number, R: number) {
  const out: { x: number; y: number; r: number; o: number; tone: string; lit: boolean }[] = []
  let seed = 1337
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  const tones = ['#cfe6ff', '#cfe6ff', '#cfe6ff', '#7fd8ff', '#ffc07a']
  for (let i = 0; i < count * 4 && out.length < count; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    const t = rnd()
    const pick = rnd()
    // Clear of the planet, and of the ring plane's shallow footprint.
    const dx = (x - cx) / (R * 2.1)
    const dy = (y - cy) / (R * 2.1 * FLAT + R * 0.5)
    if (dx * dx + dy * dy < 1) continue
    out.push({
      x,
      y,
      r: 0.5 + t * 1.1,
      o: 0.25 + t * 0.6,
      tone: tones[Math.floor(pick * tones.length)],
      lit: out.length % 3 === 0,
    })
  }
  return out
}

/** A small irregular rock, drawn once and reused at several sizes. */
const ROCK_PATH = 'M -1 -0.35 L -0.35 -1 L 0.5 -0.9 L 1 -0.2 L 0.8 0.6 L 0.1 1 L -0.65 0.75 L -1 0.15 Z'

export function CoreOrb({
  phase,
  pulseKey,
}: {
  phase: CorePhase
  /** Bumped by the caller once per task that just succeeded — one soft
      outward pulse per bump, then it's gone. 0 means "none yet". */
  pulseKey: number
}) {
  const uid = useId()
  const idOf = (name: string) => `${uid}-${name}`
  const t = TIMING[phase]
  const intensity = INTENSITY[phase]

  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 200, h: 150 })
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width && r.height) {
        setBox((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { w, h } = box
  const cx = w * 0.47
  const cy = h * 0.53
  // Sized off the shorter side so the planet stays circular, then held down
  // far enough that the widest ring still clears the panel's sides.
  const R = Math.min(w, h) * 0.26

  const points = useMemo(() => spherePoints(420, R), [R])
  const stars = useMemo(() => starField(54, w, h, cx, cy, R), [w, h, cx, cy, R])

  const flyFrom = cx + Math.max(R * 2.7, Math.hypot(w, h) * 0.62)
  const landAt = cx + R * 0.97
  const kFly = `0;0.06;${HIT - 0.02};${HIT};1`
  const kBurstR = `0;${HIT};${HIT + 0.06};${HIT + 0.14};1`
  const kBurstO = `0;${HIT};${HIT + 0.04};${HIT + 0.14};1`
  const kWaveR = `0;${HIT};${HIT + 0.22};1`
  const kWaveO = `0;${HIT};${HIT + 0.04};${HIT + 0.22};1`

  const shower = ASTEROIDS.map((a, i) => ({
    angle: a.angle,
    big: Boolean(a.big),
    dur: `${(a.dur * t.rain).toFixed(2)}s`,
    begin: `-${(i * 1.9).toFixed(2)}s`,
    tail: R * (a.big ? 1.5 : 0.42 * a.size),
    half: R * (a.big ? 0.085 : 0.03 * a.size),
    head: R * (a.big ? 0.055 : 0.024 * a.size),
  }))

  return (
    <div className="cw" ref={boxRef}>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-phase={phase} width={w} height={h}>
        <defs>
          <radialGradient id={idOf('globeFill')} cx="40%" cy="32%" r="78%">
            <stop offset="0%" stopColor="#14161c" />
            <stop offset="38%" stopColor="#0a0b0f" />
            <stop offset="76%" stopColor="#040507" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>

          {/* Cool limb light, held to the outermost edge only: with a black
              body this is all that separates the planet from the equally
              dark panel behind it. */}
          <radialGradient id={idOf('limb')} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2ba8ff" stopOpacity="0" />
            <stop offset="86%" stopColor="#2ba8ff" stopOpacity="0" />
            <stop offset="96%" stopColor="#3fb8ff" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#8fe0ff" stopOpacity="0.46" />
          </radialGradient>

          <radialGradient id={idOf('haloWarm')} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff9d2e" stopOpacity="0.16" />
            <stop offset="55%" stopColor="#ff6a1a" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#ff6a1a" stopOpacity="0" />
          </radialGradient>

          {/* Meteor trail: white-hot head into fire, then nothing. */}
          <linearGradient id={idOf('trail')} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="14%" stopColor="#ffe089" stopOpacity="0.85" />
            <stop offset="42%" stopColor="#ff8c1a" stopOpacity="0.55" />
            <stop offset="78%" stopColor="#ff3d0a" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#ff3d0a" stopOpacity="0" />
          </linearGradient>

          <linearGradient id={idOf('rock')} x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor="#9c8f7e" />
            <stop offset="55%" stopColor="#6b6153" />
            <stop offset="100%" stopColor="#3b3630" />
          </linearGradient>

          <filter id={idOf('ringGlow')} x="-25%" y="-120%" width="150%" height="340%">
            <feGaussianBlur stdDeviation={R * 0.022} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={idOf('bloom')} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={R * 0.055} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={idOf('blurHalo')} x="-160%" y="-160%" width="420%" height="420%">
            <feGaussianBlur stdDeviation={R * 0.24} />
          </filter>

          <clipPath id={idOf('globeClip')}>
            <circle cx={cx} cy={cy} r={R} />
          </clipPath>
        </defs>

        {/* ---- stars, behind everything ---- */}
        <g>
          {stars.map((s, i) => (
            <circle
              key={i}
              className={s.lit ? 'cw__mote' : undefined}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={s.tone}
              opacity={s.lit ? undefined : s.o}
              style={
                s.lit
                  ? { ['--mote-o' as string]: s.o, animationDelay: `${(i % 17) * 0.21}s` }
                  : undefined
              }
            />
          ))}
        </g>

        {/* a faint warm bloom, so the rings sit in something */}
        <circle className="cw__halo" cx={cx} cy={cy} r={R * 1.7} fill={`url(#${idOf('haloWarm')})`}
                filter={`url(#${idOf('blurHalo')})`}
                style={{ animationDuration: t.halo, opacity: intensity }} />

        {/* ---- rings, far half: drawn first so the planet hides them ---- */}
        <g filter={`url(#${idOf('ringGlow')})`} opacity={Math.min(0.85 * intensity, 1)}>
          {RINGS.map((r, i) => (
            <RingArc key={i} cx={cx} cy={cy} R={R} ring={r} half="far" />
          ))}
        </g>

        {/* ---- moons, far half ---- */}
        <g>
          {MOONS.map((m, i) => (
            <Moon key={i} cx={cx} cy={cy} R={R} moon={m} side="back" fill={`url(#${idOf('rock')})`} />
          ))}
        </g>

        {/* ---- the planet ---- */}
        <g className="cw__sphere" data-phase={phase} transform={`translate(${cx} ${cy})`}>
          {/* One recoil per meteor. These stack with `additive="sum"`, and
              since only one is ever off 1 at a time the planet pops once per
              impact rather than drifting in scale. */}
          {reduceMotion
            ? null
            : shower.map((a, i) => (
                <animateTransform key={`pop-${phase}-${i}`} attributeName="transform" type="scale"
                                   additive="sum" values="1;1;1.05;0.992;1;1"
                                   keyTimes={`0;${HIT};${HIT + 0.03};${HIT + 0.1};${HIT + 0.18};1`}
                                   dur={a.dur} begin={a.begin} repeatCount="indefinite" />
              ))}

          <circle r={R} fill={`url(#${idOf('globeFill')})`} />

          {points.map((p, i) => (
            <circle
              key={i}
              className={p.lit ? 'cw__mote' : undefined}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={p.near ? '#d8ecff' : '#6ea6e2'}
              opacity={p.lit ? undefined : p.o}
              style={
                p.lit
                  ? {
                      // The twinkle keyframe animates opacity around this base
                      // value — setting the `opacity` attribute as well would
                      // just be overridden, losing the depth shading.
                      ['--mote-o' as string]: p.o,
                      animationDelay: `${(i % 23) * 0.13}s`,
                    }
                  : undefined
              }
            />
          ))}

          <circle r={R} fill={`url(#${idOf('limb')})`} />
        </g>

        {/* ---- impact waves, spreading across the planet's surface ---- */}
        {reduceMotion ? null : (
          <g key={`waves-${phase}`} clipPath={`url(#${idOf('globeClip')})`} fill="none">
            {shower.map((a, i) => (
              <g key={i} transform={`rotate(${a.angle} ${cx} ${cy})`}>
                <circle cx={landAt} cy={cy} r="0" stroke="#ffd9a0" strokeWidth={R * 0.028} opacity="0">
                  <animate attributeName="r" values={`0;0;${R * 0.55};${R * 0.55}`} keyTimes={kWaveR}
                           dur={a.dur} begin={a.begin} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0;0.85;0;0" keyTimes={kWaveO}
                           dur={a.dur} begin={a.begin} repeatCount="indefinite" />
                </circle>
              </g>
            ))}
          </g>
        )}

        {/* ---- rings, near half: drawn over the planet ---- */}
        <g filter={`url(#${idOf('ringGlow')})`} opacity={Math.min(0.95 * intensity, 1)}>
          {RINGS.map((r, i) => (
            <RingArc key={i} cx={cx} cy={cy} R={R} ring={r} half="near" />
          ))}
        </g>

        {/* ---- moons, near half ---- */}
        <g>
          {MOONS.map((m, i) => (
            <Moon key={i} cx={cx} cy={cy} R={R} moon={m} side="front" fill={`url(#${idOf('rock')})`} />
          ))}
        </g>

        {/* ---- the shower: meteors in from off-panel, and the flash where
             each one lands on the limb ---- */}
        {reduceMotion ? null : (
          <g key={`shower-${phase}`} filter={`url(#${idOf('bloom')})`}>
            {shower.map((a, i) => (
              <g key={i} transform={`rotate(${a.angle} ${cx} ${cy})`}>
                <g opacity="0">
                  <animateMotion dur={a.dur} begin={a.begin} repeatCount="indefinite"
                                  path={`M ${flyFrom} ${cy} L ${landAt} ${cy}`}
                                  keyPoints="0;1;1" keyTimes={`0;${HIT};1`} calcMode="linear" />
                  <animate attributeName="opacity" values="0;1;1;0;0" keyTimes={kFly}
                           dur={a.dur} begin={a.begin} repeatCount="indefinite" />
                  <path d={`M 0 0 L ${a.tail} ${-a.half} L ${a.tail} ${a.half} Z`}
                        fill={`url(#${idOf('trail')})`} />
                  {a.big ? (
                    <g transform={`scale(${a.head})`}>
                      <path d={ROCK_PATH} fill={`url(#${idOf('rock')})`} />
                      <path d={ROCK_PATH} fill="#ffb545" fillOpacity="0.4" />
                    </g>
                  ) : (
                    <circle r={a.head} fill="#fffaf0" />
                  )}
                </g>

                <circle cx={landAt} cy={cy} r="0" fill="none" stroke="#ffc98a"
                        strokeWidth={R * (a.big ? 0.032 : 0.022)} opacity="0">
                  <animate attributeName="r"
                           values={`0;0;${R * (a.big ? 0.3 : 0.18)};${R * (a.big ? 0.44 : 0.27)};${R * (a.big ? 0.44 : 0.27)}`}
                           keyTimes={kBurstR} dur={a.dur} begin={a.begin} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0;0.95;0;0" keyTimes={kBurstO}
                           dur={a.dur} begin={a.begin} repeatCount="indefinite" />
                </circle>
              </g>
            ))}
          </g>
        )}

        {/* ---- one soft outward pulse per completed task ---- */}
        {pulseKey > 0 && !reduceMotion ? <CompletePulse key={pulseKey} cx={cx} cy={cy} r0={R} r1={R * 1.6} /> : null}
      </svg>
    </div>
  )
}

/**
 * Half of one ring. The arc from the left of the ellipse to the right runs
 * over the top with sweep 1 and under the bottom with sweep 0 — and with the
 * plane tipped towards the viewer, the top is the far side.
 */
function RingArc({
  cx,
  cy,
  R,
  ring,
  half,
}: {
  cx: number
  cy: number
  R: number
  ring: { r: number; w: number; o: number; c: string }
  half: 'far' | 'near'
}) {
  const rx = R * ring.r
  const ry = rx * FLAT
  const d = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 ${half === 'far' ? 1 : 0} ${cx + rx} ${cy}`
  return (
    <path d={d} fill="none" stroke={ring.c} strokeOpacity={ring.o} strokeWidth={R * ring.w}
          transform={`rotate(${RING_TILT} ${cx} ${cy})`} />
  )
}

/**
 * One moon on one half of one orbit. Same split as the rings: the path's
 * first arc runs over the far side and the second over the near side, so
 * gating opacity at the halfway mark decides which copy this is.
 */
function Moon({
  cx,
  cy,
  R,
  moon,
  side,
  fill,
}: {
  cx: number
  cy: number
  R: number
  moon: { rx: number; ry: number; rot: number; dur: number; size: number; begin: number }
  side: 'back' | 'front'
  fill: string
}) {
  const rx = R * moon.rx
  const ry = R * moon.ry
  const dur = `${moon.dur}s`
  const begin = `${moon.begin}s`

  const rock = (
    <g transform={`scale(${R * moon.size})`}>
      {reduceMotion ? null : (
        <animateTransform attributeName="transform" type="rotate" additive="sum"
                           from="0" to="360" dur={`${(moon.dur * 0.6).toFixed(1)}s`}
                           repeatCount="indefinite" />
      )}
      <path d={ROCK_PATH} fill={fill} stroke="#b9a893" strokeOpacity="0.28" strokeWidth="0.06" />
    </g>
  )

  // Standing still, one copy is enough — park it on the near side.
  if (reduceMotion) {
    if (side === 'back') return null
    const a = (140 * Math.PI) / 180
    return (
      <g transform={`rotate(${moon.rot} ${cx} ${cy})`}>
        <g transform={`translate(${cx + Math.cos(a) * rx} ${cy + Math.sin(a) * ry})`}>{rock}</g>
      </g>
    )
  }

  const d = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} `
    + `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`

  return (
    <g transform={`rotate(${moon.rot} ${cx} ${cy})`}>
      <g opacity={side === 'back' ? 1 : 0}>
        <animateMotion dur={dur} begin={begin} repeatCount="indefinite" path={d} />
        <animate attributeName="opacity" values={side === 'back' ? '1;1;0;0' : '0;0;1;1'}
                 keyTimes="0;0.49;0.5;1" dur={dur} begin={begin} repeatCount="indefinite" />
        {rock}
      </g>
    </g>
  )
}

/** One expanding, fading ring — "an elegant soft pulse", not a flash. */
function CompletePulse({ cx, cy, r0, r1 }: { cx: number; cy: number; r0: number; r1: number }) {
  return (
    <circle cx={cx} cy={cy} r={r0} fill="none" stroke="#ffd9a0" strokeWidth={r0 * 0.04}>
      <animate attributeName="r" values={`${r0};${r1}`} dur="1.4s" fill="freeze" calcMode="spline"
               keySplines="0.2 0 0.3 1" />
      <animate attributeName="opacity" values="0.8;0" dur="1.4s" fill="freeze" calcMode="spline"
               keySplines="0.2 0 0.3 1" />
    </circle>
  )
}
