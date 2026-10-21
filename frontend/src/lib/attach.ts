import type Hls from 'hls.js'
import i18n from '../i18n'

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
    return i18n.t('errors.badLink')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return i18n.t('errors.onlyHttp')
  if (parsed.protocol === 'http:' && window.location.protocol === 'https:')
    return i18n.t('errors.mixed')
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
      onError(i18n.t('errors.noHls'))
      return () => {}
    }
    const hls: Hls = new HlsLib({ maxBufferLength: 40, enableWorker: true })
    hls.on(HlsLib.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
        onError(i18n.t('errors.hlsNetwork'))
        hls.destroy()
      } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
      } else {
        onError(i18n.t('errors.hlsFatal'))
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
      return i18n.t('errors.mediaNetwork')
    case MediaError.MEDIA_ERR_DECODE:
      return i18n.t('errors.mediaDecode')
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return i18n.t('errors.mediaUnsupported')
    default:
      return i18n.t('errors.mediaGeneric')
  }
}
