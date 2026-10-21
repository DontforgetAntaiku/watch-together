export type Embed = { kind: 'yt'; id: string } | { kind: 'vimeo'; id: string; hash: string | null }

/** Recognise YouTube and Vimeo page links; anything else is treated as a direct video link. */
export function parseEmbed(raw: string): Embed | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'youtu.be' && parts[0]) return ytId(parts[0])
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (parts[0] === 'watch') return ytId(url.searchParams.get('v') ?? '')
    if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) return ytId(parts[1])
    return null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const segs = parts[0] === 'video' ? parts.slice(1) : parts
    const id = segs.find((p) => /^\d{1,12}$/.test(p))
    if (!id) return null
    const after = segs[segs.indexOf(id) + 1]
    const hash = url.searchParams.get('h') ?? (after && /^[a-f0-9]{6,20}$/.test(after) ? after : null)
    return { kind: 'vimeo', id, hash }
  }
  return null
}

function ytId(candidate: string): Embed | null {
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? { kind: 'yt', id: candidate } : null
}
