/** Platforms whose official embedded player we can drive. */
export type Embed =
  | { provider: 'youtube'; id: string }
  | { provider: 'vimeo'; id: string; hash: string | null }
  | { provider: 'twitch'; type: 'channel' | 'video' | 'clip'; id: string }
  | { provider: 'streamable'; id: string }

const TWITCH_RESERVED = new Set([
  'videos', 'directory', 'downloads', 'jobs', 'p', 'settings', 'store', 'turbo', 'search', 'prime', 'subscriptions',
  'friends', 'wallet', 'inventory', 'drops', 'moderator', 'popout', 'embed', 'login', 'signup',
])
const STREAMABLE_RESERVED = new Set(['login', 'signup', 'upload', 'about', 'terms', 'privacy', 'pricing', 'contact', 'help', 'logout', 'settings'])

/** Recognise a page link of a supported platform; anything else is treated as a direct video link. */
export function parseEmbed(raw: string): Embed | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' && parts[0]) return youtube(parts[0])
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (parts[0] === 'watch') return youtube(url.searchParams.get('v') ?? '')
    if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) return youtube(parts[1])
    return null
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const segs = parts[0] === 'video' ? parts.slice(1) : parts
    const id = segs.find((p) => /^\d{1,12}$/.test(p))
    if (!id) return null
    const after = segs[segs.indexOf(id) + 1]
    const hash = url.searchParams.get('h') ?? (after && /^[a-f0-9]{6,20}$/.test(after) ? after : null)
    return { provider: 'vimeo', id, hash }
  }

  if (host === 'twitch.tv' || host === 'player.twitch.tv' || host === 'clips.twitch.tv') {
    if (host === 'clips.twitch.tv') return parts[0] === 'embed' ? twitchClip(url.searchParams.get('clip') ?? '') : twitchClip(parts[0] ?? '')
    if (host === 'player.twitch.tv') {
      const video = (url.searchParams.get('video') ?? '').replace(/^v/, '')
      if (/^\d{5,12}$/.test(video)) return { provider: 'twitch', type: 'video', id: video }
      return twitchChannel(url.searchParams.get('channel') ?? '')
    }
    if (parts[0] === 'videos' && /^\d{5,12}$/.test(parts[1] ?? '')) return { provider: 'twitch', type: 'video', id: parts[1] }
    if (parts[1] === 'clip') return twitchClip(parts[2] ?? '')
    if (parts[0] && !TWITCH_RESERVED.has(parts[0].toLowerCase()) && parts.length === 1) return twitchChannel(parts[0])
    return null
  }

  if (host === 'streamable.com') {
    const id = ['e', 'o', 's'].includes(parts[0]) ? parts[1] : parts[0]
    if (!id || (parts.length === 1 && STREAMABLE_RESERVED.has(id))) return null
    return /^[a-z0-9]{3,12}$/.test(id) ? { provider: 'streamable', id } : null
  }
  return null
}

function youtube(id: string): Embed | null {
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: 'youtube', id } : null
}
function twitchChannel(name: string): Embed | null {
  return /^[A-Za-z0-9_]{3,25}$/.test(name) ? { provider: 'twitch', type: 'channel', id: name.toLowerCase() } : null
}
function twitchClip(slug: string): Embed | null {
  return /^[A-Za-z0-9_-]{8,100}$/.test(slug) ? { provider: 'twitch', type: 'clip', id: slug } : null
}

/** Live streams and clips have no controllable playhead: everyone just watches. */
export function isSynced(e: Embed): boolean {
  return !(e.provider === 'twitch' && e.type !== 'video')
}

/** Key into the translation files for the name of what is being watched. */
export function embedKey(e: Embed): string {
  if (e.provider !== 'twitch') return e.provider
  return e.type === 'video' ? 'twitch' : e.type === 'channel' ? 'twitchLive' : 'twitchClip'
}

/** What the server wants for an embed (fixed shapes only). */
export function embedToInput(e: Embed) {
  return { kind: 'embed' as const, ...e }
}

/** The embed fields of a source the room offers. */
export function embedFromOffer(o: { provider: string; id: string; type?: string; hash?: string | null }): Embed | null {
  switch (o.provider) {
    case 'youtube':
    case 'streamable':
      return { provider: o.provider, id: o.id }
    case 'vimeo':
      return { provider: 'vimeo', id: o.id, hash: o.hash ?? null }
    case 'twitch':
      return o.type === 'channel' || o.type === 'video' || o.type === 'clip' ? { provider: 'twitch', type: o.type, id: o.id } : null
  }
  return null
}
