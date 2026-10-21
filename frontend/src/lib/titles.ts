import { parseEmbed } from './embed'

const TIMEOUT_MS = 6000

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, referrerPolicy: 'no-referrer' })
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

const clean = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, 200) : null)

function dailymotionId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'dai.ly') return /^[a-z0-9]{5,12}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null
    if (host === 'dailymotion.com') return u.pathname.match(/^\/video\/([a-z0-9]{5,12})/)?.[1] ?? null
  } catch {
    /* not an address */
  }
  return null
}

/**
 * The title of a video, for the watch list. Asked of the platforms that let a web page ask (YouTube, Vimeo, Streamable,
 * Dailymotion); Twitch does not, so those are named when somebody plays them. Never throws: no answer is `null`.
 */
export async function fetchTitle(pageUrl: string): Promise<string | null> {
  const embed = parseEmbed(pageUrl)
  if (embed?.provider === 'youtube') {
    return clean((await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${embed.id}`)}`))?.title)
  }
  if (embed?.provider === 'vimeo') {
    return clean((await getJson(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${embed.id}`)}`))?.title)
  }
  if (embed?.provider === 'streamable') {
    return clean((await getJson(`https://api.streamable.com/oembed.json?url=${encodeURIComponent(`https://streamable.com/${embed.id}`)}`))?.title)
  }
  const dm = dailymotionId(pageUrl)
  if (dm) return clean((await getJson(`https://api.dailymotion.com/video/${dm}?fields=title`))?.title)
  return null
}
