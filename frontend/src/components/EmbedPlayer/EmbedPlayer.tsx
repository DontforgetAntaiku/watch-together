import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState } from '../../lib/api'
import type { ServerClock } from '../../lib/clock'
import { isSynced } from '../../lib/embed'
import type { Embed } from '../../lib/embed'
import { createEmbedAdapter } from '../../lib/embedAdapters'
import type { EmbedAdapter } from '../../lib/embedAdapters'
import { useEngine } from '../../lib/useEngine'
import './EmbedPlayer.css'

type Props = {
  embed: Embed
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
}

/** Where a live stream or a clip is shown: no controllable playhead, so just the official page. */
function unsyncedSrc(embed: Embed): string | null {
  if (embed.provider !== 'twitch') return null
  const parent = encodeURIComponent(window.location.hostname)
  const id = encodeURIComponent(embed.id)
  if (embed.type === 'channel') return `https://player.twitch.tv/?channel=${id}&parent=${parent}&muted=false`
  if (embed.type === 'clip') return `https://clips.twitch.tv/embed?clip=${id}&parent=${parent}&autoplay=false`
  return null
}

/** An embedded platform player; our engine keeps it on the room's playhead when it has one. */
export function EmbedPlayer(props: Props) {
  return isSynced(props.embed) ? <SyncedEmbed {...props} /> : <PlainEmbed embed={props.embed} />
}

function PlainEmbed({ embed }: { embed: Embed }) {
  const { t } = useTranslation()
  return (
    <div className="embed">
      <iframe
        className="embed__host"
        title={embed.id}
        src={unsyncedSrc(embed) ?? undefined}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
      />
      <p className="embed__note">{t('player.notSynced')}</p>
    </div>
  )
}

function SyncedEmbed({ embed, state, clock, myId, send }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [adapter, setAdapter] = useState<EmbedAdapter | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { engine, blocked, drift, setBlocked } = useEngine(adapter, state, clock, myId, send)
  const key = JSON.stringify(embed)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let made: EmbedAdapter | null = null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting for the new video
    setReady(false)
    setError(null)
    setAdapter(null)
    // Every run gets its own slot, so a run that was cancelled while loading cannot wipe the next one's player.
    const slot = document.createElement('div')
    el.replaceChildren(slot)
    createEmbedAdapter(
      slot,
      embed,
      () => !cancelled && setReady(true),
      (m) => !cancelled && setError(m),
    ).then(
      (a) => {
        if (cancelled) a.destroy()
        else {
          made = a
          setAdapter(a)
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
