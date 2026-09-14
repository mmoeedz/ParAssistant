/**
 * The world map behind GLOBAL ACTIVITY.
 *
 * Continents are approximated with simplified coastline polygons (plus a
 * handful of small islands as ellipses) and rasterised onto a grid, which
 * reads as a real world map at this size without shipping a full geographic
 * dataset.
 *
 * The coloured nodes and arcs on top are tied to agents: while an agent is
 * busy, one of its cities and one of its routes lights up and a pulse travels
 * the route, rotating to another of its cities every couple of seconds —
 * meant to read like individual live requests rather than a permanent glow
 * over every city that agent could ever touch. Positions are arbitrary — no
 * city is being claimed — but the lighting is tied to real state.
 */

import type { AgentId } from '@/types/agents'

interface Ellipse {
  kind: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
  rot?: number
}

interface Polygon {
  kind: 'polygon'
  pts: [number, number][]
}

type Land = Ellipse | Polygon

// Coordinate space: 120 wide (180W..180E) by 62 tall (85N..60S).
const LAND: Land[] = [
  // North America — Alaska/Canada arctic coast, Hudson Bay notch, the US
  // outline with a Maine bump, a Florida peninsula and a Baja California jut.
  {
    kind: 'polygon',
    pts: [
      [9, 14], [9, 10], [12, 7], [18, 5], [26, 4], [33, 6], [35, 10],
      [32, 9], [30, 13], [33, 15], [29, 17], [30, 16], [29, 19], [31, 21],
      [29, 24], [26, 22], [24, 25], [20, 24], [18, 22], [15, 21], [17, 19],
      [14, 18], [10, 14],
    ],
  },
  { kind: 'ellipse', cx: 30, cy: 8, rx: 6, ry: 3 }, // arctic islands
  { kind: 'ellipse', cx: 41, cy: 10, rx: 4, ry: 5 }, // Greenland
  { kind: 'ellipse', cx: 48, cy: 7, rx: 1.4, ry: 1 }, // Iceland
  // Central America — the narrow isthmus linking north and south.
  { kind: 'polygon', pts: [[22, 26], [26, 25], [30, 27], [28, 30], [24, 29], [21, 27]] },
  // South America — wide Brazil bulge tapering to a Patagonian point.
  {
    kind: 'polygon',
    pts: [
      [30, 29], [35, 27], [41, 29], [46, 33], [45, 38], [42, 44], [38, 49],
      [35, 53], [33, 56], [31, 52], [29, 46], [28, 40], [29, 34],
    ],
  },
  // Europe — Iberia, an Italian boot, Scandinavia reaching north.
  {
    kind: 'polygon',
    pts: [
      [53, 15], [52, 12], [55, 9], [59, 6], [63, 8], [66, 11], [64, 14],
      [61, 13], [62, 17], [58, 16], [55, 17],
    ],
  },
  { kind: 'ellipse', cx: 51, cy: 12, rx: 1.5, ry: 1 }, // UK / Ireland
  // Africa — Horn of Africa jutting east, tapering to the Cape.
  {
    kind: 'polygon',
    pts: [
      [55, 20], [60, 17], [65, 18], [70, 23], [68, 27], [70, 30], [66, 34],
      [64, 38], [62, 42], [60, 45], [57, 42], [55, 37], [54, 32], [53, 26],
      [54, 22],
    ],
  },
  { kind: 'ellipse', cx: 70, cy: 40, rx: 1.6, ry: 2.2 }, // Madagascar
  // Russia / north Asia, reaching down to a Kamchatka jut.
  {
    kind: 'polygon',
    pts: [
      [66, 15], [65, 10], [70, 7], [80, 5], [92, 6], [100, 9], [97, 14],
      [93, 17], [88, 19], [80, 20], [72, 19],
    ],
  },
  // Middle East / Arabian peninsula, narrowing to a point south.
  {
    kind: 'polygon',
    pts: [[70, 20], [74, 17], [80, 18], [84, 21], [82, 25], [78, 27], [75, 24], [71, 23]],
  },
  // India / China, with the Indian subcontinent jutting down as a triangle.
  {
    kind: 'polygon',
    pts: [[80, 22], [85, 20], [90, 22], [92, 26], [89, 28], [86, 32], [83, 28], [81, 25]],
  },
  { kind: 'ellipse', cx: 99, cy: 23, rx: 1.6, ry: 1 }, // Korea
  { kind: 'ellipse', cx: 103, cy: 24, rx: 1.2, ry: 2.6, rot: 20 }, // Japan
  // Southeast Asia, the Indochina peninsula reaching toward Malaysia.
  {
    kind: 'polygon',
    pts: [[90, 28], [95, 27], [99, 29], [98, 33], [95, 35], [92, 32], [90, 30]],
  },
  { kind: 'ellipse', cx: 96, cy: 35, rx: 2, ry: 1 }, // Sumatra
  { kind: 'ellipse', cx: 100, cy: 34, rx: 2.3, ry: 1.6 }, // Borneo
  { kind: 'ellipse', cx: 104, cy: 36, rx: 1.6, ry: 1 }, // Sulawesi / Philippines belt
  { kind: 'ellipse', cx: 99, cy: 38.5, rx: 1.8, ry: 0.9 }, // Java
  // Australia, a Cape York jut up top and a flatter southern coast.
  {
    kind: 'polygon',
    pts: [
      [97, 42], [100, 39], [104, 40], [109, 42], [110, 46], [107, 49],
      [102, 49], [97, 47], [95, 44],
    ],
  },
  { kind: 'ellipse', cx: 112, cy: 50, rx: 1.3, ry: 1 }, // New Zealand
]

function insideEllipse(x: number, y: number, e: Ellipse): boolean {
  let dx = x - e.cx
  let dy = y - e.cy
  if (e.rot) {
    const a = (e.rot * Math.PI) / 180
    const rx = dx * Math.cos(a) - dy * Math.sin(a)
    const ry = dx * Math.sin(a) + dy * Math.cos(a)
    dx = rx
    dy = ry
  }
  return (dx * dx) / (e.rx * e.rx) + (dy * dy) / (e.ry * e.ry) <= 1
}

/** Standard ray-casting point-in-polygon test. */
function insidePolygon(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function inside(x: number, y: number, land: Land): boolean {
  return land.kind === 'ellipse' ? insideEllipse(x, y, land) : insidePolygon(x, y, land.pts)
}

let cache: [number, number][] | null = null

export function worldDots(step = 1.2): [number, number][] {
  if (cache) return cache
  const dots: [number, number][] = []
  for (let y = 4; y < 58; y += step) {
    for (let x = 2; x < 118; x += step) {
      if (LAND.some((land) => inside(x, y, land))) dots.push([x, y])
    }
  }
  cache = dots
  return dots
}

/* ------------------------------------------------------------ activity -- */

export type MapTone = 'teal' | 'green' | 'orange' | 'red' | 'yellow'

export interface MapNode {
  x: number
  y: number
  tone: MapTone
  /** Whose activity lights this node. */
  agent: AgentId
  /** Big nodes read as hubs, small ones as chatter. */
  size: number
}

export const TONE_VAR: Record<MapTone, string> = {
  teal: 'var(--m-teal)',
  green: 'var(--m-green)',
  orange: 'var(--m-orange)',
  red: 'var(--m-red)',
  yellow: 'var(--m-yellow)',
}

export const NODES: MapNode[] = [
  // Americas
  { x: 17, y: 13, tone: 'red', agent: 'zeno', size: 1.5 },
  { x: 25, y: 17, tone: 'orange', agent: 'zeno', size: 1.9 },
  { x: 13, y: 21, tone: 'yellow', agent: 'kai', size: 1.3 },
  { x: 26, y: 22, tone: 'teal', agent: 'orion', size: 1.5 },
  { x: 30, y: 27, tone: 'orange', agent: 'axel', size: 1.2 },
  { x: 36, y: 33, tone: 'teal', agent: 'orion', size: 1.4 },
  { x: 40, y: 41, tone: 'red', agent: 'nova', size: 1.6 },
  { x: 37, y: 46, tone: 'orange', agent: 'zeno', size: 1.2 },
  // Europe / Africa
  { x: 41, y: 9, tone: 'teal', agent: 'orion', size: 1.2 },
  { x: 57, y: 12, tone: 'green', agent: 'luna', size: 1.8 },
  { x: 63, y: 16, tone: 'teal', agent: 'orion', size: 1.4 },
  { x: 55, y: 17, tone: 'yellow', agent: 'kai', size: 1.2 },
  { x: 60, y: 25, tone: 'orange', agent: 'zeno', size: 1.6 },
  { x: 66, y: 32, tone: 'red', agent: 'nova', size: 1.4 },
  { x: 62, y: 40, tone: 'teal', agent: 'aria', size: 1.5 },
  // Asia / Oceania
  { x: 74, y: 11, tone: 'teal', agent: 'orion', size: 1.3 },
  { x: 88, y: 15, tone: 'orange', agent: 'axel', size: 1.7 },
  { x: 96, y: 20, tone: 'red', agent: 'nova', size: 1.4 },
  { x: 84, y: 23, tone: 'yellow', agent: 'kai', size: 1.2 },
  { x: 88, y: 28, tone: 'green', agent: 'luna', size: 1.6 },
  { x: 96, y: 33, tone: 'teal', agent: 'orion', size: 1.3 },
  { x: 102, y: 44, tone: 'orange', agent: 'zeno', size: 1.5 },
  { x: 110, y: 49, tone: 'teal', agent: 'aria', size: 1.2 },
]

export interface MapArc {
  from: number
  to: number
  tone: MapTone
  agent: AgentId
  /** How far the arc bows away from the straight line. */
  bow: number
}

export const ARCS: MapArc[] = [
  { from: 0, to: 9, tone: 'orange', agent: 'zeno', bow: 0.3 },
  { from: 1, to: 7, tone: 'orange', agent: 'zeno', bow: 0.26 },
  { from: 5, to: 12, tone: 'yellow', agent: 'kai', bow: 0.22 },
  { from: 12, to: 16, tone: 'teal', agent: 'orion', bow: 0.3 },
  { from: 14, to: 21, tone: 'teal', agent: 'aria', bow: 0.24 },
  { from: 9, to: 19, tone: 'green', agent: 'luna', bow: 0.28 },
  { from: 15, to: 8, tone: 'teal', agent: 'orion', bow: 0.34 },
  { from: 3, to: 6, tone: 'red', agent: 'nova', bow: 0.2 },
]

/** Quadratic arc bowing "upward" (toward the top of the map). */
export function arcPath(a: MapNode, b: MapNode, bow: number): string {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const distance = Math.hypot(dx, dy)
  // perpendicular offset, biased upward so arcs read like flight paths
  const nx = -dy / (distance || 1)
  const ny = dx / (distance || 1)
  const lift = distance * bow * (ny > 0 ? -1 : 1)
  return `M ${a.x} ${a.y} Q ${mx + nx * lift} ${my + ny * lift} ${b.x} ${b.y}`
}

function groupIndicesByAgent<T extends { agent: AgentId }>(items: T[]): Partial<Record<AgentId, number[]>> {
  const groups: Partial<Record<AgentId, number[]>> = {}
  items.forEach((item, i) => {
    ;(groups[item.agent] ??= []).push(i)
  })
  return groups
}

/** Which NODES/ARCS indices belong to each agent, so only one of them lights at a time. */
export const NODE_INDICES_BY_AGENT = groupIndicesByAgent(NODES)
export const ARC_INDICES_BY_AGENT = groupIndicesByAgent(ARCS)

/** Picks a stable-but-rotating index from a list, changing every `periodMs`. */
export function rotatingIndex(indices: number[] | undefined, periodMs: number, now: number): number | null {
  if (!indices || indices.length === 0) return null
  return indices[Math.floor(now / periodMs) % indices.length]
}
