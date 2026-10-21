import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MEDIA_PORT = 8032
export const MEDIA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.media')
const DIR = MEDIA_DIR

/** name -> ffmpeg arguments. WebM (VP8 + Opus) plays in every Chromium, with or without proprietary codecs. */
const FILES: Record<string, string[]> = {
  // a keyframe every second, so seeking anywhere is quick
  'clip.webm': ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=90', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=90', '-c:v', 'libvpx', '-b:v', '250k', '-g', '25', '-c:a', 'libopus', '-shortest'],
  'short1.webm': ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=5', '-c:v', 'libvpx', '-b:v', '200k', '-g', '25', '-c:a', 'libopus', '-shortest'],
  'short2.webm': ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=5', '-c:v', 'libvpx', '-b:v', '200k', '-g', '25', '-c:a', 'libopus', '-shortest'],
  // heavy on purpose: a slow connection cannot keep up with it
  'big.webm': ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=60', '-c:v', 'libvpx', '-b:v', '5M', '-minrate', '5M', '-maxrate', '5M', '-g', '25', '-c:a', 'libopus', '-shortest'],
}

function makeMedia() {
  mkdirSync(DIR, { recursive: true })
  for (const [name, args] of Object.entries(FILES)) {
    const out = join(DIR, name)
    if (existsSync(out)) continue
    const run = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, out], { encoding: 'utf8' })
    if (run.error || run.status !== 0) {
      throw new Error(`ffmpeg is needed to generate the test videos (${name}): ${run.error?.message ?? run.stderr}`)
    }
  }
}

/** A small static server with Range support and CORS, like a real video host. */
function serve(): Promise<Server> {
  const server = createServer((req, res) => {
    const file = join(DIR, decodeURIComponent((req.url ?? '/').split('?')[0]))
    if (!file.startsWith(DIR) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    const size = statSync(file).size
    const headers = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/webm' }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
      createReadStream(file, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size })
      createReadStream(file).pipe(res)
    }
  })
  return new Promise((done) => server.listen(MEDIA_PORT, '127.0.0.1', () => done(server)))
}

export default async function globalSetup() {
  makeMedia()
  const server = await serve()
  return () => new Promise<void>((done) => server.close(() => done()))
}
