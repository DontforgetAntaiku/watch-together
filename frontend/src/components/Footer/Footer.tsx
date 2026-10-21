import { useTranslation } from 'react-i18next'

export function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="mt-auto border-t border-line px-4 pt-6 text-center text-sm text-muted"
      style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
      <p className="m-0">
        {t('footer.credit')}{' '}
        <a className="inline-block py-2 font-semibold text-accent-text underline underline-offset-2" href="https://dontforgetantaiku.dev/" target="_blank" rel="noopener">
          DontforgetAntaiku
        </a>
      </p>
    </footer>
  )
}
