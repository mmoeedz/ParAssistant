import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A draggable vertical split between two stacked panels: the returned
 * `size` is the height (px) of the panel above the handle, and the panel
 * below fills the rest via `flex: 1` — this only ever controls the top
 * panel's height. Persisted per `storageKey` so it survives reloads, and
 * differs sensibly across monitors since each is clamped to its own
 * container's actual height rather than reused as an absolute value.
 *
 * Tracks the drag on `window` rather than the handle element itself: pointer
 * capture on the handle should cover this too, but shrinking a panel means
 * dragging up and off the (now smaller) handle almost immediately, and a
 * child element (the grip icon) intercepting the pointer has been enough to
 * lose capture in practice. Listening on window sidesteps that entirely.
 */
export function useVerticalSplit(storageKey: string, defaultSize: number, min: number, minBelow: number) {
  const [size, setSize] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      const parsed = raw ? Number(raw) : NaN
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSize
    } catch {
      return defaultSize
    }
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback(
    (value: number) => {
      const total = containerRef.current?.getBoundingClientRect().height ?? Infinity
      const max = Math.max(min, total - minBelow)
      return Math.min(Math.max(value, min), max)
    },
    [min, minBelow],
  )

  // Re-clamp on mount and whenever the clamp bounds themselves change, so a
  // size chosen on one monitor never leaves the lower panel with negative
  // space on another.
  useEffect(() => {
    setSize((s) => clamp(s))
  }, [clamp])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  // The actual drag lives here, not in per-element handlers: subscribed only
  // while dragging, and always reading the current clamp/container via the
  // closure created fresh each time this effect (re)runs.
  useEffect(() => {
    if (!dragging) return

    const onMove = (e: PointerEvent) => {
      if (!containerRef.current) return
      const top = containerRef.current.getBoundingClientRect().top
      setSize(clamp(e.clientY - top))
    }
    const onUp = () => setDragging(false)

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, clamp])

  // Persist once the drag actually ends (dragging flips back to false),
  // rather than inside the listener teardown above — that also runs on
  // every intermediate re-subscribe, not just the final release.
  const wasDragging = useRef(false)
  useEffect(() => {
    if (wasDragging.current && !dragging) {
      try {
        localStorage.setItem(storageKey, String(sizeRef.current))
      } catch {
        // best effort — a lost preference is not worth surfacing
      }
    }
    wasDragging.current = dragging
  }, [dragging, storageKey])

  return {
    size,
    containerRef,
    dragging,
    handleProps: { onPointerDown },
  }
}
