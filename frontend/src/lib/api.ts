export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

export type RoomState = {
  t: 'state'
  playing: boolean
  pos: number
  at: number
  rev: number
  by: string
  n: number
  source: string | null
}

export type ClientMessage =
  | { t: 'play' | 'pause' | 'seek'; pos: number; ts: number }
  | { t: 'source'; url: string | null }

export class ApiError extends Error {
  status: number
  constructor(status: number, code: string) {
    super(code)
    this.status = status
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, 'offline')
  }
  if (!res.ok) {
    let code = 'error'
    try {
      code = (await res.json()).detail ?? code
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, String(code))
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const createRoom = () => call<{ code: string }>('/rooms', { method: 'POST' })
export const roomInfo = (code: string) => call<{ code: string; n: number }>(`/rooms/${code}`)
export const serverTime = () => call<{ t: number }>('/time', { cache: 'no-store' })
export const postMessage = (code: string, member: string, token: string, msg: ClientMessage) =>
  call<void>(`/rooms/${code}/msg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member, token, ...msg }),
  })

/** Turn whatever a person pasted (a code, a link, "abc 123") into a clean room code, or null. */
export function parseCode(raw: string): string | null {
  const fromUrl = raw.match(/\/r\/([A-Za-z0-9]{6})(?:[/?#]|$)/)
  const text = (fromUrl ? fromUrl[1] : raw).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (text.length !== CODE_LENGTH) return null
  return [...text].every((c) => CODE_ALPHABET.includes(c)) ? text : null
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.message) {
      case 'offline':
        return 'No connection to the server. Check your network and try again.'
      case 'no_room':
        return 'This room does not exist (or it expired after being empty for a while).'
      case 'full':
        return 'This room is full.'
      case 'busy':
        return 'The server is busy right now. Try again in a minute.'
      case 'slow_down':
        return 'Too many requests. Wait a moment.'
    }
  }
  return 'Something went wrong. Try again.'
}
