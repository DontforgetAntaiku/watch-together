import { useState } from 'react'
import type { FormEvent } from 'react'
import { createRoom, errorText, parseCode, roomInfo } from '../../lib/api'
import { go } from '../../lib/router'
import { Logo } from '../Logo/Logo'
import './Home.css'

const STEPS = [
  ['Make a room', 'One click gives you a short code. Send the code, or the invite link, to your friends.'],
  ['Open your video', 'Paste a link or open a file from your disk. Everyone picks their own, in the quality they like.'],
  ['Press play', 'Play, pause and seek are shared. The video itself never touches our server.'],
] as const

export function Home() {
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
      setError('A room code has 6 letters and digits, like K7M2QX.')
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
      <header className="home__bar">
        <Logo />
      </header>
      <main className="home__main">
        <section className="home__hero">
          <p className="home__kicker">No accounts. No installs.</p>
          <h1 className="home__title">Press play, <span className="home__accent">together.</span></h1>
          <p className="home__lead">
            Watch one video at the same moment with friends far away. Everyone's browser plays it by itself, so nothing
            is streamed through us and each of you chooses your own quality.
          </p>
          <div className="home__actions">
            <button type="button" className="btn btn--primary home__create" onClick={create} disabled={busy}>
              {busy ? 'Working…' : 'Create a room'}
            </button>
            <form className="home__join" onSubmit={join}>
              <label className="sr-only" htmlFor="room-code">
                Room code or invite link
              </label>
              <input
                id="room-code"
                className="field home__code"
                placeholder="Have a code?"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <button type="submit" className="btn" disabled={busy || !value.trim()}>
                Join
              </button>
            </form>
          </div>
          {error && (
            <p className="home__error" role="alert">
              {error}
            </p>
          )}
        </section>

        <ol className="home__steps">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="home__step">
              <span className="home__num">{i + 1}</span>
              <h2>{title}</h2>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}
