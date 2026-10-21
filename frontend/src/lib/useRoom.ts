import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorText, postMessage, roomInfo } from './api'
import type { ClientMessage, RoomState, Signal } from './api'
import { ServerClock } from './clock'
import { debug } from './debug'
import i18n from '../i18n'

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed'

export function useRoom(code: string) {
  const [connection, setConnection] = useState<Connection>('connecting')
  const [state, setState] = useState<RoomState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const me = useRef({ id: '', token: '' })
  const listeners = useRef(new Set<(signal: Signal) => void>())
  const [clock] = useState(() => new ServerClock())
  const [epoch, setEpoch] = useState(0)
  const lastSeen = useRef(0)

  useEffect(() => {
    let closed = false
    lastSeen.current = Date.now()
    const source = new EventSource(`/api/rooms/${code}/events`)
    source.onmessage = (event) => {
      lastSeen.current = Date.now()
      const msg = JSON.parse(event.data)
      if (msg.t === 'ping') return
      if (msg.t === 'hello') {
        me.current = { id: msg.me, token: msg.token }
        setConnection('live')
        setProblem(null)
        debug('joined as', msg.me)
      } else if (msg.t === 'state') {
        setState(msg as RoomState)
      } else if (msg.t === 'signal') {
        listeners.current.forEach((fn) => fn(msg as Signal))
      }
    }
    source.onerror = () => {
      if (closed) return
      if (source.readyState === EventSource.CLOSED) {
        // The browser gave up: the server answered with an error status.
        setConnection('closed')
        roomInfo(code).then(
          () => setProblem(i18n.t('room.joinFailed')),
          (err) => setProblem(errorText(err)),
        )
      } else {
        setConnection('reconnecting')
      }
    }
    void clock.sample()
    const timer = window.setInterval(() => {
      clock.relax()
      void clock.sample(3)
    }, 30_000)

    // Phones freeze or drop a stream without telling the page. The server pings every 15 s, so silence means a dead
    // connection: open a new one (and do the same when the tab wakes up or the network returns).
    const reconnect = () => {
      if (closed) return
      setConnection('reconnecting')
      setEpoch((n) => n + 1)
    }
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastSeen.current > 40_000) reconnect()
    }, 5000)
    const wake = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSeen.current > 20_000) reconnect()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      closed = true
      source.close()
      window.clearInterval(timer)
      window.clearInterval(watchdog)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [code, clock, epoch])

  const send = useCallback(
    (msg: ClientMessage) => {
      const { id, token } = me.current
      if (!id) return
      postMessage(code, id, token, msg).catch((err) => {
        debug('send failed', err)
        if (err instanceof ApiError && err.status === 403) {
          // We were dropped from the room (e.g. a reconnect gave us a new identity).
          setProblem(i18n.t('room.reset'))
        }
      })
    },
    [code],
  )

  const myId = useCallback(() => me.current.id, [])

  /** Subscribe to WebRTC signalling messages addressed to this member. Returns an unsubscribe function. */
  const onSignal = useCallback((fn: (signal: Signal) => void) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  return { connection, state, problem, send, myId, clock, onSignal }
}
