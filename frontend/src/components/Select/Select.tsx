import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import './Select.css'

export type Option = { value: string; label: string }

type Props = {
  id?: string
  /** The accessible name (there is no visible label next to it). */
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
}

const GAP = 6
const EDGE = 8

/** A dropdown whose list is our own (never the browser's native `<select>` popup), with the usual keyboard support. */
export function Select({ id, label, value, options, onChange, disabled }: Props) {
  const uid = useId()
  const listId = `${uid}-list`
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const selected = Math.max(0, options.findIndex((o) => o.value === value))

  // Fixed to the screen, so no `overflow: hidden` parent clips it; opens upward when there is more room above.
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    const vh = document.documentElement.clientHeight
    const vw = document.documentElement.clientWidth
    const below = vh - r.bottom - GAP - EDGE
    const above = r.top - GAP - EDGE
    const wanted = Math.min(options.length * 44 + 8, 288)
    const up = below < Math.min(wanted, 160) && above > below
    const maxHeight = Math.max(120, Math.min(wanted, up ? above : below))
    const width = Math.min(Math.max(r.width, 180), vw - EDGE * 2)
    setPlace({ top: up ? r.top - GAP - maxHeight : r.bottom + GAP, left: Math.min(Math.max(EDGE, r.left), vw - width - EDGE), width, maxHeight })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active, place])

  const show = () => {
    if (disabled) return
    setActive(selected)
    setPlace(null)
    setOpen(true)
  }
  const choose = (index: number) => {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
    button.current?.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    const last = options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // type-ahead: letters typed in quick succession narrow the match
          const now = Date.now()
          typed.current = { text: (now - typed.current.at > 700 ? '' : typed.current.text) + e.key.toLowerCase(), at: now }
          const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
          if (hit >= 0) setActive(hit)
        }
    }
  }

  return (
    <div className="select" ref={root}>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        className="select__button field"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${uid}-o${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span className="select__value">{options[selected]?.label ?? ''}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true" className="select__caret">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          className="select__list"
          style={place ? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight } : { visibility: 'hidden' }}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${uid}-o${i}`}
              role="option"
              aria-selected={i === selected}
              data-active={i === active || undefined}
              className="select__option"
              onPointerMove={() => i !== active && setActive(i)}
              onClick={() => choose(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
