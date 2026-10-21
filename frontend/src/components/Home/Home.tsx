import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent } from 'react'
import { createRoom, errorText, parseCode, roomInfo } from '../../lib/api'
import { go } from '../../lib/router'
import { InstallButton } from '../InstallButton/InstallButton'
import { Header } from '../Header/Header'
import { HeroArt } from '../HeroArt/HeroArt'
import './Home.css'

export function Home() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState('')

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const { code } = await createRoom()
      go(`/r/${code}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const join = async (e: FormEvent) => {
    e.preventDefault()
    const code = parseCode(value)
    if (!code) {
      setError(t('home.badCode'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await roomInfo(code)
      go(`/r/${code}`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="home">
      <Header tools={<InstallButton />} />
      <main className="home__main">
        <section className="home__hero">
          <div className="home__copy">
          <p className="home__kicker">{t('home.kicker')}</p>
          <h1 className="home__title">{t('home.titleA')}<span className="home__accent">{t('home.titleB')}</span></h1>
          <p className="home__lead">{t('home.lead')}</p>
          <div className="home__actions">
            <button type="button" className="btn btn--primary home__create" onClick={create} disabled={busy}>
              {busy ? t('home.working') : t('home.create')}
            </button>
            <form className="home__join" onSubmit={join}>
              <label className="sr-only" htmlFor="room-code">
                {t('home.codeLabel')}
              </label>
              <input
                id="room-code"
                className="field home__code"
                placeholder={t('home.codePlaceholder')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <button type="submit" className="btn" disabled={busy || !value.trim()}>
                {t('home.join')}
              </button>
            </form>
          </div>
          <ul className="home__chips">
            {['sync', 'sources', 'free'].map((k) => (
              <li key={k} className="home__chip">
                {t(`home.chip.${k}`)}
              </li>
            ))}
          </ul>
          {error && (
            <p className="home__error" role="alert">
              {error}
            </p>
          )}
          </div>
          <div className="home__art">
            <HeroArt />
          </div>
        </section>

        <ol className="home__steps">
          {[1, 2, 3].map((n) => (
            <li key={n} className="home__step">
              <span className="home__num">{n}</span>
              <h2>{t(`home.step${n}Title`)}</h2>
              <p>{t(`home.step${n}Text`)}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}
