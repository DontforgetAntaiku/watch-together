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

/** Several links pasted together (separated by spaces or line breaks): each valid one, once, in order. */
export function splitLinks(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/\s+/)) {
    const url = part ? normalizeUrl(part) : null
    if (url && !out.includes(url)) out.push(url)
  }
  return out
}

/** A YouTube playlist page (not a single video that happens to belong to one). */
export function isPlaylistUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/playlist' && url.searchParams.has('list')
  } catch {
    return false
  }
}
