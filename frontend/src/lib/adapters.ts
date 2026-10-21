import { debug } from './debug'
import type { MediaAdapter } from './engine'
import i18n from '../i18n'

export class HtmlAdapter implements MediaAdapter {
  el: HTMLVideoElement
  private recovering = false
  private recoveringSince = 0
  constructor(el: HTMLVideoElement) {
    this.el = el
  }
  /**
   * Waiting for data: seeking or out of data, and then until a few seconds are buffered again. Without that margin the
   * player would report "ready" the instant one frame arrives and run dry again straight away.
   */
  stalled = () => {
    const el = this.el
    const now = performance.now()
    if (el.seeking || el.readyState < 3) {
      if (!this.recovering) this.recoveringSince = now
      this.recovering = true
      return true
    }
    if (!this.recovering) return false
    let end = el.currentTime
    for (let i = 0; i < el.buffered.length; i++) if (el.buffered.start(i) <= el.currentTime + 0.1 && el.buffered.end(i) > end) end = el.buffered.end(i)
    const remaining = Number.isFinite(el.duration) ? el.duration - el.currentTime : Infinity
    // A cap, so one odd browser can never keep the room waiting for this player forever.
    if (el.ended || end - el.currentTime >= Math.min(3, remaining) || now - this.recoveringSince > 8000) {
      this.recovering = false
      return false
    }
    return true
  }
  ready = () => this.el.readyState >= 1
  time = () => this.el.currentTime
  duration = () => (Number.isFinite(this.el.duration) ? this.el.duration : 0)
  paused = () => this.el.paused
  ended = () => this.el.ended
  play = () => this.el.play()
  pause = () => this.el.pause()
  seek = (t: number) => {
    this.el.currentTime = t
  }
  setRate = (r: number) => {
    if (this.el.playbackRate !== r) this.el.playbackRate = r
  }
}

let ytApi: Promise<typeof YT> | null = null

function loadYouTube(): Promise<typeof YT> {
  if (ytApi) return ytApi
  ytApi = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT)
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT)
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.onerror = () => {
      ytApi = null
      reject(new Error(i18n.t('errors.ytLoad')))
    }
    document.head.appendChild(tag)
  })
  return ytApi
}

export class YouTubeAdapter implements MediaAdapter {
  player: YT.Player
  private lastPoll = 0
  private lastTime = 0
  private timer = 0
  onPlay: () => void = () => {}
  onPause: () => void = () => {}
  onSeeked: () => void = () => {}

  constructor(player: YT.Player) {
    this.player = player
  }

  static async create(host: HTMLElement, id: string, onReady: () => void, onError: (m: string) => void) {
    const api = await loadYouTube()
    const holder = document.createElement('div')
    host.replaceChildren(holder)
    let adapter: YouTubeAdapter | null = null
    const player = new api.Player(holder, {
      videoId: id,
      host: 'https://www.youtube-nocookie.com',
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
      events: {
        onReady: () => onReady(),
        onError: () => onError(i18n.t('errors.ytPlay')),
        onStateChange: (e) => {
          if (e.data === api.PlayerState.PLAYING) adapter?.onPlay()
          else if (e.data === api.PlayerState.PAUSED) adapter?.onPause()
        },
      },
    })
    adapter = new YouTubeAdapter(player)
    adapter.startSeekWatch()
    return adapter
  }

  /** The IFrame API has no "seeked" event, so a jump in the playhead is detected by polling. */
  private startSeekWatch() {
    this.timer = window.setInterval(() => {
      if (!this.ready()) return
      const now = performance.now()
      const t = this.player.getCurrentTime()
      const expected = this.lastTime + (this.paused() ? 0 : ((now - this.lastPoll) / 1000) * this.player.getPlaybackRate())
      if (this.lastPoll && Math.abs(t - expected) > 1.5) this.onSeeked()
      this.lastPoll = now
      this.lastTime = t
    }, 400)
  }

  stalled = () => this.player.getPlayerState?.() === 3
  ready = () => typeof this.player.getCurrentTime === 'function' && this.player.getPlayerState() !== -1
  time = () => this.player.getCurrentTime()
  duration = () => this.player.getDuration() || 0
  paused = () => {
    const st = this.player.getPlayerState()
    return st !== 1 && st !== 3
  }
  ended = () => this.player.getPlayerState() === 0
  play = () => {
    this.player.playVideo()
    return Promise.resolve()
  }
  pause = () => this.player.pauseVideo()
  seek = (t: number) => {
    this.player.seekTo(t, true)
    this.lastPoll = 0
  }
  setRate = (r: number) => {
    if (this.player.getPlaybackRate() !== r) this.player.setPlaybackRate(r)
  }
  destroy() {
    window.clearInterval(this.timer)
    this.player.destroy()
  }
}

type VimeoPlayer = import('@vimeo/player').default

export class VimeoAdapter implements MediaAdapter {
  player: VimeoPlayer
  private now = 0
  private len = 0
  private isPaused = true
  private isEnded = false
  loaded = false
  private buffering = false
  quirkPlayAfterSeek = true
  onPlay: () => void = () => {}
  onPause: () => void = () => {}
  onSeeked: () => void = () => {}

  constructor(player: VimeoPlayer) {
    this.player = player
  }

  static async create(host: HTMLElement, id: string, hash: string | null, onReady: () => void, onError: (m: string) => void) {
    const { default: Player } = await import('@vimeo/player')
    // Build the iframe ourselves: the library's own id lookup goes through an extra web request that fails for unlisted videos.
    const iframe = document.createElement('iframe')
    const query = new URLSearchParams({ dnt: '1', playsinline: '1' })
    if (hash) query.set('h', hash)
    iframe.src = `https://player.vimeo.com/video/${id}?${query}`
    iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'
    host.replaceChildren(iframe)
    const player = new Player(iframe)
    player.ready().catch((e) => debug('vimeo ready failed', e) ?? onError(i18n.t('errors.vimeoPlay')))
    const adapter = new VimeoAdapter(player)
    player.on('loaded', async () => {
      adapter.len = await player.getDuration()
      adapter.loaded = true
      onReady()
    })
    player.on('timeupdate', (d) => {
      adapter.now = d.seconds
      adapter.len = d.duration
    })
    player.on('play', () => {
      debug('vimeo play')
      adapter.isPaused = false
      adapter.isEnded = false
      adapter.onPlay()
    })
    player.on('pause', () => {
      debug('vimeo pause')
      adapter.isPaused = true
      adapter.onPause()
    })
    player.on('ended', () => {
      adapter.isEnded = true
    })
    player.on('seeked', (d) => {
      adapter.now = d.seconds
      adapter.onSeeked()
    })
    player.on('bufferstart', () => {
      adapter.buffering = true
    })
    player.on('bufferend', () => {
      adapter.buffering = false
    })
    player.on('error', (e: { name?: string }) => {
      debug('vimeo error', e)
      // Only failures that mean "this video cannot be shown"; a rejected API call (e.g. a seek out of range) is not one.
      if (['PrivacyError', 'NotFoundError', 'ContentRestrictedError', 'EmbedBlockedError'].includes(e.name ?? ''))
        onError(i18n.t('errors.vimeoPlay'))
    })
    return adapter
  }

  stalled = () => this.buffering
  ready = () => this.loaded
  time = () => this.now
  duration = () => this.len
  paused = () => this.isPaused
  ended = () => this.isEnded
  // The engine recognises a refused autoplay by this error name.
  play = () =>
    this.player.play().then(
      () => undefined,
      (err: { name?: string }) => {
        throw err?.name === 'NotAllowedError' ? new DOMException('autoplay refused', 'NotAllowedError') : err
      },
    )
  pause = () => {
    void this.player.pause()
  }
  seek = (t: number) => {
    const safe = this.len > 0 ? Math.min(t, Math.max(0, this.len - 0.2)) : t
    this.now = safe
    this.player.setCurrentTime(safe).catch(() => {})
  }
  private rateNow = 1
  setRate = (r: number) => {
    if (this.rateNow === r) return
    this.rateNow = r
    this.player.setPlaybackRate(r).catch(() => {})
  }
  destroy() {
    void this.player.destroy()
  }
}
