/**
 * The world map behind GLOBAL ACTIVITY.
 *
 * Continents are approximated with a handful of ellipses and rasterised onto a
 * grid, which reads as a world at this size without shipping a geographic
 * dataset.
 *
 * The coloured nodes and arcs on top are tied to agents: a node lights and its
 * arcs animate while that agent is actually running a tool. Positions are
 * arbitrary — no city is being claimed — but the lighting is real state.
 */

import type { AgentId } from '@/types/agents'

interface Blob {
  cx: number
  cy: number
  rx: number
  ry: number
  rot?: number
}

// Coordinate space: 120 wide (180W..180E) by 62 tall (85N..60S).
const LAND: Blob[] = [
  { cx: 22, cy: 12, rx: 13, ry: 6 }, // Canada / Alaska
  { cx: 30, cy: 8, rx: 6, ry: 3 }, // arctic islands
  { cx: 41, cy: 10, rx: 4, ry: 5 }, // Greenland
  { cx: 24, cy: 20, rx: 8, ry: 5 }, // United States
  { cx: 28, cy: 27, rx: 4, ry: 3 }, // Central America
  { cx: 38, cy: 38, rx: 5.5, ry: 11, rot: -12 }, // South America
  { cx: 60, cy: 14, rx: 8, ry: 4 }, // Europe
  { cx: 62, cy: 27, rx: 9, ry: 10 }, // Africa (north)
  { cx: 63, cy: 38, rx: 6, ry: 7 }, // Africa (south)
  { cx: 82, cy: 14, rx: 18, ry: 7 }, // Russia / north Asia
  { cx: 76, cy: 22, rx: 8, ry: 5 }, // middle east / central Asia
  { cx: 86, cy: 26, rx: 6, ry: 5 }, // India / China
  { cx: 95, cy: 31, rx: 5, ry: 4 }, // SE Asia
  { cx: 99, cy: 36, rx: 4, ry: 2.5 }, // Indonesia
  { cx: 103, cy: 44, rx: 7, ry: 5 }, // Australia
  { cx: 112, cy: 50, rx: 2, ry: 2 }, // New Zealand
]

function inside(x: number, y: number, blob: Blob): boolean {
  let dx = x - blob.cx
  let dy = y - blob.cy
  if (blob.rot) {
    const a = (blob.rot * Math.PI) / 180
    const rx = dx * Math.cos(a) - dy * Math.sin(a)
    const ry = dx * Math.sin(a) + dy * Math.cos(a)
    dx = rx
    dy = ry
  }
  return (dx * dx) / (blob.rx * blob.rx) + (dy * dy) / (blob.ry * blob.ry) <= 1
}

let cache: [number, number][] | null = null

export function worldDots(step = 1.5): [number, number][] {
  if (cache) return cache
  const dots: [number, number][] = []
  for (let y = 4; y < 58; y += step) {
    for (let x = 2; x < 118; x += step) {
      if (LAND.some((blob) => inside(x, y, blob))) dots.push([x, y])
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
