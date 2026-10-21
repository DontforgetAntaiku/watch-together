import type { ClientMessage, RoomState } from './api'
import { targetPosition } from './clock'
import type { ServerClock } from './clock'

/** What the sync engine needs from any kind of player (HTML video, YouTube, Vimeo). */
export interface MediaAdapter {
  ready(): boolean
  time(): number
  duration(): number
  paused(): boolean
  ended(): boolean
  play(): Promise<void>
  pause(): void
  seek(t: number): void
  setRate(r: number): void
}

const SEEK_TOLERANCE_ON_STATE = 0.4 // seconds: smaller gaps are not worth a jump
const SEEK_TOLERANCE_ON_TICK = 1.2
const NUDGE_FROM = 0.15
const LOCAL_ACTION_GRACE_MS = 1500

/**
 * Keeps one player on the room's shared playhead.
 * A player only announces a local action when it differs from what the room already believes,
 * so a player that merely obeyed the room never speaks and echo loops cannot start.
 */
export class SyncEngine {
  state: RoomState | null = null
  onBlocked: (blocked: boolean) => void = () => {}
  onDrift: (seconds: number) => void = () => {}

  private graceUntil = 0
  private programmatic: { t: number; until: number } | null = null
  private lastProgrammaticAt = -Infinity
  private adapter: MediaAdapter
  private clock: ServerClock
  private myId: () => string
  private send: (msg: ClientMessage) => void

  constructor(adapter: MediaAdapter, clock: ServerClock, myId: () => string, send: (msg: ClientMessage) => void) {
    this.adapter = adapter
    this.clock = clock
    this.myId = myId
    this.send = send
  }

  target(): number {
    return this.state ? targetPosition(this.state, this.clock.serverNow()) : 0
  }

  /** A new room state arrived. States written by this very player are echoes and are skipped. */
  setState(state: RoomState | null) {
    this.state = state
    if (state && state.by !== this.myId()) this.apply(true)
  }

  tick() {
    if (performance.now() < this.graceUntil) return
    this.apply(false)
  }

  /** Bring the player to where the room says it should be. */
  apply(onStateChange: boolean) {
    const a = this.adapter
    const s = this.state
    if (!s || !a.ready()) return
    const duration = a.duration() || Infinity
    const target = Math.min(this.target(), duration)
    const gap = a.time() - target
    if (s.playing) {
      const limit = onStateChange ? SEEK_TOLERANCE_ON_STATE : SEEK_TOLERANCE_ON_TICK
      if (Math.abs(gap) > limit) this.seekTo(target)
      else if (!onStateChange && Math.abs(gap) > NUDGE_FROM) a.setRate(gap > 0 ? 0.95 : 1.05)
      else a.setRate(1)
      if (a.paused() && !a.ended()) {
        a.play().then(
          () => this.onBlocked(false),
          (err: unknown) => {
            if (err instanceof DOMException && err.name === 'NotAllowedError') this.onBlocked(true)
          },
        )
      }
      this.onDrift(Math.abs(gap) > limit ? 0 : gap)
    } else {
      a.setRate(1)
      if (!a.paused()) a.pause()
      if (Math.abs(a.time() - s.pos) > 0.05) this.seekTo(s.pos)
      this.onDrift(0)
    }
  }

  private seekTo(t: number) {
    this.lastProgrammaticAt = performance.now()
    this.programmatic = { t, until: performance.now() + 15_000 }
    this.adapter.seek(t)
  }

  private announce(kind: 'play' | 'pause' | 'seek') {
    this.graceUntil = performance.now() + LOCAL_ACTION_GRACE_MS
    this.send({ t: kind, pos: this.adapter.time(), ts: this.clock.serverNow() })
  }

  handlePlay() {
    const s = this.state
    this.onBlocked(false)
    // Some players (Vimeo) start playing on their own after we seek them while paused; that is not a person pressing play.
    if (s && !s.playing && performance.now() - this.lastProgrammaticAt < 1500) {
      this.adapter.pause()
      return
    }
    if (!s || !s.playing || Math.abs(this.adapter.time() - this.target()) > 1) this.announce('play')
  }

  handlePause() {
    const s = this.state
    if (!s) return
    if (s.playing || Math.abs(this.adapter.time() - s.pos) > 0.5) this.announce('pause')
  }

  handleSeeked() {
    const mine = this.programmatic
    const now = this.adapter.time()
    if (mine && performance.now() < mine.until && Math.abs(now - mine.t) < 1.5) {
      this.programmatic = null
      return
    }
    if (Math.abs(now - this.target()) > 0.7) this.announce('seek')
  }
}
