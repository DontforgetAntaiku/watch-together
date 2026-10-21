import type Hls from 'hls.js'

export function isHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8')
  } catch {
    return /\.m3u8(\?|$)/i.test(url)
  }
}

/** Returns a problem to show before even trying, or null. */
export function preflight(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'This does not look like a link. Paste the full address, starting with https://'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Only http(s) links work.'
  if (parsed.protocol === 'http:' && window.location.protocol === 'https:')
    return 'This page is secure (https), so the browser blocks plain http links. Use an https link or open the file from disk.'
  return null
}

/**
 * Point a <video> at a link. HLS goes through hls.js (loaded only when needed) unless the browser
 * plays it natively (Safari). Returns a cleanup function.
 */
export async function attachSource(
  video: HTMLVideoElement,
  url: string,
  onError: (message: string) => void,
  isCancelled: () => boolean,
): Promise<() => void> {
  if (isHls(url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: HlsLib } = await import('hls.js')
    if (isCancelled()) return () => {}
    if (!HlsLib.isSupported()) {
      onError('This browser cannot play HLS (.m3u8) streams.')
      return () => {}
    }
    const hls: Hls = new HlsLib({ maxBufferLength: 40, enableWorker: true })
    hls.on(HlsLib.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
        onError(
          'Could not load the stream. The link may have expired, or the host does not allow other websites to read it (CORS). Try a fresh link or the file on your disk.',
        )
        hls.destroy()
      } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
      } else {
        onError('The stream could not be played.')
        hls.destroy()
      }
    })
    hls.loadSource(url)
    hls.attachMedia(video)
    return () => hls.destroy()
  }
  video.src = url
  return () => {
    video.removeAttribute('src')
    video.load()
  }
}

export function mediaErrorText(video: HTMLVideoElement): string {
  switch (video.error?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return 'The network failed while loading the video. The link may have expired.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'Your browser could not decode this video.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Your browser cannot play this link: it may be expired, blocked for other sites, or not a video the browser supports (try the file instead).'
    default:
      return 'The video could not be loaded.'
  }
}
