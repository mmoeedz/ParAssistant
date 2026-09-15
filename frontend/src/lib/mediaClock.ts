import type { NowPlaying } from '@/types/protocol'

/**
 * The player's own clock, projected to now.
 *
 * The music is not playing in this page — it is Spotify (or anything else)
 * running on Windows — so there is no `audio.currentTime` to read. The nearest
 * thing to it is what Windows publishes: a position that was true at a known
 * instant, advancing at the player's rate. Projecting that forward is reading
 * the real clock, not counting a fake one: nothing accumulates, so a stalled
 * tab, a busy CPU or a sleep resumes exactly where the player actually is.
 */

/** Past this long without the player publishing, stop projecting and hold. */
export const RUN_ON_MS = 10_000

/**
 * `anchor` is the performance.now() instant at which `media.position` was true.
 */
export function projectPosition(
  media: Pick<NowPlaying, 'position' | 'duration' | 'rate'>,
  anchor: number,
  now: number,
): number {
  const rate = media.rate > 0 ? media.rate : 1
  const run = Math.min(Math.max(now - anchor, 0), RUN_ON_MS)
  return Math.min(media.position + (run / 1000) * rate, media.duration)
}
