import i18n from '../i18n'

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

import type { Embed } from './embed'

export type RoomSource =
  | { kind: 'link'; url: string; item?: string; audio?: string; by: string }
  | { kind: 'embed'; provider: string; id: string; type?: string; hash?: string | null; by: string }
  | { kind: 'p2p'; name: string; dur: number | null; live: boolean; by: string }

export type SourceInput =
  | { kind: null }
  | { kind: 'link'; url: string; audio?: string }
  | ({ kind: 'embed' } & Embed)
  | { kind: 'p2p'; name: string; dur?: number | null; live?: boolean }

export type Signal = { t: 'signal'; from: string; sig: 'offer' | 'answer' | 'bye' | 'quality'; sdp: string | null }

export type QueueItem = { id: string; url: string; title: string | null; by: string }

export type RoomState = {
  t: 'state'
  playing: boolean
  pos: number
  at: number
  rev: number
  by: string
  n: number
  source: RoomSource | null
  /** Set when people who opened their own copy report clearly different lengths. */
  media: { lo: number; hi: number; n: number } | null
  /** The playhead stands still because `waiting` people are still loading. */
  hold: boolean
  waiting: number
  /** The shared watch list. */
  queue: QueueItem[]
}

export type ClientMessage =
  | { t: 'play' | 'pause' | 'seek'; pos: number; ts: number }
  | ({ t: 'source' } & SourceInput)
  | { t: 'media'; dur: number | null }
  | { t: 'buffer'; on: boolean }
  | { t: 'queue_add'; url: string; title?: string; play?: boolean }
  | { t: 'queue_remove' | 'queue_play' | 'queue_next'; item: string }
  | { t: 'queue_move'; item: string; index: number }
  | { t: 'queue_title'; item: string; title: string }
  | { t: 'signal'; to: string; sig: 'offer' | 'answer' | 'bye' | 'quality'; sdp?: string }

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

export type Config = { resolver: boolean }
export type ResolvedOption = { height: number; url: string; audioUrl: string | null; protocol: 'https' | 'hls' }
export type Resolved = {
  title: string
  url: string
  protocol: 'https' | 'hls'
  height: number | null
  duration: number | null
  needsHeaders: boolean
  /** Picture and sound are separate files: `url` is the picture, this is the sound. */
  audioUrl: string | null
  /** A single file to try when the pair does not play. */
  fallbackUrl: string | null
  /** Every resolution on offer, tallest first; empty when there is nothing to choose. */
  options: ResolvedOption[]
}

let configPromise: Promise<Config> | null = null
/** What this server offers (cached; a server without the extra features answers with all of them off). */
export function getConfig(): Promise<Config> {
  configPromise ??= call<Config>('/config').catch(() => ({ resolver: false }))
  return configPromise
}

export const resolvePage = (url: string) =>
  call<Resolved>('/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })

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
    const known = ['offline', 'no_room', 'full', 'busy', 'slow_down', 'bad_url', 'blocked_host', 'unsupported', 'login', 'no_single_stream', 'unavailable', 'refused', 'failed', 'timeout', 'unavailable_tool']
    if (known.includes(err.message)) return i18n.t(`errors.${err.message}`)
  }
  return i18n.t('errors.generic')
}
