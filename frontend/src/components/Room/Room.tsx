import { useCallback, useEffect, useRef, useState } from 'react'
import { go } from '../../lib/router'
import { hostLabel } from '../../lib/source'
import type { Source } from '../../lib/source'
import { useRoom } from '../../lib/useRoom'
import { Logo } from '../Logo/Logo'
import { Player } from '../Player/Player'
import { RoomCode } from '../RoomCode/RoomCode'
import { SourcePanel } from '../SourcePanel/SourcePanel'
import './Room.css'

export function Room({ code }: { code: string }) {
  const { connection, state, problem, send, myId, clock } = useRoom(code)
  const [source, setSource] = useState<Source | null>(null)
  const [offered, setOffered] = useState(false)
  const objectUrl = useRef<string | null>(null)

  const replaceSource = useCallback((next: Source | null) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = next?.kind === 'file' ? next.url : null
    setSource(next)
  }, [])

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    },
    [],
  )

  const onUrl = (url: string, share: boolean) => {
    replaceSource({ kind: 'url', url, label: hostLabel(url) })
    if (share) {
      send({ t: 'source', url })
      setOffered(true)
    }
  }
  const onFile = (file: File) => {
    replaceSource({ kind: 'file', url: URL.createObjectURL(file), label: file.name })
  }

  if (connection === 'closed') {
    return (
      <div className="room__lost">
        <Logo />
        <h1>Can't open this room</h1>
        <p>{problem ?? 'Connecting…'}</p>
        <button type="button" className="btn btn--primary" onClick={() => go('/')}>
          Back to start
        </button>
      </div>
    )
  }

  const members = state?.n ?? 0
  return (
    <div className="room">
      <header className="room__bar">
        <Logo />
        <p className="room__status" data-state={connection} role="status">
          {connection === 'live' && `${members} ${members === 1 ? 'person' : 'people'} here`}
          {connection === 'connecting' && 'Connecting…'}
          {connection === 'reconnecting' && 'Connection lost. Reconnecting…'}
        </p>
      </header>

      <main className="room__main">
        <RoomCode code={code} />
        <div className="room__grid">
          <div className="room__stage">
            <Player source={source} state={state} clock={clock} myId={myId} send={send} />
          </div>
          <SourcePanel
            current={source}
            suggestion={state?.source ?? null}
            offered={offered}
            onUrl={onUrl}
            onFile={onFile}
            onStopSharing={() => {
              send({ t: 'source', url: null })
              setOffered(false)
            }}
            onUseSuggestion={(url) => replaceSource({ kind: 'url', url, label: hostLabel(url) })}
          />
        </div>
      </main>
    </div>
  )
}
