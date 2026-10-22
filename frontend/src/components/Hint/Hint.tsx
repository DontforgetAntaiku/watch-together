import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './Hint.css'

const MARGIN = 8

/**
 * A small "i" that explains something in a bubble: on hover and keyboard focus, or on tap where there is no hover.
 * The bubble is fixed to the screen and placed so that it never leaves it (an "i" near the right edge used to push
 * the bubble off the page, which made a phone zoom out and shift the whole layout).
 */
export function Hint({ text }: { text: string }) {
  const { t } = useTranslation()
  const [pinned, setPinned] = useState(false) // opened by a tap or the keyboard
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLSpanElement>(null)
  const id = useId()
  const open = pinned || hovered

  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- forget the old place, so the next opening is measured afresh
      setPos(null)
      return
    }
    if (!button.current || !tip.current) return
    const anchor = button.current.getBoundingClientRect()
    const box = tip.current.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const left = Math.max(MARGIN, Math.min(anchor.left, vw - box.width - MARGIN))
    // Below the "i", or above it when there is no room underneath.
    const below = anchor.bottom + MARGIN
    const top = below + box.height + MARGIN > vh ? Math.max(MARGIN, anchor.top - box.height - MARGIN) : below
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measuring the real size is the only way to place it
    setPos({ top, left })
  }, [open, text])

  return (
    <span className="hint" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        ref={button}
        type="button"
        className="hint__btn"
        aria-label={t('hint.more')}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHovered(false)}
        onBlur={() => {
          setPinned(false)
          setPos(null)
        }}
        onKeyDown={(e) => e.key === 'Escape' && setPinned(false)}
      >
        i
      </button>
      <span
        ref={tip}
        role="tooltip"
        id={id}
        className="hint__tip"
        data-open={open}
        style={open ? { top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' } : undefined}
      >
        {text}
      </span>
    </span>
  )
}
