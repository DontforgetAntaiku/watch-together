import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState, Signal } from './api'
import { AudioMix, listAudioInputs, openAudioInput } from './audioMix'
import type { AudioInput } from './audioMix'
import { Sharer, captureVideo, isFirefox } from './p2p'
import type { Capture } from './p2p'
import type { Connection } from './useRoom'

export type Sharing = 'file' | 'screen' | null

type Deps = {
  send: (msg: ClientMessage) => void
  onSignal: (fn: (signal: Signal) => void) => () => void
  state: RoomState | null
  myId: () => string
  connection: Connection
  video: MutableRefObject<HTMLVideoElement | null>
  notify: (message: string | null) => void
}

/**
 * Everything about sharing this device's file or a browser tab with the room: the peer connections, the capture
 * (and its automatic fallback), the sound mixer and the device sound picker.
 */
export function useSharing({ send, onSignal, state, myId, connection, video, notify }: Deps) {
  const { t } = useTranslation()
  const [sharing, setSharing] = useState<Sharing>(null)
  const [viewers, setViewers] = useState(0)
  const [sendInfo, setSendInfo] = useState<string | null>(null)
  const [devices, setDevices] = useState<AudioInput[] | null>(null)
  const [deviceOn, setDeviceOn] = useState<string | null>(null)
  const [soundBusy, setSoundBusy] = useState(false)
  const [soundError, setSoundError] = useState<string | null>(null)
  const sharingRef = useRef<Sharing>(null)
  const sharer = useRef<Sharer | null>(null)
  const fileCapture = useRef<Promise<Capture> | null>(null)
  const captureMode = useRef<'direct' | 'canvas'>('direct')
  const screen = useRef<MediaStream | null>(null)
  const display = useRef<MediaStream | null>(null)
  const mix = useRef<AudioMix | null>(null)
  const deviceStream = useRef<MediaStream | null>(null)
  const label = useRef('')
  const sendRef = useRef(send)

  useEffect(() => {
    sendRef.current = send
  }, [send])

  const setShare = useCallback((mode: Sharing) => {
    sharingRef.current = mode
    setSharing(mode)
  }, [])

  const release = useCallback(() => {
    sharer.current?.closeAll()
    display.current?.getTracks().forEach((track) => track.stop())
    display.current = null
    screen.current = null
    deviceStream.current?.getTracks().forEach((track) => track.stop())
    deviceStream.current = null
    mix.current?.close()
    mix.current = null
    void fileCapture.current?.then((c) => c.stop(), () => {})
    fileCapture.current = null
  }, [])

  /** Stop sharing. `tellRoom` is false when the room already moved on to something else. */
  const stop = useCallback(
    (tellRoom = true) => {
      release()
      setDeviceOn(null)
      setDevices(null)
      setSoundError(null)
      setSendInfo(null)
      if (sharingRef.current && tellRoom) sendRef.current({ t: 'source', kind: null })
      setShare(null)
      setViewers(0)
    },
    [release, setShare],
  )

  useEffect(() => release, [release])

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
        if (switched) return void notify(t('room.noFrames'))
        switched = true
        const old = fileCapture.current
        const other = captureMode.current === 'direct' ? 'canvas' : 'direct'
        const next = captureVideo(v, other)
        const made = await next
        fileCapture.current = next
        captureMode.current = made.mode
        await sharer.current?.replaceVideoTrack(made.stream.getVideoTracks()[0])
        void old?.then((c) => c.stop(), () => {})
        notify(t('room.switchedCapture'))
      } catch {
        /* try again on the next tick */
      } finally {
        busy = false
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [sharing, t, notify, video])

  // The room forgot our share (e.g. after a reconnect gave us a new identity): announce it again.
  useEffect(() => {
    if (!sharingRef.current || connection !== 'live' || !state) return
    if (state.source?.kind === 'p2p' && state.source.by === myId()) return
    if (sharingRef.current === 'screen') send({ t: 'source', kind: 'p2p', name: 'tab', live: true })
    else if (video.current) send({ t: 'source', kind: 'p2p', name: label.current || 'file', dur: video.current.duration || null })
  }, [connection, state, myId, send, video])

  /** Share the file that is playing in the page's video element. */
  const startFile = useCallback(
    async (name: string) => {
      const v = video.current
      if (!v) return
      notify(null)
      label.current = name
      // Capture once for everybody, and find out now (not when the first friend connects) whether this browser can do it.
      const captured = captureVideo(v)
      fileCapture.current = captured
      try {
        captureMode.current = (await captured).mode
      } catch (err) {
        fileCapture.current = null
        notify(err instanceof Error ? err.message : t('errors.noCapture'))
        return
      }
      ensureSharer()
      setShare('file')
      sendRef.current({ t: 'source', kind: 'p2p', name: name.slice(0, 120), dur: Number.isFinite(v.duration) ? v.duration : null })
    },
    [video, notify, t, ensureSharer, setShare],
  )

  /** Ask the browser for a tab or window and share it. Returns false when nothing was shared. */
  const startScreen = useCallback(async () => {
    notify(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
    } catch {
      notify(t('room.shareCancelled'))
      return false
    }
    // Video from the picker, sound through our own mixer so a device can be added to a running share.
    display.current = stream
    const audio = new AudioMix()
    mix.current = audio
    if (stream.getAudioTracks().length > 0) audio.add(new MediaStream(stream.getAudioTracks()))
    screen.current = new MediaStream([...stream.getVideoTracks(), audio.track])
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stop())
    ensureSharer()
    setShare('screen')
    sendRef.current({ t: 'source', kind: 'p2p', name: 'tab', live: true })
    if (stream.getAudioTracks().length === 0) notify(isFirefox ? t('room.noAudioFirefox') : t('room.noAudio'))
    return true
  }, [notify, t, ensureSharer, setShare, stop])

  const soundList = useCallback(async () => {
    setSoundBusy(true)
    setSoundError(null)
    try {
      setDevices(await listAudioInputs())
    } catch {
      setSoundError(t('sound.denied'))
    } finally {
      setSoundBusy(false)
    }
  }, [t])

  const soundUse = useCallback(
    async (id: string) => {
      if (!mix.current) return
      setSoundBusy(true)
      setSoundError(null)
      try {
        const stream = await openAudioInput(id)
        deviceStream.current = stream
        mix.current.add(stream)
        setDeviceOn(id)
        notify(null)
      } catch {
        setSoundError(t('sound.failed'))
      } finally {
        setSoundBusy(false)
      }
    },
    [notify, t],
  )

  const soundStop = useCallback(() => {
    const stream = deviceStream.current
    if (stream) {
      mix.current?.remove(stream)
      stream.getTracks().forEach((track) => track.stop())
    }
    deviceStream.current = null
    setDeviceOn(null)
  }, [])

  return {
    sharing,
    isSharing: () => sharingRef.current,
    viewers,
    sendInfo,
    sound: { devices, active: deviceOn, busy: soundBusy, error: soundError },
    startFile,
    startScreen,
    stop,
    soundList,
    soundUse,
    soundStop,
  }
}
