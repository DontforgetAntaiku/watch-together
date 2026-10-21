import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CODE_ALPHABET, CODE_LENGTH } from './lib/api'
import { go, usePath } from './lib/router'
import { Footer } from './components/Footer/Footer'
import { Home } from './components/Home/Home'
import { Room } from './components/Room/Room'

function roomCode(path: string): string | null {
  const m = path.match(/^\/r\/([A-Za-z0-9]+)\/?$/)
  if (!m) return null
  const code = m[1].toUpperCase()
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null
}

export default function App() {
  const { t, i18n } = useTranslation()
  const path = usePath()
  const code = roomCode(path)

  useEffect(() => {
    if (path !== '/' && !code) go('/', true)
    else if (code && path !== `/r/${code}`) go(`/r/${code}`, true)
    document.title = code ? `${t('code.room')} ${code} · ${t('brand')}` : t('brand')
  }, [path, code, t, i18n.language])

  return (
    <>
      {code ? <Room key={code} code={code} /> : <Home />}
      <Footer />
    </>
  )
}
