import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateReady } from '../../lib/pwa'
import './UpdateToast.css'

/** Offers a reload when a new version has taken over. It never reloads by itself: that would cut a video in the middle. */
export function UpdateToast() {
  const { t } = useTranslation()
  const ready = useUpdateReady()
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div className="update" role="status">
      <span>{t('pwa.update')}</span>
      <button type="button" className="btn btn--primary update__btn" onClick={() => window.location.reload()}>
        {t('pwa.reload')}
      </button>
      <button type="button" className="btn update__btn" onClick={() => setDismissed(true)}>
        {t('pwa.later')}
      </button>
    </div>
  )
}
