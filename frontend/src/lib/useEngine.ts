import { useEffect, useRef, useState } from 'react'
import type { ClientMessage, RoomState } from './api'
import type { ServerClock } from './clock'
import { SyncEngine } from './engine'
import type { MediaAdapter } from './engine'

/** Runs a SyncEngine for one adapter: follows room states, ticks once a second, reports blocked autoplay and drift. */
export function useEngine(
  adapter: MediaAdapter | null,
  state: RoomState | null,
  clock: ServerClock,
  myId: () => string,
  send: (msg: ClientMessage) => void,
) {
  const [engine, setEngine] = useState<SyncEngine | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [drift, setDrift] = useState<number | null>(null)
  const latest = useRef(state)

  useEffect(() => {
    latest.current = state
  }, [state])

  useEffect(() => {
    if (!adapter) return
    const next = new SyncEngine(adapter, clock, myId, send)
    next.onBlocked = setBlocked
    next.onDrift = setDrift
    next.state = latest.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the engine is an external object tied to the adapter
    setEngine(next)
    const timer = window.setInterval(() => next.tick(), 1000)
    const watch = window.setInterval(() => next.checkBuffering(), 500)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(watch)
      next.dispose()
      setEngine(null)
    }
  }, [adapter, clock, myId, send])

  useEffect(() => {
    engine?.setState(state)
  }, [engine, state])

  return { engine, blocked, drift, setBlocked }
}
