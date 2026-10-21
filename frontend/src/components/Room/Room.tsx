import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorText, getConfig, resolvePage } from '../../lib/api'
import type { RoomSource } from '../../lib/api'
import { AudioMix, listAudioInputs, openAudioInput } from '../../lib/audioMix'
import type { AudioInput } from '../../lib/audioMix'
import { embedToInput, parseEmbed } from '../../lib/embed'
import { Sharer, captureVideo, isFirefox } from '../../lib/p2p'
import type { Capture } from '../../lib/p2p'
import { go } from '../../lib/router'
import { formatTime } from '../../lib/fmt'
import { embedLabel, fromOffer, hostLabel } from '../../lib/source'
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
  const mix = useRef<AudioMix | null>(null)
  const display = useRef<MediaStream | null>(null)
  const deviceStream = useRef<MediaStream | null>(null)
  const [devices, setDevices] = useState<AudioInput[] | null>(null)
  const [deviceOn, setDeviceOn] = useState<string | null>(null)
  const [canResolve, setCanResolve] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [soundBusy, setSoundBusy] = useState(false)
  const [soundError, setSoundError] = useState<string | null>(null)
  const captureMode = useRef<'direct' | 'canvas'>('direct')
  const [sendInfo, setSendInfo] = useState<string | null>(null)

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
      display.current?.getTracks().forEach((t) => t.stop())
      display.current = null
      screen.current = null
      deviceStream.current?.getTracks().forEach((t) => t.stop())
      deviceStream.current = null
      mix.current?.close()
      mix.current = null
      setDeviceOn(null)
      setDevices(null)
      setSoundError(null)
      void fileCapture.current?.then((c) => c.stop(), () => {})
      fileCapture.current = null
      setSendInfo(null)
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
      display.current?.getTracks().forEach((t) => t.stop())
      deviceStream.current?.getTracks().forEach((t) => t.stop())
      mix.current?.close()
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

  // Prove the picture really leaves this device. If a capture method yields no frames while the video plays
  // (phones differ), switch to the other method once, and say so if that does not help either.
  useEffect(() => {
    if (sharing !== 'file') return
    let last = -1
    let stalls = 0
    let switched = false
    let busy = false
    const timer = window.setInterval(async () => {
      const v = video.current
      if (!v || busy) return
      busy = true
      try {
        const st = await sharer.current?.videoStats()
        if (!st) return setSendInfo(null)
        setSendInfo(st.width ? `${st.width}×${st.height}${st.fps ? ` · ${Math.round(st.fps)} fps` : ''}` : null)
        if (v.paused) {
          last = st.frames
          stalls = 0
          return
        }
        stalls = st.frames <= last ? stalls + 1 : 0
        last = st.frames
        if (stalls < 3) return
        stalls = 0
        if (switched) return void setNotice(t('room.noFrames'))
        switched = true
        const old = fileCapture.current
        const other = captureMode.current === 'direct' ? 'canvas' : 'direct'
        const next = captureVideo(v, other)
        const made = await next
        fileCapture.current = next
        captureMode.current = made.mode
        await sharer.current?.replaceVideoTrack(made.stream.getVideoTracks()[0])
        void old?.then((c) => c.stop(), () => {})
        setNotice(t('room.switchedCapture'))
      } catch {
        /* try again on the next tick */
      } finally {
        busy = false
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [sharing, t])

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
    const next = fromOffer(offered)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the room told us what to watch
    if (next) replaceSource(next)
    if (wasSharing) setNotice(t('room.takenOver'))
  }, [state?.source, myId, stopSharing, replaceSource, t])

  const onVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
  }, [])

  const onUrl = (url: string, offer: boolean) => {
    const embed = parseEmbed(url)
    if (embed) {
      replaceSource({ kind: 'embed', embed, label: embedLabel(embed) })
      if (offer) send({ t: 'source', ...embedToInput(embed) })
    } else {
      replaceSource({ kind: 'link', url, label: hostLabel(url) })
      if (offer) send({ t: 'source', kind: 'link', url })
    }
  }

  useEffect(() => {
    let alive = true
    void getConfig().then((c) => alive && setCanResolve(c.resolver))
    return () => {
      alive = false
    }
  }, [])

  // Ask this server to find the video behind a page link (only when the owner switched that on).
  const onResolve = async (page: string, offer: boolean) => {
    setResolving(true)
    setNotice(null)
    try {
      const res = await resolvePage(page)
      replaceSource({
        kind: 'link',
        url: res.url,
        audioUrl: res.audioUrl ?? undefined,
        fallbackUrl: res.fallbackUrl ?? undefined,
        options: res.options?.length ? res.options.map((o) => ({ height: o.height, url: o.url, audioUrl: o.audioUrl ?? undefined })) : undefined,
        quality: res.options?.length ? (res.height ?? undefined) : undefined,
        group: page,
        label: res.title || hostLabel(res.url),
      })
      if (offer) send({ t: 'source', kind: 'link', url: res.url, ...(res.audioUrl ? { audio: res.audioUrl } : {}) })
      setNotice(res.needsHeaders ? t('room.resolvedHeaders') : null)
    } catch (err) {
      setNotice(errorText(err))
    } finally {
      setResolving(false)
    }
  }

  // A quality was chosen in the menu: reload the player's source (it re-syncs to the room's position by itself).
  const onPickQuality = useCallback((height: number) => {
    setSource((current) => {
      if (current?.kind !== 'link') return current
      const option = current.options?.find((o) => o.height === height)
      return option ? { ...current, url: option.url, audioUrl: option.audioUrl, quality: option.height } : current
    })
  }, [])

  // Something did not load: step down to the next lower resolution, else to the single file the lookup also found.
  const onSourceFailed = useCallback(() => {
    setSource((current) => {
      if (current?.kind !== 'link') return current
      const options = current.options ?? []
      const next = options[options.findIndex((o) => o.url === current.url) + 1]
      if (options.length && options.some((o) => o.url === current.url) && next) {
        return { ...current, url: next.url, audioUrl: next.audioUrl, quality: next.height }
      }
      if (current.fallbackUrl) return { kind: 'link', url: current.fallbackUrl, label: current.label }
      return current
    })
    setNotice(t('room.usedFallback'))
  }, [t])

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
      captureMode.current = (await captured).mode
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
    // Video from the picker, sound through our own mixer so a device can be added to a running share.
    display.current = stream
    const audio = new AudioMix()
    mix.current = audio
    if (stream.getAudioTracks().length > 0) audio.add(new MediaStream(stream.getAudioTracks()))
    screen.current = new MediaStream([...stream.getVideoTracks(), audio.track])
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSharing())
    ensureSharer()
    setShare('screen')
    send({ t: 'source', kind: 'p2p', name: 'tab', live: true })
    if (stream.getAudioTracks().length === 0) {
      setNotice(isFirefox ? t('room.noAudioFirefox') : t('room.noAudio'))
    }
  }

  const onSoundList = async () => {
    setSoundBusy(true)
    setSoundError(null)
    try {
      setDevices(await listAudioInputs())
    } catch {
      setSoundError(t('sound.denied'))
    } finally {
      setSoundBusy(false)
    }
  }
  const onSoundUse = async (id: string) => {
    if (!mix.current) return
    setSoundBusy(true)
    setSoundError(null)
    try {
      const stream = await openAudioInput(id)
      deviceStream.current = stream
      mix.current.add(stream)
      setDeviceOn(id)
      setNotice(null)
    } catch {
      setSoundError(t('sound.failed'))
    } finally {
      setSoundBusy(false)
    }
  }
  const onSoundStop = () => {
    const stream = deviceStream.current
    if (stream) {
      mix.current?.remove(stream)
      stream.getTracks().forEach((track) => track.stop())
    }
    deviceStream.current = null
    setDeviceOn(null)
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
        {state?.media && (source?.kind === 'link' || source?.kind === 'file') && (
          <p className="room__warn" role="status">
            {t('room.differentCuts', { lo: formatTime(state.media.lo), hi: formatTime(state.media.hi) })}
          </p>
        )}
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
              onFailed={onSourceFailed}
              onPickQuality={onPickQuality}
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
            sendInfo={sendInfo}
            notice={notice}
            canResolve={canResolve}
            resolving={resolving}
            onResolve={onResolve}
            sound={{ devices, active: deviceOn, busy: soundBusy, error: soundError }}
            onSoundList={onSoundList}
            onSoundUse={onSoundUse}
            onSoundStop={onSoundStop}
            onUrl={onUrl}
            onFile={onFile}
            onStopOffer={() => send({ t: 'source', kind: null })}
            onUseOffer={() => {
              const next = offer && fromOffer(offer)
              if (next) replaceSource(next)
            }}
            onShareFile={onShareFile}
            onShareScreen={onShareScreen}
            onStopShare={() => stopSharing()}
          />
        </div>
      </main>
    </div>
  )
}
