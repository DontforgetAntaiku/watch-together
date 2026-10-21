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
  /** The player starts playing by itself after a seek while paused (Vimeo); such a `play` event is not a person. */
  quirkPlayAfterSeek?: boolean
  /** True while the player is waiting for data (seeking, or recovering from running dry). */
  stalled?(): boolean
  /** The player pauses by itself around a seek or an ad (Twitch); such a `pause` event is not a person. */
  quirkPauseAfterSeek?: boolean
}

const SEEK_TOLERANCE_ON_STATE = 0.4 // seconds: smaller gaps are not worth a jump
const SEEK_TOLERANCE_ON_TICK = 1.2
const NUDGE_FROM = 0.15
const LOCAL_ACTION_GRACE_MS = 1500
const CHASE_BACKOFF_MS = 4000 // after a corrective seek, give the player this long before correcting again
const REPORT_REFRESH_MS = 4000

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
  private lastChaseAt = -Infinity
  private enginePausedAt = -Infinity
  private stalledChecks = 0
  private reported = false
  private reportedAt = 0
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
    const now = performance.now()
    if (s.playing && !s.hold) {
      const limit = onStateChange ? SEEK_TOLERANCE_ON_STATE : SEEK_TOLERANCE_ON_TICK
      if (Math.abs(gap) > limit) {
        // A player that is still loading must not chase the room: every seek throws away what it has just
        // buffered, so it would never catch up (the "infinite loading" of a slow connection). The room waits for it instead.
        if (onStateChange || (a.stalled?.() !== true && now - this.lastChaseAt > CHASE_BACKOFF_MS)) {
          if (!onStateChange) this.lastChaseAt = now
          this.seekTo(target)
        }
      } else if (!onStateChange && Math.abs(gap) > NUDGE_FROM) a.setRate(gap > 0 ? 0.95 : 1.05)
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
      // Paused, or standing still while somebody loads: everybody waits at the same spot.
      a.setRate(1)
      if (!a.paused()) {
        this.enginePausedAt = now
        a.pause()
      }
      if (Math.abs(a.time() - s.pos) > 0.05) this.seekTo(s.pos)
      this.onDrift(0)
    }
  }

  /** Called a couple of times a second: tell the room while this player is waiting for data, and when that is over. */
  checkBuffering() {
    const s = this.state
    const a = this.adapter
    const stalled = !!s && s.playing && a.ready() && a.stalled?.() === true
    const now = performance.now()
    if (stalled) {
      this.stalledChecks++
      if (this.stalledChecks >= 2 && (!this.reported || now - this.reportedAt > REPORT_REFRESH_MS)) {
        this.reported = true
        this.reportedAt = now
        this.send({ t: 'buffer', on: true })
      }
    } else {
      this.stalledChecks = 0
      if (this.reported) {
        this.reported = false
        this.send({ t: 'buffer', on: false })
      }
    }
  }

  /** The player goes away: do not leave the room waiting for it. */
  dispose() {
    if (this.reported) this.send({ t: 'buffer', on: false })
    this.reported = false
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
    if (this.adapter.quirkPlayAfterSeek && s && !s.playing && performance.now() - this.lastProgrammaticAt < 1500) {
      this.adapter.pause()
      return
    }
    if (!s || !s.playing || Math.abs(this.adapter.time() - this.target()) > 1) this.announce('play')
  }

  handlePause() {
    const s = this.state
    if (!s) return
    // We paused the player ourselves to wait for somebody who is loading: that is not a person pressing pause.
    if (s.hold && performance.now() - this.enginePausedAt < 1000) return
    if (this.adapter.quirkPauseAfterSeek && s.playing && performance.now() - this.lastProgrammaticAt < 2500) {
      void this.adapter.play().catch(() => {})
      return
    }
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
