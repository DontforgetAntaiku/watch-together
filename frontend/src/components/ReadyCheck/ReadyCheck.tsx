import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState } from '../../lib/api'
import type { ServerClock } from '../../lib/clock'
import { beep } from '../../lib/beep'
import './ReadyCheck.css'

type Props = {
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
}

/** Over the player: "who is ready?" while a ready check runs, then a 3-2-1 before everybody starts together. */
export function ReadyCheck({ state, clock, myId, send }: Props) {
  const { t } = useTranslation()
  const check = state?.check ?? null
  const go = state?.go ?? null
  const [left, setLeft] = useState(0)

  // Count down on this device's clock against the server's start time.
  useEffect(() => {
    if (go === null) return
    const update = () => setLeft(Math.max(0, Math.ceil((go - clock.serverNow()) / 1000)))
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [go, clock])

  // Somebody else asks: a short cue, in case this page is in the background.
  const askedBy = useRef<string | null>(null)
  useEffect(() => {
    const by = check?.by ?? null
    if (by && by !== askedBy.current && by !== myId()) beep('ask')
    askedBy.current = by
  }, [check?.by, myId])

  if (go !== null) {
    return (
      <div className="ready" role="status" aria-live="assertive">
        <div className="ready__card ready__card--count">
          <p className="ready__small">{t('ready.starting')}</p>
          <p className="ready__count" key={left}>
            {left > 0 ? left : t('ready.go')}
          </p>
          <button type="button" className="btn ready__btn" onClick={() => send({ t: 'ready_cancel' })}>
            {t('ready.cancel')}
          </button>
        </div>
      </div>
    )
  }
  if (!check || !state) return null
  const me = myId()
  const mine = check.ready.includes(me)
  return (
    <div className="ready" role="status">
      <div className="ready__card">
        <p className="ready__title">{t('ready.title')}</p>
        <p className="ready__small">{t('ready.count', { ready: check.ready.length, total: Math.max(state.n, check.ready.length) })}</p>
        <div className="ready__actions">
          {!mine && (
            <button type="button" className="btn btn--primary ready__btn" onClick={() => send({ t: 'ready_yes' })}>
              {t('ready.yes')}
            </button>
          )}
          <button type="button" className="btn ready__btn" onClick={() => send({ t: 'ready_cancel' })}>
            {t('ready.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
