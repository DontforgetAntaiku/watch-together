import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../../i18n'
import './LangSwitch.css'

export function LangSwitch() {
  const { t, i18n } = useTranslation()
  const current = i18n.language.startsWith('ru') ? 'ru' : 'en'
  return (
    <div className="lang" role="group" aria-label={t('lang.label')}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className="lang__btn"
          lang={l.code}
          aria-pressed={current === l.code}
          title={l.name}
          onClick={() => void i18n.changeLanguage(l.code)}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}
