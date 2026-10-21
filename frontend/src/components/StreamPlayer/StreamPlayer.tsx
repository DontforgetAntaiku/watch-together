import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState, Signal } from '../../lib/api'
import type { ServerClock } from '../../lib/clock'
import { watchShare } from '../../lib/p2p'
import type { ViewerState } from '../../lib/p2p'
import { VideoPlayer } from '../VideoPlayer/VideoPlayer'

type Props = {
  sharer: string
  dur: number | null
  live: boolean
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
  onSignal: (fn: (s: Signal) => void) => () => void
  onEnded: () => void
}

/** Watches a file or tab that someone else shares. Controls still drive the room; the stream follows the sharer. */
export function StreamPlayer({ sharer, dur, live, state, clock, myId, send, onSignal, onEnded }: Props) {
  const { t } = useTranslation()
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<ViewerState>('connecting')
  const [attempt, setAttempt] = useState(0)
  const [quality, setQuality] = useState('auto')
  const qualityRef = useRef(quality)
  const viewer = useRef<ReturnType<typeof watchShare> | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new connection attempt starts from scratch
    setStatus('connecting')
    setStream(null)
    const handle = watchShare(sharer, send, onSignal, setStream, (s) => {
      setStatus(s)
      if (s === 'ended') onEnded()
    })
    handle.setQuality(qualityRef.current)
    viewer.current = handle
    return () => {
      viewer.current = null
      handle.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect only for a new sharer or on retry
  }, [sharer, attempt])

  // A failed direct connection is often a hiccup: try again by itself twice before asking.
  useEffect(() => {
    if (status !== 'failed' || attempt >= 2) return
    const timer = window.setTimeout(() => setAttempt((n) => n + 1), 2500)
    return () => window.clearTimeout(timer)
  }, [status, attempt])

  const options = [
    { value: 'auto', label: t('player.qualityAuto') },
    ...[1080, 720, 480, 360].map((h) => ({ value: String(h), label: `${h}p` })),
  ]

  const notice =
    status === 'connecting' ? t('player.connecting') : null

  return (
    <>
      <VideoPlayer
        mode="stream"
        stream={stream}
        live={live}
        streamDuration={dur}
        streamQuality={{
          value: quality,
          options,
          onChange: (v) => {
            qualityRef.current = v
            setQuality(v)
            viewer.current?.setQuality(v)
          },
        }}
        notice={notice}
        state={state}
        clock={clock}
        myId={myId}
        send={send}
      />
      {status === 'failed' && attempt >= 2 && (
        <div className="stream-failed" role="alert">
          <p>{t('player.failed')}</p>
          <button type="button" className="btn btn--primary" onClick={() => setAttempt((n) => n + 1)}>
            {t('player.retry')}
          </button>
        </div>
      )}
    </>
  )
}
