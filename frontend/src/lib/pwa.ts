import { useSyncExternalStore } from 'react'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

let updateReady = false
let installEvent: InstallEvent | null = null

/** Register the worker (production only), keep checking for a new version, and note when one has taken over. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // A first install also fires `controllerchange`; only a real replacement of a running worker is an update.
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    updateReady = true
    notify()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        const check = () => void registration.update().catch(() => {})
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
        window.addEventListener('online', check)
        window.setInterval(check, 30 * 60 * 1000)
      })
      .catch(() => {})
  })
}

// Hold the browser's own install prompt and offer it from our own button.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installEvent = event as InstallEvent
  notify()
})
window.addEventListener('appinstalled', () => {
  installEvent = null
  notify()
})

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useUpdateReady() {
  return useSyncExternalStore(subscribe, () => updateReady)
}

/** `native`: the browser can show its install dialog. `ios`: only "Add to Home Screen" from the Share menu exists. */
export function useInstall() {
  const native = useSyncExternalStore(subscribe, () => installEvent !== null)
  const standalone = isStandalone()
  return {
    mode: standalone ? null : native ? ('native' as const) : isIos() ? ('ios' as const) : null,
    install: async () => {
      const event = installEvent
      if (!event) return
      await event.prompt()
      await event.userChoice
      installEvent = null
      notify()
    },
  }
}
