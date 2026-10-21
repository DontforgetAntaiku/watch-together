import i18n from '../i18n'
import { embedKey } from './embed'
import type { Embed } from './embed'

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

/** Short name of an embedded platform video. */
export function embedLabel(e: Embed): string {
  return i18n.t(`embed.label.${embedKey(e)}`)
}

/** A readable name for a plain link: the file name when there is one, else the host. */
export function titleFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    const name = last.replace(/\.(mp4|webm|m4v|mov|mkv|m3u8|mp3)$/i, '').replace(/[_+]+/g, ' ').trim()
    return /\.(mp4|webm|m4v|mov|mkv|m3u8|mp3)$/i.test(last) && name.length > 1 ? name.slice(0, 120) : null
  } catch {
    return null
  }
}
