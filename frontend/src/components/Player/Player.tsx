import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMessage, RoomState } from '../../lib/api'
import { attachSource, mediaErrorText, preflight } from '../../lib/attach'
import { targetPosition } from '../../lib/clock'
import type { ServerClock } from '../../lib/clock'
import type { Source } from '../../lib/source'
import './Player.css'

type Props = {
  source: Source | null
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
}

const SEEK_TOLERANCE_ON_STATE = 0.4 // seconds: smaller gaps are not worth a jump
const SEEK_TOLERANCE_ON_TICK = 1.2
const NUDGE_FROM = 0.15
const LOCAL_ACTION_GRACE_MS = 1500

export function Player({ source, state, clock, myId, send }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const stateRef = useRef<RoomState | null>(state)
  const graceUntil = useRef(0)
  const programmatic = useRef<{ t: number; until: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [drift, setDrift] = useState<number | null>(null)
  const [buffering, setBuffering] = useState(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const seekTo = useCallback((v: HTMLVideoElement, t: number) => {
    programmatic.current = { t, until: performance.now() + 15_000 }
    v.currentTime = t
  }, [])

  /** Bring this player to where the room says it should be. */
  const apply = useCallback(
    (onStateChange: boolean) => {
      const v = video.current
      const s = stateRef.current
      if (!v || !s || v.readyState < 1) return
      const duration = Number.isFinite(v.duration) ? v.duration : Infinity
      const target = Math.min(targetPosition(s, clock.serverNow()), duration)
      const gap = v.currentTime - target
      if (s.playing) {
        const limit = onStateChange ? SEEK_TOLERANCE_ON_STATE : SEEK_TOLERANCE_ON_TICK
        if (Math.abs(gap) > limit) seekTo(v, target)
        else if (!onStateChange && Math.abs(gap) > NUDGE_FROM) v.playbackRate = gap > 0 ? 0.95 : 1.05
        else v.playbackRate = 1
        if (v.paused && !v.ended) {
          v.play().then(
            () => setBlocked(false),
            (err: unknown) => {
              if (err instanceof DOMException && err.name === 'NotAllowedError') setBlocked(true)
            },
          )
        }
        setDrift(Math.abs(gap) > limit ? 0 : gap)
      } else {
        v.playbackRate = 1
        if (!v.paused) v.pause()
        if (Math.abs(v.currentTime - s.pos) > 0.05) seekTo(v, s.pos)
        setDrift(0)
      }
    },
    [clock, seekTo],
  )

  // Load the chosen source into the element.
  useEffect(() => {
    const v = video.current
    if (!v || !source) return
    let cancelled = false
    let cleanup = () => {}
    const problem = source.kind === 'url' ? preflight(source.url) : null
    if (problem) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting a precondition failure for the new source
      setError(problem)
      return
    }
    setError(null)
    setBlocked(false)
    attachSource(v, source.url, (m) => !cancelled && setError(m), () => cancelled).then((c) => {
      if (cancelled) c()
      else cleanup = c
    })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [source])

  // Follow every state change made by someone else.
  useEffect(() => {
    if (!state || state.by === myId()) return
    apply(true)
  }, [state, myId, apply])

  // Keep following while playing: small gaps are nudged away with a 5 % speed change, big ones are seeks.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (performance.now() < graceUntil.current) return
      apply(false)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [apply])

  const announce = (kind: 'play' | 'pause' | 'seek') => {
    const v = video.current
    if (!v) return
    graceUntil.current = performance.now() + LOCAL_ACTION_GRACE_MS
    send({ t: kind, pos: v.currentTime, ts: clock.serverNow() })
  }

  // Local events are only announced when they change what the room already believes.
  // That alone breaks every echo loop: a player that merely obeyed the room never speaks.
  const onPlay = () => {
    const s = stateRef.current
    const v = video.current
    if (!v) return
    setBlocked(false)
    if (!s || !s.playing || Math.abs(v.currentTime - targetPosition(s, clock.serverNow())) > 1) announce('play')
  }
  const onPause = () => {
    const s = stateRef.current
    const v = video.current
    if (!v || !s) return
    if (s.playing || Math.abs(v.currentTime - s.pos) > 0.5) announce('pause')
  }
  const onSeeked = () => {
    const s = stateRef.current
    const v = video.current
    if (!v) return
    const mine = programmatic.current
    if (mine && performance.now() < mine.until && Math.abs(v.currentTime - mine.t) < 1.5) {
      programmatic.current = null
      return
    }
    const expected = s ? targetPosition(s, clock.serverNow()) : 0
    if (Math.abs(v.currentTime - expected) > 0.7) announce('seek')
  }

  return (
    <div className="player">
      <video
        ref={video}
        className="player__video"
        controls
        playsInline
        preload="auto"
        onPlay={onPlay}
        onPause={onPause}
        onSeeked={onSeeked}
        onLoadedMetadata={() => apply(true)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onError={() => source && !error && setError(mediaErrorText(video.current!))}
      />
      {!source && (
        <div className="player__empty">
          <p className="player__empty-title">No video yet</p>
          <p>Pick a link or a file below. Everyone in the room picks their own, then the playback stays in sync.</p>
        </div>
      )}
      {source && buffering && !error && <div className="player__badge">Buffering…</div>}
      {blocked && !error && (
        <button type="button" className="player__overlay" onClick={() => apply(true)}>
          <span className="player__overlay-btn">Tap to join playback</span>
          <span>Your browser needs one tap before it lets the video start.</span>
        </button>
      )}
      {error && (
        <div className="player__error" role="alert">
          {error}
        </div>
      )}
      {source && !error && drift !== null && (
        <p className="player__sync" data-ok={Math.abs(drift) < 0.6}>
          {Math.abs(drift) < 0.6 ? 'In sync' : `Catching up (${drift > 0 ? '+' : ''}${drift.toFixed(1)}s)`}
        </p>
      )}
    </div>
  )
}
