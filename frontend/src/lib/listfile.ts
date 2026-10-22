import { normalizeUrl } from './url'

export type ListEntry = { url: string; title?: string }

const MARK = 'watch-together'

/** The watch list as a small JSON file a person can keep and load into any room later. */
export function exportList(items: { url: string; title: string | null }[]): string {
  return JSON.stringify({ app: MARK, version: 1, items: items.map((i) => (i.title ? { url: i.url, title: i.title } : { url: i.url })) }, null, 2)
}

/** Read a saved list: our JSON, any JSON array of links, or a plain text file with one link per line. Never throws. */
export function parseList(text: string): ListEntry[] {
  const out: ListEntry[] = []
  const add = (raw: unknown, title?: unknown) => {
    const url = typeof raw === 'string' ? normalizeUrl(raw) : null
    if (!url || out.some((e) => e.url === url)) return
    const name = typeof title === 'string' ? title.trim().slice(0, 200) : ''
    out.push(name ? { url, title: name } : { url })
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    for (const line of text.split(/\r?\n/)) add(line.trim())
    return out.slice(0, 50)
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : []
  for (const entry of list) {
    if (typeof entry === 'string') add(entry)
    else if (entry && typeof entry === 'object') add((entry as { url?: unknown }).url, (entry as { title?: unknown }).title)
  }
  return out.slice(0, 50)
}
