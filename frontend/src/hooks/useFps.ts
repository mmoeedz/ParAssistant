import { useEffect, useRef, useState } from 'react'

/**
 * This interface's own render rate, measured with requestAnimationFrame.
 *
 * There is no such thing as a single Windows-wide "FPS" to read — that would
 * mean hooking a specific game or app's render pipeline (what tools like
 * RTSS/Special K do via code injection), which this agent does not do and
 * has no business doing for an arbitrary process. What is real and honestly
 * measurable from here is how smoothly this dashboard itself is drawing, so
 * that is what this reports — labelled as such in the UI, not as "system FPS".
 *
 * If the tab is backgrounded, browsers throttle rAF and the number will drop
 * or stop updating. That is correct: an unrendered tab has no frame rate.
 */
export function useFps(sampleWindowMs = 1000): number | null {
  const [fps, setFps] = useState<number | null>(null)
  const frames = useRef(0)
  const windowStart = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    let cancelled = false

    const tick = (now: number) => {
      if (cancelled) return
      if (windowStart.current === 0) windowStart.current = now
      frames.current += 1
      const elapsed = now - windowStart.current
      if (elapsed >= sampleWindowMs) {
        setFps(Math.round((frames.current * 1000) / elapsed))
        frames.current = 0
        windowStart.current = now
      }
      raf.current = requestAnimationFrame(tick)
    }

    // A window that straddles a hidden→visible transition would otherwise
    // divide a couple of real frames by however long the tab sat backgrounded,
    // reporting a falsely low number for one tick right after tabbing back in.
    // Starting a fresh window on resume keeps every reported number honest
    // about the time it actually covers.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      frames.current = 0
      windowStart.current = 0
    }
    document.addEventListener('visibilitychange', onVisible)

    raf.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sampleWindowMs])

  return fps
}
