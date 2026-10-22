import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, currentLanguage } from '../../i18n'
import './LangSwitch.css'

/** A small menu of the interface languages: the button shows the current one, the list names each in its own language. */
export function LangSwitch() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = currentLanguage(i18n.language)
  const active = LANGUAGES.find((l) => l.code === current) ?? LANGUAGES[0]

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="lang" role="group" aria-label={t('lang.label')} ref={box}>
      <button type="button" className="lang__btn lang__current" aria-expanded={open} aria-haspopup="true" title={active.name} onClick={() => setOpen((v) => !v)}>
        {active.short}
        <svg viewBox="0 0 12 12" aria-hidden="true" className="lang__caret">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="lang__menu">
          {LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                className="lang__item"
                lang={l.code}
                aria-pressed={current === l.code}
                onClick={() => {
                  void i18n.changeLanguage(l.code)
                  setOpen(false)
                }}
              >
                {l.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
