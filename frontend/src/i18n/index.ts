import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import pl from './locales/pl.json'
import pt from './locales/pt.json'
import ru from './locales/ru.json'
import uk from './locales/uk.json'

/** Each name is written in its own language, so a person can find theirs whatever the page says now. */
export const LANGUAGES = [
  { code: 'en', name: 'English', short: 'EN' },
  { code: 'ru', name: 'Русский', short: 'RU' },
  { code: 'uk', name: 'Українська', short: 'UK' },
  { code: 'de', name: 'Deutsch', short: 'DE' },
  { code: 'es', name: 'Español', short: 'ES' },
  { code: 'fr', name: 'Français', short: 'FR' },
  { code: 'pt', name: 'Português', short: 'PT' },
  { code: 'pl', name: 'Polski', short: 'PL' },
] as const

const CODES: string[] = LANGUAGES.map((l) => l.code)

/** The supported language for whatever the browser reports ("de-AT" -> "de"); English when it is not one of ours. */
export function currentLanguage(lng: string | undefined): string {
  const base = (lng ?? 'en').toLowerCase().split('-')[0]
  return CODES.includes(base) ? base : 'en'
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru }, uk: { translation: uk }, de: { translation: de }, es: { translation: es }, fr: { translation: fr }, pt: { translation: pt }, pl: { translation: pl } },
    fallbackLng: 'en',
    supportedLngs: CODES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'wt-lang', caches: ['localStorage'] },
  })

function sync(lng: string) {
  document.documentElement.lang = currentLanguage(lng)
  document.title = i18n.t('brand')
}
i18n.on('languageChanged', sync)
sync(i18n.language || 'en')

export default i18n
