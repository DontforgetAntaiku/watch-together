import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/** Fill the placeholders of dist/sw.js: a cache name per build and the list of files that make up the app shell. */
function serviceWorkerPrecache(): Plugin {
  return {
    name: 'service-worker-precache',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist'
      // Lazy chunks (hls.js, the Vimeo player) and rarely needed font subsets are cached the first time they are used.
      const skip = /^assets\/(hls|player\.es)-|vietnamese|\.map$|\.woff$/
      const files = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/') && !skip.test(name))
        .map((name) => `/${name}`)
      const list = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', ...files]
      const id = Buffer.from(list.join('|')).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(-10) + Date.now().toString(36)
      const path = join(dir, 'sw.js')
      writeFileSync(path, readFileSync(path, 'utf8').replace("'__BUILD_ID__'", JSON.stringify(id)).replace('/*PRECACHE*/ []', JSON.stringify(list, null, 2)))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerPrecache()],
  build: { chunkSizeWarningLimit: 700 }, // hls.js is a lazy chunk, loaded only for .m3u8 links
  define: {
    'import.meta.env.VITE_DEBUG': JSON.stringify(process.env.FRONTEND_DEBUG ?? 'True'),
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT ?? '8000'}`,
        changeOrigin: false,
      },
    },
  },
})
