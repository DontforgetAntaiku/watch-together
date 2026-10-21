import { useSyncExternalStore } from 'react'

const EVENT = 'wt:navigate'

export function go(path: string, replace = false) {
  if (window.location.pathname === path) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
  window.dispatchEvent(new Event(EVENT))
  window.scrollTo(0, 0)
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVENT, cb)
  }
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}
