import { serverTime } from './api'

/** Estimates `serverNow() = Date.now() + offset` from the lowest-latency ping samples. */
export class ServerClock {
  offset = 0
  private bestRtt = Infinity

  serverNow = () => Date.now() + this.offset

  async sample(rounds = 5) {
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now()
      try {
        const { t } = await serverTime()
        const t1 = Date.now()
        const rtt = t1 - t0
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt
          this.offset = t - (t0 + t1) / 2
        }
      } catch {
        return
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  /** Keep the best estimate but let it age so a drifting clock is corrected. */
  relax() {
    this.bestRtt = Math.max(this.bestRtt * 1.5, 50)
  }
}

/** Where the shared playhead should be at `serverNow` according to the last room state. */
export function targetPosition(s: { playing: boolean; pos: number; at: number }, serverNow: number): number {
  return s.playing ? Math.max(0, s.pos + (serverNow - s.at) / 1000) : s.pos
}
