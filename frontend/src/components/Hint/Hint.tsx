import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './Hint.css'

/** A small "i" that explains something in a bubble: on hover and keyboard focus, or on tap where there is no hover. */
export function Hint({ text }: { text: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="hint" data-open={open}>
      <button
        type="button"
        className="hint__btn"
        aria-label={t('hint.more')}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        i
      </button>
      <span role="tooltip" id={id} className="hint__tip">
        {text}
      </span>
    </span>
  )
}
