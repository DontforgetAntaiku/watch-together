/** Make a typed address usable: trim it, add https:// when it was left off, and accept only http(s). */
export function normalizeUrl(raw: string): string | null {
  let text = raw.trim()
  if (!text || /\s/.test(text)) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`
  try {
    const url = new URL(text)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href.length <= 1500 ? url.href : null
  } catch {
    return null
  }
}
