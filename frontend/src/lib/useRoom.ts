import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorText, postMessage, roomInfo } from './api'
import type { ClientMessage, RoomState } from './api'
import { ServerClock } from './clock'
import { debug } from './debug'

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed'

export function useRoom(code: string) {
  const [connection, setConnection] = useState<Connection>('connecting')
  const [state, setState] = useState<RoomState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const me = useRef({ id: '', token: '' })
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
      }
    }
    source.onerror = () => {
      if (closed) return
      if (source.readyState === EventSource.CLOSED) {
        // The browser gave up: the server answered with an error status.
        setConnection('closed')
        roomInfo(code).then(
          () => setProblem('Could not join this room. It may be full.'),
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
          setProblem('Connection was reset. Reconnecting…')
        }
      })
    },
    [code],
  )

  const myId = useCallback(() => me.current.id, [])

  return { connection, state, problem, send, myId, clock }
}
