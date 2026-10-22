import { expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { MEDIA_DIR, MEDIA_PORT } from './global-setup'

export { MEDIA_DIR }

export const media = (name: string) => `http://127.0.0.1:${MEDIA_PORT}/${name}`

export type Seen = { t: number; readyState: number; seeking: boolean; paused: boolean; ended: boolean; spinner: boolean; duration: number; src: string }

export async function newPage(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options })
  return context.newPage()
}

export async function createRoom(page: Page): Promise<string> {
  await page.goto('/')
  await page.locator('.home__create').click() // by class: the label depends on the language
  await page.waitForURL('**/r/*')
  return page.url().split('/r/')[1]
}

export async function joinRoom(page: Page, code: string) {
  await page.goto(`/r/${code}`)
  await expect(page.locator('.room__status')).toContainText('here')
}

/** Press Play for the whole room, and wait until this page really shows the video. */
export async function playLink(page: Page, url: string) {
  await page.locator('#video-url').fill(url)
  await page.locator('.source__play').click() // by class: the label depends on the language
}

export async function waitForVideo(page: Page) {
  await expect.poll(async () => (await seen(page))?.readyState ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(3)
}

/** A room with `n` people who all watch the same video, already playing. */
export async function roomWithViewers(browser: Browser, n: number, file = 'clip.webm', options: Parameters<Browser['newContext']>[0] = {}) {
  const pages = [await newPage(browser, options)]
  const code = await createRoom(pages[0])
  for (let i = 1; i < n; i++) {
    pages.push(await newPage(browser, options))
    await joinRoom(pages[i], code)
  }
  await playLink(pages[0], media(file))
  for (const p of pages) await waitForVideo(p)
  await expect.poll(async () => (await seen(pages[0]))?.paused, { timeout: 15_000 }).toBe(false)
  return { pages, code }
}

/** Playing has reached the end, or is within a moment of it (a player that was jumped to the end may stop just before it). */
export const atEnd = async (page: Page) => {
  const s = await seen(page)
  return !!s && (s.ended || s.t >= s.duration - 1.5)
}

export function seen(page: Page): Promise<Seen | null> {
  return page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return null
    return {
      t: Number(v.currentTime.toFixed(2)),
      readyState: v.readyState,
      seeking: v.seeking,
      paused: v.paused,
      ended: v.ended,
      spinner: !!document.querySelector('.vp__spinner'),
      duration: v.duration,
      src: v.currentSrc.split('/').pop() ?? '',
    }
  })
}

/**
 * Everybody is "fine": no spinner, enough data to play (or at the end), nobody seeking, and all positions together.
 * This is the check for the infinite-loading bugs: it must become true within the timeout and stay a stable state.
 */
export async function expectSettled(pages: Page[], opts: { within?: number; tolerance?: number; playing?: boolean } = {}) {
  const { within = 20_000, tolerance = 1.5, playing } = opts
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(seen))
        if (all.some((s) => !s)) return 'no video yet'
        const s = all as Seen[]
        if (s.some((x) => x.spinner)) return `spinner: ${JSON.stringify(s)}`
        if (s.some((x) => x.seeking || (x.readyState < 3 && !x.ended))) return `still loading: ${JSON.stringify(s)}`
        const ts = s.map((x) => x.t)
        if (Math.max(...ts) - Math.min(...ts) > tolerance) return `apart: ${JSON.stringify(ts)}`
        if (playing !== undefined && s.some((x) => !x.ended && x.paused === playing)) return `playing=${playing} expected: ${JSON.stringify(s)}`
        return 'settled'
      },
      { timeout: within, intervals: [300, 500, 1000], message: 'everybody should settle on the same moment, without a spinner' },
    )
    .toBe('settled')
}

export const skipForward = (page: Page) => page.locator('.controls__row-skip[aria-label="Forward 10 seconds"]').click({ force: true })
export const skipBack = (page: Page) => page.locator('.controls__row-skip[aria-label="Back 10 seconds"]').click({ force: true })

export const setTime = (page: Page, t: number) => page.evaluate((x) => void (document.querySelector('video')!.currentTime = x), t)

/** Make the controls visible (they hide while the picture plays). */
export async function wake(page: Page) {
  await page.locator('.vp').dispatchEvent('pointermove', { pointerType: 'mouse', bubbles: true })
}

export async function throttle(context: BrowserContext, page: Page, kbps: number, latency = 150) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: (kbps * 1000) / 8, uploadThroughput: 1_000_000 })
  return cdp
}

/** Text nodes and labels with no Cyrillic at all, except what may stay as it is (names, codes, numbers). */
export async function untranslated(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const out: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim()
      if (text && !walker.currentNode.parentElement?.closest('script,style,svg')) out.push(text)
    }
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
      for (const a of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(a)
        if (v) out.push(v)
      }
    }
    return out
  })
  const allowed = /^(EN|RU|UK|DE|ES|FR|PT|PL|English|Русский|Українська|Deutsch|Español|Français|Português|Polski|Watch Together|DontforgetAntaiku|YouTube|Vimeo|Twitch|Streamable|[A-Z0-9]{6}|[\d:.,/ \-+−·×]+|i|localhost|127\.0\.0\.1|clip|big|short\d|does-not-exist|[a-z0-9_-]+\.(webm|mp4))$/i
  return [...new Set(texts.filter((t) => !/[А-Яа-яЁё]/.test(t) && !allowed.test(t)))]
}
