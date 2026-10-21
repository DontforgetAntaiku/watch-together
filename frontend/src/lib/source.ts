import i18n from '../i18n'
import type { RoomSource } from './api'
import { embedFromOffer, embedKey } from './embed'
import type { Embed } from './embed'

/** What this person is watching right now. */
export type Source =
  | { kind: 'link'; url: string; audioUrl?: string; fallbackUrl?: string; label: string }
  | { kind: 'file'; url: string; label: string }
  | { kind: 'embed'; embed: Embed; label: string }
  | { kind: 'watch'; sharer: string; dur: number | null; live: boolean; label: string }
  | { kind: 'screen'; label: string }

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}

/** Short name used in "Watching: …". */
export function embedLabel(e: Embed): string {
  return i18n.t(`embed.label.${embedKey(e)}`)
}

/** Name used in "Someone offered …". */
export function offerLabel(s: RoomSource): string {
  switch (s.kind) {
    case 'link':
      return hostLabel(s.url)
    case 'embed': {
      const e = embedFromOffer(s)
      return e ? i18n.t(`embed.offer.${embedKey(e)}`) : s.provider
    }
    case 'p2p':
      return s.live ? i18n.t('room.tabName') : s.name
  }
}

/** Turn something the room offers into what this person would watch. */
export function fromOffer(s: RoomSource): Source | null {
  switch (s.kind) {
    case 'link':
      return { kind: 'link', url: s.url, audioUrl: s.audio, label: hostLabel(s.url) }
    case 'embed': {
      const e = embedFromOffer(s)
      return e ? { kind: 'embed', embed: e, label: embedLabel(e) } : null
    }
    case 'p2p':
      return { kind: 'watch', sharer: s.by, dur: s.dur, live: s.live, label: s.live ? i18n.t('room.tabName') : s.name }
  }
}
