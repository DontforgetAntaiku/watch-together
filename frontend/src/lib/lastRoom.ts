const KEY = 'wt.lastRoom'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Remember the room this device was in, so the home page can offer a way back (kept only on this device). */
export function rememberRoom(code: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }))
  } catch {
    /* storage is blocked: no shortcut, nothing else breaks */
  }
}

export function forgetRoom() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** The room this device was in during the last day, if any. */
export function lastRoom(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { code?: unknown; at?: unknown }
    if (typeof data.code !== 'string' || typeof data.at !== 'number' || Date.now() - data.at > MAX_AGE_MS) return null
    return data.code
  } catch {
    return null
  }
}
