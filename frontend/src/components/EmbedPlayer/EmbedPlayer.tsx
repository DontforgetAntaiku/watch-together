import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState } from '../../lib/api'
import { VimeoAdapter, YouTubeAdapter } from '../../lib/adapters'
import type { ServerClock } from '../../lib/clock'
import type { MediaAdapter } from '../../lib/engine'
import { useEngine } from '../../lib/useEngine'
import './EmbedPlayer.css'

type Props = {
  embed: { kind: 'yt'; id: string } | { kind: 'vimeo'; id: string; hash: string | null }
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
}

type Embedded = (YouTubeAdapter | VimeoAdapter) & MediaAdapter

/** YouTube or Vimeo through the site's own embedded player; our engine keeps it on the room's playhead. */
export function EmbedPlayer({ embed, state, clock, myId, send }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [adapter, setAdapter] = useState<Embedded | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { engine, blocked, drift, setBlocked } = useEngine(adapter, state, clock, myId, send)
  const key = embed.kind === 'yt' ? `yt:${embed.id}` : `vimeo:${embed.id}:${embed.hash ?? ''}`

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let made: Embedded | null = null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting for the new video
    setReady(false)
    setError(null)
    setAdapter(null)
    // Every run gets its own slot, so a run that was cancelled while loading cannot wipe the next one's player.
    const slot = document.createElement('div')
    el.replaceChildren(slot)
    const onReady = () => !cancelled && setReady(true)
    const onError = (m: string) => !cancelled && setError(m)
    const create =
      embed.kind === 'yt'
        ? YouTubeAdapter.create(slot, embed.id, onReady, onError)
        : VimeoAdapter.create(slot, embed.id, embed.hash, onReady, onError)
    create.then(
      (a) => {
        if (cancelled) a.destroy()
        else {
          made = a as Embedded
          setAdapter(made)
        }
      },
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : t('errors.mediaGeneric')),
    )
    return () => {
      cancelled = true
      made?.destroy()
      slot.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures every field of `embed`
  }, [key])

  useEffect(() => {
    if (!adapter || !engine) return
    adapter.onPlay = () => engine.handlePlay()
    adapter.onPause = () => engine.handlePause()
    adapter.onSeeked = () => engine.handleSeeked()
  }, [adapter, engine])

  // The embedded player cannot tell us that autoplay was refused, so look at it.
  useEffect(() => {
    if (!adapter || !engine || !ready) return
    const timer = window.setInterval(() => {
      const wants = !!engine.state?.playing
      if (wants && adapter.paused() && !adapter.ended()) setBlocked(true)
      else if (!wants || !adapter.paused()) setBlocked(false)
    }, 1800)
    return () => window.clearInterval(timer)
  }, [adapter, engine, ready, setBlocked])

  useEffect(() => {
    if (ready) engine?.apply(true)
  }, [ready, engine])

  return (
    <div className="embed">
      <div ref={host} className="embed__host" />
      {!ready && !error && <div className="embed__loading">{t('player.loading')}</div>}
      {blocked && !error && (
        <button type="button" className="embed__overlay" onClick={() => (setBlocked(false), engine?.apply(true))}>
          <span className="embed__btn">{t('player.join')}</span>
          <span>{t('player.joinHint')}</span>
        </button>
      )}
      {error && (
        <div className="embed__error" role="alert">
          {error}
        </div>
      )}
      {!error && drift !== null && Math.abs(drift) >= 0.6 && (
        <p className="embed__sync">{t('player.catching', { value: `${drift > 0 ? '+' : ''}${drift.toFixed(1)}` })}</p>
      )}
    </div>
  )
}
