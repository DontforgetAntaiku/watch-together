/* Watch Together service worker.
 * Precaches the app shell so the page opens instantly and works offline (a room still needs the server).
 * It never touches /api (live room data, server-sent events), cross-origin requests (video hosts, YouTube,
 * Twitch ...) or range requests (media), so playback is never affected.
 * The two placeholders below are filled in by the build (vite.config.ts). */
const BUILD = '__BUILD_ID__'
const CACHE = `shell-${BUILD}`
const PRECACHE = /*PRECACHE*/ []

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// `ignoreVary`: some servers send `Vary: Origin`, which makes a lookup with a module request miss a precached copy.
const lookup = (request) => caches.match(request, { ignoreVary: true })

async function cacheFirst(request) {
  const hit = await lookup(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

// Pages: the network first, so a new version arrives at once; offline, the cached app shell opens any room link.
async function page(request) {
  try {
    return await fetch(request)
  } catch {
    return (await lookup('/')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(page(request))
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request))
  }
})
