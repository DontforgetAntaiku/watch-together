import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage, RoomState } from '../api'
import { ServerClock, targetPosition } from '../clock'
import { SyncEngine } from '../engine'
import type { MediaAdapter } from '../engine'

/** A player that is only numbers, so the engine's decisions can be checked without a browser. */
class FakePlayer implements MediaAdapter {
  now = 0
  length = 600
  isPaused = true
  isStalled = false
  rate = 1
  seeks: number[] = []
  plays = 0
  pauses = 0
  ready = () => true
  time = () => this.now
  duration = () => this.length
  paused = () => this.isPaused
  ended = () => false
  stalled = () => this.isStalled
  play = () => {
    this.plays++
    this.isPaused = false
    return Promise.resolve()
  }
  pause = () => {
    this.pauses++
    this.isPaused = true
  }
  seek = (t: number) => {
    this.seeks.push(t)
    this.now = t
  }
  setRate = (r: number) => {
    this.rate = r
  }
}

const NOW = 1_000_000
const room = (over: Partial<RoomState> = {}): RoomState => ({
  t: 'state', playing: true, pos: 100, at: NOW, rev: 1, by: 'someone-else', n: 2, source: null, media: null, hold: false, waiting: 0, queue: [], check: null, go: null, ...over,
})

let player: FakePlayer
let sent: ClientMessage[]
let engine: SyncEngine
let clock: ServerClock
let wall: number

beforeEach(() => {
  vi.restoreAllMocks()
  player = new FakePlayer()
  sent = []
  clock = new ServerClock()
  wall = NOW
  vi.spyOn(clock, 'serverNow').mockImplementation(() => wall)
  let mono = 10_000
  vi.spyOn(performance, 'now').mockImplementation(() => mono)
  ;(globalThis as { __tick?: (ms: number) => void }).__tick = (ms) => {
    mono += ms
    wall += ms
  }
  engine = new SyncEngine(player, clock, () => 'me', (m) => sent.push(m))
})
const advance = (ms: number) => (globalThis as unknown as { __tick: (ms: number) => void }).__tick(ms)

describe('following the room', () => {
  it('jumps to where the room is and plays', () => {
    advance(5000)
    engine.setState(room())
    expect(player.seeks).toEqual([105])
    expect(player.isPaused).toBe(false)
  })

  it('stays put when the room is paused, at the room position', () => {
    player.isPaused = false
    engine.setState(room({ playing: false, pos: 42 }))
    expect(player.isPaused).toBe(true)
    expect(player.now).toBe(42)
  })

  it('does not announce what it merely obeyed (no echo)', () => {
    engine.setState(room())
    engine.handlePlay()
    engine.handleSeeked()
    expect(sent).toEqual([])
  })

  it('announces a real seek by the person', () => {
    engine.setState(room())
    player.now = 300
    engine.handleSeeked()
    expect(sent).toEqual([expect.objectContaining({ t: 'seek', pos: 300 })])
  })

  it('announces a real pause, but not one it caused while the room waits', () => {
    engine.setState(room())
    player.isPaused = true
    engine.handlePause()
    expect(sent).toEqual([expect.objectContaining({ t: 'pause' })])
    sent.length = 0
    player.isPaused = false // playing again, then somebody starts loading and the room holds
    engine.setState(room({ hold: true, rev: 2, by: '' }))
    expect(player.isPaused).toBe(true)
    engine.handlePause() // the pause event of our own pause for the hold
    expect(sent).toEqual([])
  })
})

describe('slow players (the infinite loading bug)', () => {
  it('never chases the room while it is still loading', () => {
    engine.setState(room())
    player.seeks.length = 0
    player.isStalled = true
    for (let i = 0; i < 10; i++) {
      advance(1000)
      player.now = 100 // loading, and falling further behind every second
      engine.tick()
    }
    expect(player.seeks).toEqual([])
  })

  it('backs off between corrective seeks even when it is not stalled', () => {
    engine.setState(room())
    player.seeks.length = 0
    advance(3000)
    player.now = 100
    engine.tick()
    expect(player.seeks).toHaveLength(1)
    advance(1000)
    player.now = 100
    engine.tick()
    expect(player.seeks).toHaveLength(1) // too soon after the last one
    advance(4000)
    player.now = 100
    engine.tick()
    expect(player.seeks).toHaveLength(2)
  })

  it('tells the room after about a second of stalling, repeats, and says when it is over', () => {
    engine.setState(room())
    player.isStalled = true
    engine.checkBuffering()
    expect(sent).toEqual([]) // a blip is not worth a message
    engine.checkBuffering()
    expect(sent).toEqual([{ t: 'buffer', on: true }])
    engine.checkBuffering()
    expect(sent).toHaveLength(1)
    advance(4500)
    engine.checkBuffering()
    expect(sent).toHaveLength(2) // refreshed, so the room does not forget
    player.isStalled = false
    engine.checkBuffering()
    expect(sent.at(-1)).toEqual({ t: 'buffer', on: false })
  })

  it('does not report stalls while the room is paused, and lets go when it is disposed', () => {
    engine.setState(room({ playing: false }))
    player.isStalled = true
    engine.checkBuffering()
    engine.checkBuffering()
    expect(sent).toEqual([])
    engine.setState(room())
    engine.checkBuffering()
    engine.checkBuffering()
    expect(sent).toHaveLength(1)
    engine.dispose()
    expect(sent.at(-1)).toEqual({ t: 'buffer', on: false })
  })
})

describe('the playhead', () => {
  it('advances while playing, stands still on hold or pause', () => {
    const s = room()
    expect(targetPosition(s, NOW + 7000)).toBe(107)
    expect(targetPosition({ ...s, hold: true }, NOW + 7000)).toBe(100)
    expect(targetPosition({ ...s, playing: false }, NOW + 7000)).toBe(100)
  })
})
