import i18n from '../i18n'
import type { RoomSource } from './api'

/** What this person is watching right now. */
export type Source =
  | { kind: 'link'; url: string; label: string }
  | { kind: 'file'; url: string; label: string }
  | { kind: 'yt'; id: string; label: string }
  | { kind: 'vimeo'; id: string; hash: string | null; label: string }
  | { kind: 'watch'; sharer: string; dur: number | null; live: boolean; label: string }
  | { kind: 'screen'; label: string }

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}

export function offerLabel(s: RoomSource): string {
  switch (s.kind) {
    case 'link':
      return hostLabel(s.url)
    case 'yt':
      return i18n.t('source.aYoutube')
    case 'vimeo':
      return i18n.t('source.aVimeo')
    case 'p2p':
      return s.live ? i18n.t('room.tabName') : s.name
  }
}

/** Turn something the room offers into what this person would watch. */
export function fromOffer(s: RoomSource): Source {
  switch (s.kind) {
    case 'link':
      return { kind: 'link', url: s.url, label: hostLabel(s.url) }
    case 'yt':
      return { kind: 'yt', id: s.id, label: i18n.t('source.youtube') }
    case 'vimeo':
      return { kind: 'vimeo', id: s.id, hash: s.hash, label: i18n.t('source.vimeo') }
    case 'p2p':
      return { kind: 'watch', sharer: s.by, dur: s.dur, live: s.live, label: s.live ? i18n.t('room.tabName') : s.name }
  }
}
