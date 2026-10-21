import i18n from '../i18n'
import { debug } from './debug'
import { VimeoAdapter, YouTubeAdapter } from './adapters'
import type { Embed } from './embed'
import type { MediaAdapter } from './engine'

/** An embedded platform player seen through the same small interface as a plain <video>. */
export interface EmbedAdapter extends MediaAdapter {
  onPlay: () => void
  onPause: () => void
  onSeeked: () => void
  onEnded: () => void
  /** The title of the video, when the platform tells it. */
  title?: () => Promise<string | null>
  destroy: () => void
}

const READY_TIMEOUT_MS = 15_000

/**
 * Streamable, through the player.js protocol (a small JSON postMessage protocol several embeds share).
 * Written against the public spec: https://github.com/embedly/player.js
 */
export class PlayerJsAdapter implements EmbedAdapter {
  quirkPlayAfterSeek = true // it fires `play` after a seek, even when paused
  onPlay: () => void = () => {}
  onPause: () => void = () => {}
  onSeeked: () => void = () => {}
  onEnded: () => void = () => {}
  private iframe: HTMLIFrameElement
  private origin: string
  private now = 0
  private len = 0
  private playing = false
  private isReady = false
  private finished = false
  private timer = 0
  private onReadyCb: () => void

  private constructor(iframe: HTMLIFrameElement, origin: string, onReady: () => void, onError: (m: string) => void) {
    this.iframe = iframe
    this.origin = origin
    this.onReadyCb = onReady
    window.addEventListener('message', this.onMessage)
    this.timer = window.setTimeout(() => !this.isReady && onError(i18n.t('errors.embedBlocked')), READY_TIMEOUT_MS)
  }

  static create(slot: HTMLElement, src: string, origin: string, onReady: () => void, onError: (m: string) => void) {
    const iframe = document.createElement('iframe')
    iframe.src = src
    iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'
    iframe.setAttribute('allowfullscreen', '')
    // The page sends no referrer at all (many video hosts reject one). This player works out where to send its replies
    // from the referrer, so it gets our origin and nothing more.
    iframe.referrerPolicy = 'origin'
    slot.replaceChildren(iframe)
    return Promise.resolve(new PlayerJsAdapter(iframe, origin, onReady, onError))
  }

  private send(method: string, value?: unknown, listener?: string) {
    debug('playerjs send', method, value)
    this.iframe.contentWindow?.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', method, value, listener }), this.origin)
  }

  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow || e.origin !== this.origin) return
    let msg: { context?: string; event?: string; value?: { seconds?: number; duration?: number } }
    try {
      msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    } catch {
      return
    }
    if (msg?.context !== 'player.js') return
    debug('playerjs event', msg.event)
    switch (msg.event) {
      case 'ready':
        if (this.isReady) return
        // Streamable only starts answering once the host has registered for `ready` as well.
        for (const ev of ['ready', 'play', 'pause', 'ended', 'timeupdate', 'seeked']) this.send('addEventListener', ev, ev)
        this.isReady = true
        window.clearTimeout(this.timer)
        this.send('getDuration', undefined, 'getDuration')
        this.onReadyCb()
        break
      case 'timeupdate':
        this.now = msg.value?.seconds ?? this.now
        this.len = msg.value?.duration ?? this.len
        break
      case 'getDuration':
        if (typeof msg.value === 'number') this.len = msg.value
        break
      case 'play':
        this.finished = false
        this.playing = true
        this.onPlay()
        break
      case 'pause':
        this.playing = false
        this.onPause()
        break
      case 'ended':
        this.playing = false
        this.finished = true
        this.onEnded()
        break
      case 'seeked':
        this.onSeeked()
        break
    }
  }

  ready = () => this.isReady
  time = () => this.now
  duration = () => this.len
  paused = () => !this.playing
  ended = () => this.finished
  play = () => {
    this.send('play')
    return Promise.resolve()
  }
  pause = () => this.send('pause')
  seek = (t: number) => {
    this.now = t
    this.send('setCurrentTime', t)
  }
  setRate = () => {}
  destroy() {
    window.clearTimeout(this.timer)
    window.removeEventListener('message', this.onMessage)
  }
}

type TwitchPlayer = {
  play: () => void
  pause: () => void
  seek: (t: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  isPaused: () => boolean
  getEnded: () => boolean
  addEventListener: (event: string, cb: (data?: { position?: number }) => void) => void
}
declare global {
  interface Window {
    Twitch?: { Player: new (target: string, options: Record<string, unknown>) => TwitchPlayer }
  }
}

let twitchApi: Promise<NonNullable<Window['Twitch']>> | null = null
function loadTwitch() {
  if (twitchApi) return twitchApi
  twitchApi = new Promise((resolve, reject) => {
    if (window.Twitch?.Player) return resolve(window.Twitch)
    const tag = document.createElement('script')
    tag.src = 'https://embed.twitch.tv/embed/v1.js'
    tag.onload = () => (window.Twitch ? resolve(window.Twitch) : reject(new Error(i18n.t('errors.twitchLoad'))))
    tag.onerror = () => {
      twitchApi = null
      reject(new Error(i18n.t('errors.twitchLoad')))
    }
    document.head.appendChild(tag)
  })
  return twitchApi
}

/** Twitch videos (VODs) through the official embed API. */
export class TwitchAdapter implements EmbedAdapter {
  quirkPauseAfterSeek = true
  onPlay: () => void = () => {}
  onPause: () => void = () => {}
  onSeeked: () => void = () => {}
  onEnded: () => void = () => {}
  private player: TwitchPlayer
  private slot: HTMLElement
  private isReady = false
  private isPlaying = false

  private constructor(player: TwitchPlayer, slot: HTMLElement) {
    this.player = player
    this.slot = slot
  }

  static async create(slot: HTMLElement, id: string, onReady: () => void, onError: (m: string) => void) {
    const api = await loadTwitch()
    slot.id = `twitch-${Math.random().toString(36).slice(2, 10)}`
    const player = new api.Player(slot.id, {
      video: id,
      parent: [window.location.hostname],
      autoplay: false,
      muted: false,
      width: '100%',
      height: '100%',
    })
    const adapter = new TwitchAdapter(player, slot)
    player.addEventListener('ready', () => {
      adapter.isReady = true
      onReady()
    })
    player.addEventListener('play', () => {
      adapter.isPlaying = true
      adapter.onPlay()
    })
    player.addEventListener('pause', () => {
      adapter.isPlaying = false
      adapter.onPause()
    })
    player.addEventListener('seek', () => adapter.onSeeked())
    player.addEventListener('ended', () => {
      adapter.isPlaying = false
      adapter.onEnded()
    })
    window.setTimeout(() => !adapter.isReady && onError(i18n.t('errors.embedBlocked')), READY_TIMEOUT_MS)
    return adapter
  }

  ready = () => this.isReady
  time = () => this.player.getCurrentTime()
  duration = () => this.player.getDuration() || 0
  paused = () => !this.isPlaying && this.player.isPaused()
  ended = () => this.player.getEnded()
  play = () => {
    this.player.play()
    return Promise.resolve()
  }
  pause = () => this.player.pause()
  seek = (t: number) => this.player.seek(t)
  setRate = () => {}
  destroy() {
    this.slot.remove()
  }
}

/** Build the right adapter for a platform. */
export async function createEmbedAdapter(
  slot: HTMLElement,
  embed: Embed,
  onReady: () => void,
  onError: (message: string) => void,
): Promise<EmbedAdapter> {
  switch (embed.provider) {
    case 'youtube':
      return (await YouTubeAdapter.create(slot, embed.id, onReady, onError)) as EmbedAdapter
    case 'vimeo':
      return (await VimeoAdapter.create(slot, embed.id, embed.hash, onReady, onError)) as EmbedAdapter
    case 'streamable':
      return PlayerJsAdapter.create(slot, `https://streamable.com/e/${embed.id}`, 'https://streamable.com', onReady, onError)
    case 'twitch':
      return TwitchAdapter.create(slot, embed.id, onReady, onError)
  }
}
