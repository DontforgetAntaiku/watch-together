import { useEffect } from 'react'
import type { RefObject } from 'react'

/** The screens where the bottom tab bar is shown (the same query the layout uses). */
export const PHONE_PORTRAIT = '(max-width: 999px) and (orientation: portrait)'

const MIN_DISTANCE = 60 // px: shorter is a tap or a shaky finger
const MAX_MS = 700
const LEAVE_ALONE = 'input, textarea, select, [contenteditable], [role="slider"], [data-noswipe]'

/**
 * A quick sideways flick inside `ref`: `onSwipe(1)` for a move to the left (next), `-1` for a move to the right (previous).
 * It never fires for a mostly vertical move (scrolling), a slow drag, a second finger, or a start on a field or a slider.
 * `skip` names areas (the video player) that keep their own touch behaviour.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (dir: 1 | -1) => void, skip?: string) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let start: { x: number; y: number; at: number } | null = null
    const down = (e: TouchEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const ok = e.touches.length === 1 && !!target && !target.closest(LEAVE_ALONE) && !(skip && target.closest(skip)) && window.matchMedia(PHONE_PORTRAIT).matches
      start = ok ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() } : null
    }
    const up = (e: TouchEvent) => {
      const s = start
      start = null
      if (!s || e.changedTouches.length !== 1) return
      const dx = e.changedTouches[0].clientX - s.x
      const dy = e.changedTouches[0].clientY - s.y
      if (Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) > 1.6 * Math.abs(dy) && Date.now() - s.at <= MAX_MS) onSwipe(dx < 0 ? 1 : -1)
    }
    const cancel = () => {
      start = null
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchend', up, { passive: true })
    el.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', up)
      el.removeEventListener('touchcancel', cancel)
    }
  }, [ref, onSwipe, skip])
}
