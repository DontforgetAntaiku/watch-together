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

  useEffect(() => {
    let closed = false
    const source = new EventSource(`/api/rooms/${code}/events`)
    source.onmessage = (event) => {
      const msg = JSON.parse(event.data)
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
    return () => {
      closed = true
      source.close()
      window.clearInterval(timer)
    }
  }, [code, clock])

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
