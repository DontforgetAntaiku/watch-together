import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState } from '../../lib/api'
import { HtmlAdapter } from '../../lib/adapters'
import { attachSource, mediaErrorText, preflight } from '../../lib/attach'
import { targetPosition } from '../../lib/clock'
import type { ServerClock } from '../../lib/clock'
import { useEngine } from '../../lib/useEngine'
import { Controls } from '../Controls/Controls'
import './VideoPlayer.css'

type Props = {
  /** `media`: a link or a file played here. `stream`: someone else's share arriving over WebRTC. */
  mode: 'media' | 'stream'
  url?: string
  /** A separate sound file for a picture-only `url`: played by a hidden audio element that follows the video. */
  audioUrl?: string
  /** Resolutions to choose from (a page-link lookup found several); picking one is the page's business. */
  choices?: { value: string; label: string }[]
  choice?: string
  onChoice?: (value: string) => void
  /** Called when the picture or sound could not be loaded (the page may then try a fallback). */
  onFailed?: (message: string) => void
  stream?: MediaStream | null
  live?: boolean
  streamDuration?: number | null
  notice?: string | null
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
  onVideo?: (el: HTMLVideoElement | null) => void
  /** Stream mode: quality choices answered by the sharer. */
  streamQuality?: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }
}

const HIDE_AFTER_MS = 2800
const DOUBLE_TAP_MS = 300

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export function VideoPlayer({ mode, url, audioUrl, choices, choice, onChoice, onFailed, stream, live = false, streamDuration, notice, state, clock, myId, send, onVideo, streamQuality }: Props) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const failedRef = useRef(onFailed)
  const [adapter, setAdapter] = useState<HtmlAdapter | null>(null)
  const { engine, blocked, drift, setBlocked } = useEngine(mode === 'media' ? adapter : null, state, clock, myId, send)

  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [active, setActive] = useState(true)
  const [levels, setLevels] = useState<number[]>([])
  const [level, setLevel] = useState(-1)
  const setHlsLevel = useRef<((index: number) => void) | null>(null)
  const [hint, setHint] = useState<{ side: 'left' | 'right'; n: number } | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const tap = useRef<{ at: number; timer?: number }>({ at: 0 })
  const latest = useRef({ state, clock })
  const attachRun = useRef(0)

  useEffect(() => {
    latest.current = { state, clock }
    failedRef.current = onFailed
  }, [state, clock, onFailed])

  const fail = useCallback((message: string) => {
    setError(message)
    failedRef.current?.(message)
  }, [])

  const roomTime = useCallback(() => {
    const { state: s, clock: c } = latest.current
    return s ? targetPosition(s, c.serverNow()) : 0
  }, [])

  // Hand the element to the element's owner and build the adapter.
  useEffect(() => {
    const v = video.current
    if (!v) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the adapter wraps the DOM element that now exists
    setAdapter(new HtmlAdapter(v))
    onVideo?.(v)
    return () => onVideo?.(null)
  }, [onVideo])

  // Tell the room how long my copy is, so a different cut is noticed (the room compares everybody's lengths).
  useEffect(() => {
    if (mode === 'media' && duration > 0) send({ t: 'media', dur: duration })
  }, [mode, duration, send])
  useEffect(() => {
    if (mode !== 'media') return
    return () => send({ t: 'media', dur: null })
  }, [mode, send])

  // Media mode: point the element at the link or file.
  useEffect(() => {
    const v = video.current
    if (mode !== 'media' || !v || !url) return
    let cancelled = false
    let cleanup = () => {}
    const run = ++attachRun.current
    const problem = url.startsWith('blob:') ? null : preflight(url)
    const audioProblem = audioUrl && !audioUrl.startsWith('blob:') ? preflight(audioUrl) : null
    if (problem || audioProblem) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting a precondition failure for the new source
      fail((problem ?? audioProblem) as string)
      return
    }
    setError(null)
    setBlocked(false)
    setLevels([])
    setLevel(-1)
    setHlsLevel.current = null
    const a = audio.current
    if (a && audioUrl) a.src = audioUrl
    attachSource(v, url, (m) => !cancelled && fail(m), () => cancelled, (heights) => !cancelled && setLevels(heights)).then(
      ({ cleanup: c, setLevel: set }) => {
        // A newer attach has already pointed the element at the same link: undoing ours would clear theirs.
        if (!cancelled) {
          cleanup = c
          setHlsLevel.current = set ?? null
        } else if (attachRun.current === run) c()
      },
    )
    return () => {
      cancelled = true
      cleanup()
      if (a) {
        a.removeAttribute('src')
        a.load()
      }
    }
  }, [mode, url, audioUrl, setBlocked, fail])

  // Picture and sound come from two addresses: the video element is the clock, the audio element follows it.
  useEffect(() => {
    const v = video.current
    const a = audio.current
    if (mode !== 'media' || !v || !a || !audioUrl) return
    v.muted = true
    const follow = () => {
      if (Math.abs(a.currentTime - v.currentTime) > 0.05) a.currentTime = v.currentTime
    }
    const start = () => {
      follow()
      a.playbackRate = v.playbackRate
      a.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') setBlocked(true)
      })
    }
    const onPlay = () => start()
    const onPause = () => a.pause()
    const onSeek = () => follow()
    const onRate = () => {
      a.playbackRate = v.playbackRate
    }
    const onStall = () => a.pause() // the picture is buffering: do not let the sound run ahead
    const onResume = () => {
      if (!v.paused) start()
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onPause)
    v.addEventListener('seeking', onSeek)
    v.addEventListener('seeked', onSeek)
    v.addEventListener('ratechange', onRate)
    v.addEventListener('waiting', onStall)
    v.addEventListener('playing', onResume)
    const onAudioError = () => fail(t('errors.audioFailed'))
    a.addEventListener('error', onAudioError)
    // Keep them within a few hundredths of a second: small gaps by a tiny speed change, big gaps by a jump.
    const timer = window.setInterval(() => {
      if (v.paused || v.seeking || v.readyState < 3) return
      if (a.paused) return void (a.readyState >= 2 && start())
      const gap = a.currentTime - v.currentTime
      if (Math.abs(gap) > 0.25) a.currentTime = v.currentTime + 0.05
      else if (Math.abs(gap) > 0.04) a.playbackRate = v.playbackRate * (gap > 0 ? 0.97 : 1.03)
      else a.playbackRate = v.playbackRate
    }, 400)
    if (!v.paused) start()
    return () => {
      window.clearInterval(timer)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onPause)
      v.removeEventListener('seeking', onSeek)
      v.removeEventListener('seeked', onSeek)
      v.removeEventListener('ratechange', onRate)
      v.removeEventListener('waiting', onStall)
      v.removeEventListener('playing', onResume)
      a.removeEventListener('error', onAudioError)
      a.pause()
    }
  }, [mode, audioUrl, setBlocked, fail, t])

  // Stream mode: show the incoming stream.
  const [streamBlocked, setStreamBlocked] = useState(false)
  useEffect(() => {
    const v = video.current
    if (mode !== 'stream' || !v) return
    v.srcObject = stream ?? null
    if (stream) v.play().then(() => setStreamBlocked(false), () => setStreamBlocked(true))
    return () => {
      v.srcObject = null
    }
  }, [mode, stream])

  // A connection can be "up" while no picture ever arrives (some phones cannot share a file).
  useEffect(() => {
    if (mode !== 'stream' || !stream) return
    const timer = window.setTimeout(() => {
      if (video.current && video.current.videoWidth === 0) setError(t('errors.noPictureViewer'))
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [mode, stream, t])

  // The spinner follows what the element really is doing, checked a few times a second. Events alone can be missed
  // (a seek that finishes while paused, a stream whose sender paused), which left a spinner turning forever.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const v = video.current
      if (!v) return
      const wants = mode === 'media' ? !!url : !!stream && (live || !!latest.current.state?.playing)
      setBuffering(wants && !error && (v.seeking || v.readyState < 3))
    }, 300)
    return () => window.clearInterval(timer)
  }, [mode, url, stream, live, error])

  // Stream mode follows the room clock for its progress bar.
  useEffect(() => {
    if (mode !== 'stream') return
    const timer = window.setInterval(() => {
      const t = roomTime()
      setTime(streamDuration ? Math.min(t, streamDuration) : t)
    }, 250)
    return () => window.clearInterval(timer)
  }, [mode, roomTime, streamDuration])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const poke = useCallback(() => {
    setActive(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setActive(false), HIDE_AFTER_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  const playing = mode === 'stream' ? (live ? true : !!state?.playing) : !paused
  const shownDuration = mode === 'stream' ? (streamDuration ?? 0) : duration
  const shownTime = scrub ?? time

  const toggle = useCallback(() => {
    const v = video.current
    if (!v) return
    if (mode === 'media') {
      if (v.paused) v.play().catch(() => setBlocked(true))
      else v.pause()
    } else if (!live) {
      send({ t: state?.playing ? 'pause' : 'play', pos: roomTime(), ts: clock.serverNow() })
    }
  }, [mode, live, send, state?.playing, roomTime, clock, setBlocked])

  const seekTo = useCallback(
    (t: number) => {
      const v = video.current
      const max = mode === 'stream' ? (streamDuration ?? 0) : duration
      const clamped = Math.max(0, max ? Math.min(t, max) : t)
      if (mode === 'media' && v) {
        v.currentTime = clamped
        setTime(clamped)
      } else if (!live) {
        send({ t: 'seek', pos: clamped, ts: clock.serverNow() })
        setTime(clamped)
      }
    },
    [mode, live, duration, streamDuration, send, clock],
  )

  const skip = useCallback(
    (seconds: number) => {
      const base = mode === 'media' ? (video.current?.currentTime ?? 0) : roomTime()
      seekTo(base + seconds)
      setHint({ side: seconds < 0 ? 'left' : 'right', n: Date.now() })
      poke()
    },
    [mode, roomTime, seekTo, poke],
  )

  const toggleFullscreen = useCallback(() => {
    const el = box.current
    const v = video.current as FullscreenVideo | null
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {})
    else v?.webkitEnterFullscreen?.()
  }, [])

  // With a separate sound file the audio element is the one that makes noise (the video stays muted).
  const volumeEl = useCallback(() => (audioUrl ? audio.current : video.current), [audioUrl])
  const setVol = useCallback(
    (x: number) => {
      const el = volumeEl()
      if (!el) return
      el.volume = x
      el.muted = x === 0
    },
    [volumeEl],
  )
  const toggleMute = useCallback(() => {
    const el = volumeEl()
    if (el) el.muted = !el.muted
  }, [volumeEl])

  // Keyboard shortcuts while this player is on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || e.ctrlKey || e.metaKey || e.altKey) return
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if ((e.key === ' ' || e.key === 'Enter') && (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement)) return
      const v = video.current
      const base = mode === 'media' ? (v?.currentTime ?? 0) : roomTime()
      switch (e.key) {
        case ' ':
        case 'k':
          toggle()
          break
        case 'ArrowLeft':
          skip(e.shiftKey ? -10 : -5)
          break
        case 'ArrowRight':
          skip(e.shiftKey ? 10 : 5)
          break
        case 'j':
          skip(-10)
          break
        case 'l':
          skip(10)
          break
        case 'ArrowUp':
          if (volumeEl()) setVol(Math.min(1, (volumeEl()?.volume ?? 1) + 0.1))
          break
        case 'ArrowDown':
          if (volumeEl()) setVol(Math.max(0, (volumeEl()?.volume ?? 0) - 0.1))
          break
        case 'm':
          toggleMute()
          break
        case 'f':
          toggleFullscreen()
          break
        case '0':
          seekTo(0)
          break
        default:
          return
      }
      void base
      e.preventDefault()
      poke()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode, toggle, skip, seekTo, toggleFullscreen, roomTime, poke, volumeEl, setVol, toggleMute])

  const onSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    if (e.pointerType === 'mouse') {
      toggle()
      poke()
      return
    }
    // Touch: double tap on the sides skips, double tap in the middle plays/pauses, single tap shows or hides the controls.
    const now = performance.now()
    window.clearTimeout(tap.current.timer)
    if (now - tap.current.at < DOUBLE_TAP_MS) {
      tap.current.at = 0
      if (x < 0.35 && !live) skip(-10)
      else if (x > 0.65 && !live) skip(10)
      else toggle()
      poke()
    } else {
      tap.current.at = now
      tap.current.timer = window.setTimeout(() => {
        tap.current.at = 0
        if (active) {
          window.clearTimeout(hideTimer.current)
          setActive(false)
        } else poke()
      }, DOUBLE_TAP_MS)
    }
  }

  // Quality: the sharer's choices for a stream, or the HLS ladder for a link.
  const hlsOptions = (() => {
    if (levels.length < 2) return []
    const picks = levels.map((h, i) => ({ value: String(i), label: `${h}p`, h })).sort((a, b) => b.h - a.h)
    return [{ value: 'auto', label: t('player.qualityAuto') }, ...picks.map(({ value, label }) => ({ value, label }))]
  })()
  const qualityOptions = mode === 'stream' ? (streamQuality?.options ?? []) : choices?.length ? choices : hlsOptions
  const qualityValue = mode === 'stream' ? (streamQuality?.value ?? 'auto') : choices?.length ? (choice ?? '') : level < 0 ? 'auto' : String(level)
  const onQuality = (value: string) => {
    if (mode === 'stream') streamQuality?.onChange(value)
    else if (choices?.length) onChoice?.(value)
    else {
      const index = value === 'auto' ? -1 : Number(value)
      setLevel(index)
      setHlsLevel.current?.(index)
    }
  }

  const controlsVisible = !playing || active || scrub !== null
  const showBlocked = (blocked || streamBlocked) && !error
  const status = notice ?? null

  return (
    <div
      ref={box}
      className="vp"
      data-fullscreen={fullscreen}
      data-hide-cursor={playing && !controlsVisible}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
    >
      <video
        ref={video}
        className="vp__video"
        playsInline
        disablePictureInPicture
        preload="auto"
        onPlay={() => {
          setPaused(false)
          if (mode === 'media') engine?.handlePlay()
        }}
        onPause={() => {
          setPaused(true)
          if (mode === 'media') engine?.handlePause()
        }}
        onSeeked={() => mode === 'media' && engine?.handleSeeked()}
        onTimeUpdate={(e) => mode === 'media' && scrub === null && setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          const t = e.currentTarget.currentTime
          for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) setBufferedEnd(b.end(i))
        }}
        onVolumeChange={(e) => {
          if (audioUrl) return // the sound's own element reports the volume
          setVolume(e.currentTarget.volume)
          setMuted(e.currentTarget.muted)
        }}
        onLoadedMetadata={() => {
          if (mode === 'media') engine?.apply(true)
          else setError(null)
        }}
        onError={() => mode === 'media' && url && !error && fail(mediaErrorText(video.current!))}
      />
      {audioUrl && (
        <audio
          ref={audio}
          preload="auto"
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume)
            setMuted(e.currentTarget.muted)
          }}
        />
      )}
      <div className="vp__tap" onPointerUp={onSurfacePointerUp} />

      {hint && (
        <div key={hint.n} className="vp__hint" data-side={hint.side} aria-hidden="true">
          {hint.side === 'left' ? t('player.back10') : t('player.fwd10')}
        </div>
      )}
      {buffering && !error && !showBlocked && <div className="vp__spinner" aria-label={t('player.buffering')} />}
      {state?.hold && state.waiting > (buffering ? 1 : 0) && <div className="vp__wait">{t('player.waiting', { count: state.waiting })}</div>}

      <Controls
        playing={playing}
        time={shownTime}
        duration={shownDuration}
        bufferedEnd={mode === 'media' ? bufferedEnd : shownTime}
        live={live}
        muted={muted}
        volume={volume}
        fullscreen={fullscreen}
        canFullscreen={document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype}
        visible={controlsVisible}
        onToggle={() => {
          toggle()
          poke()
        }}
        onSkip={skip}
        onScrub={(t) => {
          setScrub(t)
          poke()
        }}
        onCommit={() => {
          if (scrub !== null) {
            seekTo(scrub)
            setScrub(null)
          }
        }}
        onMute={toggleMute}
        onVolume={setVol}
        onFullscreen={toggleFullscreen}
        qualityOptions={qualityOptions}
        quality={qualityValue}
        onQuality={onQuality}
      />

      {showBlocked && (
        <button
          type="button"
          className="vp__overlay"
          onClick={() => {
            setStreamBlocked(false)
            setBlocked(false)
            if (mode === 'stream') void video.current?.play()
            else {
              engine?.apply(true)
              void audio.current?.play().catch(() => {})
            }
          }}
        >
          <span className="vp__overlay-btn">{t('player.join')}</span>
          <span>{t('player.joinHint')}</span>
        </button>
      )}
      {status && !error && <div className="vp__notice">{status}</div>}
      {error && (
        <div className="vp__error" role="alert">
          {error}
        </div>
      )}
      {mode === 'media' && !error && drift !== null && Math.abs(drift) >= 0.6 && (
        <p className="vp__sync">{t('player.catching', { value: `${drift > 0 ? '+' : ''}${drift.toFixed(1)}` })}</p>
      )}
    </div>
  )
}
