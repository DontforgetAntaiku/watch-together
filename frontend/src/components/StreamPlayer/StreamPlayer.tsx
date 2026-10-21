import { useEffect, useState } from 'react'
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new connection attempt starts from scratch
    setStatus('connecting')
    setStream(null)
    const stop = watchShare(sharer, send, onSignal, setStream, (s) => {
      setStatus(s)
      if (s === 'ended') onEnded()
    })
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect only for a new sharer or on retry
  }, [sharer, attempt])

  const notice =
    status === 'connecting' ? t('player.connecting') : null

  return (
    <>
      <VideoPlayer
        mode="stream"
        stream={stream}
        live={live}
        streamDuration={dur}
        notice={notice}
        state={state}
        clock={clock}
        myId={myId}
        send={send}
      />
      {status === 'failed' && (
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
