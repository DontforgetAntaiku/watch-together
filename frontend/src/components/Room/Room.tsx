import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomSource } from '../../lib/api'
import { parseEmbed } from '../../lib/embed'
import { Sharer, captureVideo, isFirefox } from '../../lib/p2p'
import type { Capture } from '../../lib/p2p'
import { go } from '../../lib/router'
import { fromOffer, hostLabel } from '../../lib/source'
import type { Source } from '../../lib/source'
import { useRoom } from '../../lib/useRoom'
import { LangSwitch } from '../LangSwitch/LangSwitch'
import { Logo } from '../Logo/Logo'
import { Player } from '../Player/Player'
import { RoomCode } from '../RoomCode/RoomCode'
import { SourcePanel } from '../SourcePanel/SourcePanel'
import './Room.css'

type Sharing = 'file' | 'screen' | null

export function Room({ code }: { code: string }) {
  const { t } = useTranslation()
  const { connection, state, problem, send, myId, clock, onSignal } = useRoom(code)
  const [source, setSource] = useState<Source | null>(null)
  const [sharing, setSharing] = useState<Sharing>(null)
  const [viewers, setViewers] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const objectUrl = useRef<string | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const screen = useRef<MediaStream | null>(null)
  const fileCapture = useRef<Promise<Capture> | null>(null)
  const sharingRef = useRef<Sharing>(null)
  const sharer = useRef<Sharer | null>(null)
  const sendRef = useRef(send)

  useEffect(() => {
    sendRef.current = send
  }, [send])

  const setShare = useCallback((mode: Sharing) => {
    sharingRef.current = mode
    setSharing(mode)
  }, [])

  const stopSharing = useCallback(
    (tellRoom = true) => {
      sharer.current?.closeAll()
      screen.current?.getTracks().forEach((t) => t.stop())
      screen.current = null
      void fileCapture.current?.then((c) => c.stop(), () => {})
      fileCapture.current = null
      if (sharingRef.current && tellRoom) sendRef.current({ t: 'source', kind: null })
      setShare(null)
      setViewers(0)
    },
    [setShare],
  )

  const replaceSource = useCallback(
    (next: Source | null) => {
      if (sharingRef.current) stopSharing()
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = next?.kind === 'file' ? next.url : null
      setNotice(null)
      setSource(next)
    },
    [stopSharing],
  )

  useEffect(
    () => () => {
      sharer.current?.closeAll()
      screen.current?.getTracks().forEach((t) => t.stop())
      void fileCapture.current?.then((c) => c.stop(), () => {})
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    },
    [],
  )

  const ensureSharer = useCallback(() => {
    if (!sharer.current) {
      sharer.current = new Sharer(
        async () => {
          if (sharingRef.current === 'screen' && screen.current) return screen.current
          if (sharingRef.current === 'file' && fileCapture.current) return (await fileCapture.current).stream
          throw new Error('nothing is being shared')
        },
        (msg) => sendRef.current(msg),
        setViewers,
      )
    }
    return sharer.current
  }, [])

  // Viewers ask the sharer for the stream through the room's signalling channel.
  useEffect(
    () =>
      onSignal((signal) => {
        if (signal.sig === 'offer' && signal.sdp) {
          if (sharingRef.current) void ensureSharer().handleOffer(signal.from, signal.sdp)
          else sendRef.current({ t: 'signal', to: signal.from, sig: 'bye' })
        } else if (signal.sig === 'quality' && signal.sdp) void sharer.current?.setQuality(signal.from, signal.sdp)
        else if (signal.sig === 'bye') sharer.current?.close(signal.from)
      }),
    [onSignal, ensureSharer],
  )

  // The room forgot our share (e.g. after a reconnect gave us a new identity): announce it again.
  useEffect(() => {
    if (!sharingRef.current || connection !== 'live' || !state) return
    const mine = state.source?.kind === 'p2p' && state.source.by === myId()
    if (mine) return
    if (sharingRef.current === 'screen') send({ t: 'source', kind: 'p2p', name: 'tab', live: true })
    else if (video.current) send({ t: 'source', kind: 'p2p', name: source?.label ?? 'A file', dur: video.current.duration || null })
  }, [connection, state, myId, send, source?.label])

  // The sharer left or stopped: stop waiting for a stream that will not come.
  useEffect(() => {
    if (source?.kind !== 'watch' || !state) return
    const still = state.source?.kind === 'p2p' && state.source.by === source.sharer
    if (!still) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the thing being watched no longer exists
      setSource(null)
      setNotice(t('room.shareEnded'))
    }
  }, [state, source, t])

  // One share at a time: when someone starts sharing, everyone (including a previous sharer) switches to it.
  const lastOffer = useRef('')
  useEffect(() => {
    const offered = state?.source
    if (!offered || offered.kind !== 'p2p') {
      if (!offered) lastOffer.current = ''
      return
    }
    if (offered.by === myId()) return
    const key = `${offered.by}:${offered.name}:${offered.live}`
    if (lastOffer.current === key) return
    lastOffer.current = key
    const wasSharing = !!sharingRef.current
    if (wasSharing) stopSharing(false)
    replaceSource(fromOffer(offered))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tell the person why their screen changed
    if (wasSharing) setNotice(t('room.takenOver'))
  }, [state?.source, myId, stopSharing, replaceSource, t])

  const onVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
  }, [])

  const onUrl = (url: string, offer: boolean) => {
    const embed = parseEmbed(url)
    if (embed?.kind === 'yt') {
      replaceSource({ kind: 'yt', id: embed.id, label: t('source.youtube') })
      if (offer) send({ t: 'source', kind: 'yt', id: embed.id })
    } else if (embed?.kind === 'vimeo') {
      replaceSource({ kind: 'vimeo', id: embed.id, hash: embed.hash, label: t('source.vimeo') })
      if (offer) send({ t: 'source', kind: 'vimeo', id: embed.id, hash: embed.hash })
    } else {
      replaceSource({ kind: 'link', url, label: hostLabel(url) })
      if (offer) send({ t: 'source', kind: 'link', url })
    }
  }

  const onFile = (file: File) => {
    replaceSource({ kind: 'file', url: URL.createObjectURL(file), label: file.name })
  }

  const onShareFile = async () => {
    const v = video.current
    if (source?.kind !== 'file' || !v) return
    setNotice(null)
    // Capture once for everybody, and find out now (not when the first friend connects) whether this browser can do it.
    const captured = captureVideo(v)
    fileCapture.current = captured
    try {
      await captured
    } catch (err) {
      fileCapture.current = null
      setNotice(err instanceof Error ? err.message : t('errors.noCapture'))
      return
    }
    ensureSharer()
    setShare('file')
    send({ t: 'source', kind: 'p2p', name: source.label.slice(0, 120), dur: Number.isFinite(v.duration) ? v.duration : null })
    setNotice(null)
  }

  const onShareScreen = async () => {
    setNotice(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
    } catch {
      setNotice(t('room.shareCancelled'))
      return
    }
    replaceSource({ kind: 'screen', label: t('room.tabName') })
    screen.current = stream
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSharing())
    ensureSharer()
    setShare('screen')
    send({ t: 'source', kind: 'p2p', name: 'tab', live: true })
    if (stream.getAudioTracks().length === 0) {
      setNotice(isFirefox ? t('room.noAudioFirefox') : t('room.noAudio'))
    }
  }

  const offer: RoomSource | null = state?.source ?? null
  const offeredByMe = !!offer && offer.by === myId() && offer.kind !== 'p2p'

  if (connection === 'closed') {
    return (
      <div className="room__lost">
        <Logo />
        <h1>{t('room.lostTitle')}</h1>
        <p>{problem ?? t('room.connecting')}</p>
        <button type="button" className="btn btn--primary" onClick={() => go('/')}>
          {t('room.back')}
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
          {connection === 'live' && t('room.people', { count: members })}
          {connection === 'connecting' && t('room.connecting')}
          {connection === 'reconnecting' && t('room.reconnecting')}
        </p>
        <LangSwitch />
      </header>

      <main className="room__main">
        <RoomCode code={code} />
        <div className="room__grid">
          <div className="room__stage">
            <Player
              source={source}
              state={state}
              clock={clock}
              myId={myId}
              send={send}
              onSignal={onSignal}
              onVideo={onVideo}
              onShareEnded={() => {
                setSource(null)
                setNotice(t('room.shareEnded'))
              }}
              sharingViewers={viewers}
            />
          </div>
          <SourcePanel
            current={source}
            offer={offer}
            offeredByMe={offeredByMe}
            sharing={sharing}
            viewers={viewers}
            notice={notice}
            onUrl={onUrl}
            onFile={onFile}
            onStopOffer={() => send({ t: 'source', kind: null })}
            onUseOffer={() => offer && replaceSource(fromOffer(offer))}
            onShareFile={onShareFile}
            onShareScreen={onShareScreen}
            onStopShare={() => stopSharing()}
          />
        </div>
      </main>
    </div>
  )
}
