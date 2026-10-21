import i18n from '../i18n'
import type { RoomSource } from './api'
import { embedFromOffer } from './embed'
import type { PageSource } from './page'
import { startPage } from './page'

/** What this person is watching right now. */
export type Source =
  | PageSource
  | { kind: 'file'; url: string; label: string }
  | { kind: 'watch'; sharer: string; dur: number | null; live: boolean; label: string }
  | { kind: 'screen'; label: string }

import { embedLabel, hostLabel, titleFromUrl } from './labels'
import type { QueueItem } from './api'

/** What to call what is being watched, worked out now so it follows the language. */
export function labelFor(s: Source, queue: QueueItem[]): string {
  switch (s.kind) {
    case 'file':
      return s.label
    case 'screen':
      return i18n.t('room.tabName')
    case 'watch':
      return s.live ? i18n.t('room.tabName') : s.label
    case 'page':
      return queue.find((q) => q.id === s.item)?.title || s.label || (s.embed ? embedLabel(s.embed) : (titleFromUrl(s.url) ?? hostLabel(s.url)))
  }
}

/** Turn what the room says is playing into what this person would watch. */
export function fromRoom(s: RoomSource, title?: string | null): Source | null {
  switch (s.kind) {
    case 'link':
      return startPage(s.url, s.item, title)
    case 'embed': {
      // Older clients send a platform video as an `embed` source; everybody can still play it.
      const e = embedFromOffer(s)
      const url = e && embedUrl(e)
      return url ? startPage(url, undefined, title) : null
    }
    case 'p2p':
      return { kind: 'watch', sharer: s.by, dur: s.dur, live: s.live, label: s.live ? i18n.t('room.tabName') : s.name }
  }
}

function embedUrl(e: NonNullable<ReturnType<typeof embedFromOffer>>): string {
  switch (e.provider) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${e.id}`
    case 'vimeo':
      return `https://vimeo.com/${e.id}${e.hash ? `/${e.hash}` : ''}`
    case 'streamable':
      return `https://streamable.com/${e.id}`
    case 'twitch':
      return e.type === 'video' ? `https://www.twitch.tv/videos/${e.id}` : e.type === 'clip' ? `https://clips.twitch.tv/${e.id}` : `https://www.twitch.tv/${e.id}`
  }
}
