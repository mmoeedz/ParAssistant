/**
 * The Agent Town floor, drawn.
 *
 * This is the room from the reference design rebuilt as vector art, 790 units
 * wide and as tall as the panel gives it: the cubicle row along the top wall
 * is fixed, and the two rooms below stretch to fill, so the town always fills
 * its panel instead of letterboxing. Nobody is drawn into it — the only people
 * in the town are the live agents, so an empty desk means the agent that owns
 * it really is somewhere else.
 *
 * Palette is sampled from the reference.
 */

const C = {
  void: '#03080b',
  wall: '#0e1c23',
  wallLit: '#152531',
  floor: '#172a38',
  roomFloor: '#1c3143',
  ink: '#08131b',
  floorAlt: '#182d3a',
  band: '#132330',
  boothIn: '#1b2c39',
  panel: '#2e3944',
  panelLit: '#476173',
  edge: '#83959a',
  counter: '#23465d',
  counterDeep: '#1d3344',
  chair: '#163048',
  chairLit: '#25507e',
  screen: '#0d1f2b',
  glass: '#2f6f96',
  wood: '#6b5740',
  woodLit: '#8a7052',
  leaf: '#2f6b39',
  leafLit: '#4ea548',
  pot: '#37536b',
  orange: '#c8703a',
  orangeLit: '#e08a4c',
  red: '#8c2f34',
} as const

/** Desks in the top-wall cubicle row. */
const CUBICLES = [62, 175, 285, 390]

/** The drawing's natural height; the rooms stretch from here. */
export const FLOOR_BASE_H = 350

export function TownFloor({ height = FLOOR_BASE_H }: { height?: number }) {
  const h = Math.max(300, height)
  // top of the counter that runs along the bottom wall
  const b = h - 20
  const roomH = b - 152

  return (
    <g className="floor" aria-hidden="true" stroke={C.ink} strokeWidth="0" >
      <defs>
        <pattern id="townTile" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill={C.floor} />
          <path d="M26 0H0V26" fill="none" stroke="#ffffff" strokeOpacity="0.045" strokeWidth="1" />
        </pattern>
        <pattern id="townTileRoom" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill={C.roomFloor} />
          <path d="M26 0H0V26" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
        <linearGradient id="townGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.glass} stopOpacity="0.85" />
          <stop offset="100%" stopColor={C.glass} stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* ------------------------------------------------------- structure -- */}
      <rect width="790" height={h} fill={C.void} />

      {/* top band: the cubicle row */}
      <rect y="12" width="790" height="121" fill="url(#townTile)" />
      <rect width="790" height="13" fill={C.wall} />
      <rect width="150" height="3" fill="#2aa5b5" opacity="0.5" />
      <rect x="150" width="640" height="2" fill={C.panelLit} opacity="0.16" />

      {/* fittings on the top wall */}
      <rect x="40" y="2" width="26" height="9" rx="1" fill={C.glass} opacity="0.6" />
      <rect x="152" y="2" width="14" height="10" rx="1" fill={C.orange} opacity="0.65" />
      <rect x="170" y="2" width="14" height="10" rx="1" fill={C.red} opacity="0.7" />

      {/* the walkway between the cubicles and the rooms */}
      <rect y="133" width="790" height="19" fill={C.band} />
      <rect y="133" width="790" height="1" fill={C.edge} opacity="0.14" />
      <rect y="151" width="790" height="1" fill="#000" opacity="0.5" />

      {/* the two rooms — these stretch to fill the panel */}
      <rect x="30" y="152" width="420" height={roomH} fill="url(#townTileRoom)" />
      <rect x="487" y="152" width="303" height={roomH} fill="url(#townTileRoom)" />
      <rect x="30" y="152" width="420" height="16" fill={C.wall} />
      <rect x="487" y="152" width="303" height="16" fill={C.wall} />

      {/* outer walls and the divider between the rooms */}
      <rect y="152" width="30" height={h - 152} fill={C.void} />
      <rect x="450" y="152" width="37" height={roomH} fill={C.wall} />
      <rect x="450" y="152" width="2" height={roomH} fill={C.edge} opacity="0.1" />
      <rect x="485" y="152" width="2" height={roomH} fill={C.edge} opacity="0.1" />

      {/* the counter that runs along the bottom wall */}
      <rect y={b} width="790" height="20" fill={C.counter} />
      <rect y={b} width="790" height="3" fill={C.edge} opacity="0.4" />
      <rect y={b + 15} width="790" height="5" fill={C.void} opacity="0.6" />
      {Array.from({ length: 16 }).map((_, i) => (
        <rect key={i} x={12 + i * 50} y={b + 6} width="34" height="2" rx="1" fill={C.edge}
              opacity="0.12" />
      ))}

      {/* ---------------------------------------------------- top-wall row -- */}
      {CUBICLES.map((cx) => (
        <Cubicle key={cx} x={cx} />
      ))}

      {/* the desk flanked by plants */}
      <Desk x={470} y={96} w={78} />
      <Monitor x={442} y={62} w={26} h={18} />
      <Plant x={424} y={104} s={1.1} />
      <Plant x={516} y={104} s={1.1} />
      <Chair x={470} y={112} />

      {/* the corner desk with its wall unit */}
      <g strokeWidth="1.4">
        <rect x="546" y="60" width="26" height="44" rx="2" fill={C.panel} />
        <rect x="549" y="64" width="20" height="14" rx="1" fill={C.screen} />
        <rect x="549" y="82" width="20" height="4" rx="1" fill={C.edge} opacity="0.25" />
        <rect x="548" y="96" width="86" height="26" rx="3" fill={C.wood} />
        <rect x="548" y="96" width="86" height="4" rx="2" fill={C.woodLit} />
        <rect x="556" y="104" width="18" height="10" rx="1" fill={C.edge} opacity="0.5" />
        <rect x="608" y="104" width="16" height="10" rx="1" fill={C.screen} />
        <Chair x={590} y={128} />
      </g>

      {/* wall screen above it */}
      <rect x="596" y="4" width="62" height="42" rx="2" fill={C.screen} stroke={C.panel} />
      <rect x="600" y="8" width="54" height="16" rx="1" fill={C.orange} opacity="0.5" />
      <rect x="600" y="28" width="34" height="3" fill={C.edge} opacity="0.35" />
      <rect x="600" y="34" width="44" height="3" fill={C.edge} opacity="0.22" />

      {/* the waiting corner */}
      <rect x="676" y="18" width="106" height="26" rx="2" fill={C.wall} />
      {[690, 722, 754].map((x) => (
        <rect key={x} x={x} y="22" width="24" height="18" rx="3" fill={C.wood} />
      ))}
      {[688, 724, 760].map((x) => (
        <WoodChair key={x} x={x} y="98" />
      ))}
      <rect x="700" y="118" width="64" height="12" rx="4" fill={C.chair} />

      {/* --------------------------------------------------------- left room -- */}
      {/* wall fittings */}
      <rect x="50" y="155" width="58" height="18" rx="1" fill={C.edge} opacity="0.75" />
      <rect x="54" y="159" width="30" height="2" fill={C.wall} opacity="0.6" />
      <rect x="54" y="164" width="42" height="2" fill={C.wall} opacity="0.45" />
      <Cabinet x={267} y={157} w={40} h={38} />
      {[348, 378, 408].map((x) => (
        <g key={x}>
          <rect x={x} y="158" width="26" height="20" rx="1" fill={C.wall} stroke={C.panel} />
          <rect x={x + 3} y="161" width="20" height="14" fill={C.wood} opacity="0.55" />
        </g>
      ))}

      {/* sofa */}
      <g strokeWidth="1.4">
        <rect x="47" y="188" width="62" height="38" rx="4" fill={C.chair} />
        <rect x="51" y="192" width="54" height="16" rx="3" fill={C.chairLit} opacity="0.75" />
        <rect x="51" y="211" width="54" height="11" rx="3" fill={C.chairLit} opacity="0.5" />
      </g>

      <Plant x={135} y={228} s={1.35} />

      {/* armchair and the small desk beside it */}
      <rect x="192" y="196" width="34" height="26" rx="5" fill={C.chairLit} opacity="0.8" />
      <rect x="200" y="212" width="34" height="42" rx="2" fill={C.panel} />
      <rect x="200" y="212" width="34" height="3" fill={C.edge} opacity="0.3" />

      {/* water cooler */}
      <g strokeWidth="1.4">
        <rect x="236" y="182" width="26" height="24" rx="3" fill={C.panel} />
        <ellipse cx="249" cy="178" rx="12" ry="9" fill={C.glass} opacity="0.75" />
        <rect x="242" y="192" width="14" height="6" rx="1" fill={C.screen} />
      </g>

      {/* paper-strewn desk */}
      <rect x="308" y="190" width="40" height="30" rx="2" fill={C.panel} />
      <rect x="312" y="194" width="15" height="11" rx="1" fill={C.edge} opacity="0.8" />
      <rect x="330" y="196" width="14" height="9" rx="1" fill={C.edge} opacity="0.55" />

      {/* wooden table with the first-aid box */}
      <g strokeWidth="1.4">
        <rect x="64" y={b - 94} width="46" height="50" rx="3" fill={C.wood} />
        <rect x="64" y={b - 94} width="46" height="4" rx="2" fill={C.woodLit} />
        <rect x="72" y={b - 86} width="30" height="20" rx="2" fill={C.edge} opacity="0.85" />
        <rect x="85" y={b - 82} width="4" height="12" fill={C.red} />
        <rect x="81" y={b - 78} width="12" height="4" fill={C.red} />
      </g>

      {/* low table with papers, and a planter */}
      <rect x="150" y={b - 68} width="48" height="32" rx="3" fill={C.panel} />
      <rect x="156" y={b - 62} width="26" height="16" rx="1" fill={C.edge} opacity="0.7" />
      <rect x="190" y={b - 86} width="42" height="44" rx="3" fill={C.panel} />
      <Plant x={211} y={b - 62} s={1.15} />

      {/* the desk at the room's inner edge */}
      <g strokeWidth="1.4">
        <rect x="348" y={b - 82} width="48" height="54" rx="2" fill={C.panel} />
        <rect x="352" y={b - 78} width="40" height="20" rx="1" fill={C.screen} />
        <rect x="355" y={b - 75} width="16" height="14" rx="1" fill={C.glass} opacity="0.6" />
        <rect x="352" y={b - 52} width="40" height="18" rx="1" fill={C.edge} opacity="0.55" />
      </g>

      {/* odds and ends */}
      <rect x="262" y="228" width="30" height="20" rx="2" fill={C.panel} strokeWidth="1.4" />
      <rect x="266" y="232" width="14" height="10" rx="1" fill={C.edge} opacity="0.55" />
      <rect x="300" y={b - 44} width="34" height="22" rx="2" fill={C.counterDeep}
            strokeWidth="1.4" />
      <Plant x={398} y={222} s={0.9} />

      {/* bushes along the bottom wall */}
      {[44, 96, 128, 160, 236].map((x, i) => (
        <Bush key={x} x={x} y={b - (i === 0 ? 24 : 12)} s={i === 0 ? 1.2 : 1} />
      ))}
      <Plant x={44} y={b} s={1.2} />

      {/* -------------------------------------------------------- right room -- */}
      {/* server wall */}
      <g strokeWidth="1.4">
        <rect x="492" y="164" width="113" height="44" rx="2" fill={C.wall} stroke={C.panel} />
        {[498, 522, 546, 570].map((x) => (
          <rect key={x} x={x} y="170" width="18" height="12" rx="1" fill={C.screen} />
        ))}
        {[498, 522, 546, 570].map((x) => (
          <rect key={x} x={x} y="188" width="18" height="4" rx="1" fill={C.glass} opacity="0.7" />
        ))}
        <rect x="498" y="196" width="100" height="6" rx="1" fill={C.counter} />
      </g>

      <Cabinet x={607} y={157} w={44} h={54} />

      <g>
        <rect x="655" y="180" width="66" height="28" rx="2" fill={C.counterDeep} />
        <rect x="659" y="184" width="58" height="12" rx="1" fill={C.glass} opacity="0.55" />
        <rect x="659" y="200" width="30" height="4" rx="1" fill={C.edge} opacity="0.3" />
      </g>

      {/* red rack */}
      <g strokeWidth="1.4">
        <rect x="727" y="174" width="44" height="58" rx="2" fill={C.wall} stroke={C.panel} />
        {[180, 192, 204, 216].map((y) => (
          <rect key={y} x="732" y={y} width="34" height="7" rx="1" fill={C.red} opacity="0.75" />
        ))}
      </g>

      {/* the desk under the cabinet */}
      <rect x="566" y="212" width="40" height="30" rx="3" fill={C.panel} />
      <Chair x={586} y={250} tone={C.leafLit} />

      {/* scanner bed */}
      <g strokeWidth="1.4">
        <rect x="496" y={b - 64} width="66" height="78" rx="4" fill={C.counterDeep} />
        <rect x="500" y={b - 60} width="58" height="34" rx="3" fill="url(#townGlass)" />
        <rect x="500" y={b - 22} width="58" height="30" rx="3" fill={C.chair} />
      </g>

      <WoodChair x={586} y={b} big />
      <rect x="640" y={b - 68} width="42" height="26" rx="2" fill={C.panel} strokeWidth="1.4" />
      <rect x="645" y={b - 64} width="20" height="12" rx="1" fill={C.glass} opacity="0.5" />
      <Plant x={520} y={236} s={1} />
      <rect x="738" y="228" width="22" height="26" rx="4" fill={C.chairLit} opacity="0.75" />

      {/* the big planter in the corner */}
      <g strokeWidth="1.4">
        <ellipse cx="732" cy={b} rx="26" ry="14" fill={C.pot} />
        <rect x="706" y={b - 18} width="52" height="18" fill={C.pot} />
        <ellipse cx="732" cy={b - 22} rx="27" ry="17" fill={C.leafLit} />
        <ellipse cx="722" cy={b - 26} rx="14" ry="9" fill="#63c05c" opacity="0.8" />
      </g>
    </g>
  )
}

/* ----------------------------------------------------------------- parts -- */

/**
 * A workstation in the top row: a booth of grey panels around a dark interior,
 * a back counter with kit on it, a monitor on the desk, and a chair pulled out.
 */
function Cubicle({ x }: { x: number }) {
  return (
    <g strokeWidth="1.4">
      {/* booth */}
      <rect x={x - 50} y="15" width="100" height="79" rx="2" fill={C.boothIn} />
      <rect x={x - 50} y="15" width="100" height="79" rx="2" fill="none" stroke={C.panel}
            strokeWidth="2" />
      <rect x={x - 50} y="15" width="5" height="79" fill={C.panel} />
      <rect x={x + 45} y="15" width="5" height="79" fill={C.panel} />
      <rect x={x - 50} y="15" width="100" height="4" fill={C.panelLit} opacity="0.55" />

      {/* back counter and the kit on it */}
      <rect x={x - 44} y="24" width="88" height="20" rx="2" fill={C.counterDeep} />
      <rect x={x - 44} y="24" width="88" height="2" fill={C.edge} opacity="0.22" />
      <rect x={x - 39} y="28" width="17" height="12" rx="1" fill={C.glass} opacity="0.6" />
      <rect x={x - 17} y="30" width="12" height="9" rx="1" fill={C.edge} opacity="0.45" />
      <rect x={x + 2} y="29" width="14" height="11" rx="1" fill={C.leafLit} opacity="0.35" />
      <rect x={x + 22} y="28" width="16" height="12" rx="1" fill={C.orange} opacity="0.4" />

      {/* desk, monitor, chair */}
      <Desk x={x} y={58} w={86} />
      <Monitor x={x - 13} y={44} w={26} h={16} />
      <Chair x={x} y={90} />
    </g>
  )
}

function Desk({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g strokeWidth="1.4">
      <rect x={x - w / 2} y={y} width={w} height="22" rx="2" fill={C.counter} />
      <rect x={x - w / 2} y={y} width={w} height="4" rx="2" fill={C.edge} opacity="0.28" />
    </g>
  )
}

function Monitor({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill={C.screen} stroke={C.panelLit}
            strokeOpacity="0.5" />
      <rect x={x + 2} y={y + 2} width={w - 4} height={h - 6} rx="1" fill={C.glass} opacity="0.55" />
    </g>
  )
}

function Chair({ x, y, tone = C.chairLit }: { x: number; y: number; tone?: string }) {
  return (
    <g strokeWidth="1.4">
      <ellipse cx={x} cy={y + 21} rx="15" ry="4" fill="#000" opacity="0.28" stroke="none" />
      <rect x={x - 16} y={y - 9} width="32" height="12" rx="5" fill={C.chair} />
      <rect x={x - 13} y={y - 1} width="26" height="19" rx="7" fill={tone} />
      <rect x={x - 11} y={y + 1} width="22" height="7" rx="3.5" fill="#fff" opacity="0.1" />
      <rect x={x - 2.5} y={y + 18} width="5" height="5" fill={C.panel} />
    </g>
  )
}

function WoodChair({ x, y, big = false }: { x: number; y: number | string; big?: boolean }) {
  const w = big ? 34 : 22
  const yy = Number(y)
  return (
    <g strokeWidth="1.4">
      <rect x={x} y={yy} width={w} height={big ? 12 : 9} rx="2" fill={C.woodLit} />
      <rect x={x} y={yy + (big ? 12 : 9)} width={w} height={big ? 20 : 14} rx="2" fill={C.wood} />
      <rect x={x + 2} y={yy + (big ? 30 : 21)} width="3" height="6" fill={C.panel} />
      <rect x={x + w - 5} y={yy + (big ? 30 : 21)} width="3" height="6" fill={C.panel} />
    </g>
  )
}

function Cabinet({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g strokeWidth="1.4">
      <rect x={x} y={y} width={w} height={h} rx="3" fill={C.orange} />
      <rect x={x} y={y} width={w} height="3" rx="1.5" fill={C.orangeLit} />
      <rect x={x + 6} y={y + 8} width={w - 12} height={h - 22} rx="2" fill={C.edge}
            opacity="0.85" />
      <rect x={x + w / 2 - 5} y={y + h - 9} width="10" height="3" rx="1.5" fill={C.wall}
            opacity="0.6" />
    </g>
  )
}

function Plant({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} strokeWidth="1.4">
      <rect x="-8" y="0" width="16" height="11" rx="2" fill={C.pot} />
      <rect x="-8" y="0" width="16" height="3" rx="1.5" fill={C.edge} opacity="0.25" />
      <ellipse cx="0" cy="-9" rx="12" ry="10" fill={C.leaf} />
      <ellipse cx="-6" cy="-4" rx="7" ry="6" fill={C.leaf} />
      <ellipse cx="6" cy="-4" rx="7" ry="6" fill={C.leaf} />
      <ellipse cx="-2" cy="-13" rx="6" ry="5" fill={C.leafLit} opacity="0.55" />
    </g>
  )
}

function Bush({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} strokeWidth="1.4">
      <ellipse cx="0" cy="0" rx="13" ry="8" fill={C.leaf} />
      <ellipse cx="-6" cy="-3" rx="7" ry="5" fill={C.leafLit} opacity="0.45" />
      <ellipse cx="6" cy="-2" rx="6" ry="4" fill={C.leafLit} opacity="0.3" />
    </g>
  )
}
