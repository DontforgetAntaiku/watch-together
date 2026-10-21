import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstall } from '../../lib/pwa'
import './InstallButton.css'

/** "Install app": the browser's own dialog where there is one, a short how-to on iPhone and iPad. */
export function InstallButton() {
  const { t } = useTranslation()
  const { mode, install } = useInstall()
  const [hint, setHint] = useState(false)
  if (!mode) return null
  return (
    <div className="install">
      <button type="button" className="btn install__btn" onClick={() => (mode === 'native' ? void install() : setHint((v) => !v))}>
        {t('pwa.install')}
      </button>
      {hint && (
        <p className="install__hint" role="status">
          {t('pwa.iosHint')}
        </p>
      )}
    </div>
  )
}
