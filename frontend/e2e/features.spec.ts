import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'node:fs'
import { createRoom, joinRoom, media, newPage, playLink, roomWithViewers, seen } from './helpers'

const names = (p: Page) => p.locator('.list__name').allInnerTexts()

test.describe('ready check', () => {
  test('everybody says yes, a 3-2-1 runs, and then all of them play together', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    const [a, b] = pages
    await a.locator('.player').hover()
    await a.getByRole('button', { name: 'Ready check' }).click()
    // the video stops where it is, and both see who is ready
    for (const p of pages) await expect(p.locator('.ready__title')).toBeVisible()
    for (const p of pages) await expect.poll(async () => (await seen(p))!.paused).toBe(true)
    await expect(b.locator('.ready__small')).toContainText('1 of 2 ready')
    await expect(a.getByRole('button', { name: "I'm ready" })).toHaveCount(0) // the one who asked is ready already
    await b.getByRole('button', { name: "I'm ready" }).click()
    for (const p of pages) await expect(p.locator('.ready__count')).toBeVisible()
    for (const p of pages) await expect.poll(async () => (await seen(p))!.paused, { timeout: 15_000 }).toBe(false)
    for (const p of pages) await expect(p.locator('.ready')).toHaveCount(0)
    const [ta, tb] = [(await seen(a))!.t, (await seen(b))!.t]
    expect(Math.abs(ta - tb)).toBeLessThan(1.5)
  })

  test('cancelling ends the check and nothing starts', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    const [a, b] = pages
    await a.getByRole('button', { name: 'Ready check' }).click()
    await expect(b.locator('.ready__title')).toBeVisible()
    await b.locator('.ready').getByRole('button', { name: 'Cancel' }).click()
    for (const p of pages) await expect(p.locator('.ready')).toHaveCount(0)
    await a.waitForTimeout(4000)
    for (const p of pages) expect((await seen(p))!.paused).toBe(true)
  })
})

test.describe('the watch list', () => {
  test('several links pasted at once are all added; a saved list can be loaded into another room', async ({ browser }) => {
    const a = await newPage(browser)
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await a.locator('#video-url').fill(`${media('short1.webm')} ${media('short2.webm')}  nonsense ${media('short1.webm')}`)
    await a.getByRole('button', { name: 'Add to the watch list' }).click()
    await expect.poll(() => names(b)).toEqual(['short1', 'short2'])
    await expect(a.locator('.list__count')).toHaveText('2')

    const download = a.waitForEvent('download')
    await a.getByRole('button', { name: 'Save list' }).click()
    const file = await download
    const path = await file.path()
    const saved = JSON.parse(fs.readFileSync(path, 'utf8'))
    expect(saved.items.map((i: { url: string }) => i.url)).toEqual([media('short1.webm'), media('short2.webm')])

    // into a brand new room
    const c = await newPage(browser)
    await createRoom(c)
    await c.locator('.list input[type="file"]').setInputFiles(path)
    await expect.poll(() => names(c)).toEqual(['short1', 'short2'])
  })

  test('a file with no usable link is refused with a message', async ({ browser }) => {
    const a = await newPage(browser)
    await createRoom(a)
    await a.locator('.list input[type="file"]').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('nothing to see\n') })
    await expect(a.locator('.source__notice')).toContainText('no links')
  })

  test('a playlist page says why it cannot be read when the server has no lookup tool', async ({ browser }) => {
    const a = await newPage(browser)
    await createRoom(a)
    await a.locator('#video-url').fill('https://www.youtube.com/playlist?list=PL0123456789')
    await a.locator('.source__play').click()
    await expect(a.locator('.source__notice')).toContainText('playlist')
    expect(await names(a)).toEqual([])
  })
})

test.describe('coming back', () => {
  test('the home page offers the room this device was in, and it can be forgotten', async ({ browser }) => {
    const p = await newPage(browser)
    const code = await createRoom(p)
    await expect(p.locator('.room__status')).toContainText('here')
    await p.goto('/')
    await p.getByRole('button', { name: `Back to room ${code}` }).click()
    await p.waitForURL(`**/r/${code}`)
    await p.goto('/')
    await p.getByRole('button', { name: 'Forget this room' }).click()
    await expect(p.getByRole('button', { name: `Back to room ${code}` })).toHaveCount(0)
    await p.reload()
    await expect(p.getByRole('button', { name: `Back to room ${code}` })).toHaveCount(0)
  })

  test('a room that no longer exists is not offered', async ({ browser }) => {
    const p = await newPage(browser)
    await p.addInitScript(() => localStorage.setItem('wt.lastRoom', JSON.stringify({ code: 'ZZZZZZ', at: Date.now() })))
    await p.goto('/')
    await expect(p.locator('.home__create')).toBeVisible()
    await p.waitForTimeout(800)
    await expect(p.locator('.home__back')).toHaveCount(0)
  })
})

test.describe('ad blocker tip', () => {
  test('shows for a platform player, can be hidden, and stays hidden', async ({ browser }) => {
    const p = await newPage(browser)
    await createRoom(p)
    await expect(p.locator('.source__adtip')).toHaveCount(0)
    await playLink(p, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await expect(p.locator('.source__adtip')).toContainText('uBlock Origin')
    await expect(p.locator('.source__adtip a')).toHaveAttribute('href', 'https://ublockorigin.com/')
    await p.getByRole('button', { name: 'Hide this tip' }).click()
    await expect(p.locator('.source__adtip')).toHaveCount(0)
    await p.reload()
    await playLink(p, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await p.waitForTimeout(500)
    await expect(p.locator('.source__adtip')).toHaveCount(0)
  })

  test('is not shown for a plain video file', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 1, 'clip.webm')
    await expect(pages[0].locator('.source__adtip')).toHaveCount(0)
  })
})

test.describe('languages', () => {
  const sample: Record<string, { name: string; create: string }> = {
    Українська: { name: 'Українська', create: 'Створити кімнату' },
    Deutsch: { name: 'Deutsch', create: 'Raum erstellen' },
    Español: { name: 'Español', create: 'Crear una sala' },
    Français: { name: 'Français', create: 'Créer un salon' },
    Português: { name: 'Português', create: 'Criar uma sala' },
    Polski: { name: 'Polski', create: 'Utwórz pokój' },
  }
  test('the menu lists every language, each in its own tongue, and the choice is remembered', async ({ browser }) => {
    const p = await newPage(browser)
    await p.goto('/')
    await p.getByRole('button', { name: 'EN' }).click()
    await expect(p.locator('.lang__item')).toHaveText(['English', 'Русский', 'Українська', 'Deutsch', 'Español', 'Français', 'Português', 'Polski'])
    for (const { name, create } of Object.values(sample)) {
      if (!(await p.locator('.lang__menu').isVisible())) await p.locator('.lang__current').click()
      await p.getByRole('button', { name, exact: true }).click()
      await expect(p.locator('.home__create')).toHaveText(create)
    }
    await p.reload()
    await expect(p.locator('.home__create')).toHaveText('Utwórz pokój')
    expect(await p.evaluate(() => document.documentElement.lang)).toBe('pl')
  })

  test('the browser language picks a supported one, and a regional variant maps to its base', async ({ browser }) => {
    for (const [locale, create] of [['de-AT', 'Raum erstellen'], ['pt-BR', 'Criar uma sala'], ['uk-UA', 'Створити кімнату'], ['ja-JP', 'Create a room']] as const) {
      const p = await newPage(browser, { locale })
      await p.goto('/')
      await expect(p.locator('.home__create'), locale).toHaveText(create)
      await p.context().close()
    }
  })
})

test.describe('swipes on a phone', () => {
  test('a flick moves between the tabs; scrolling, taps and the player do not', async ({ browser }) => {
    const p = await newPage(browser, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })
    await createRoom(p)
    const cdp = await p.context().newCDPSession(p)
    const swipe = async (x0: number, y0: number, x1: number, y1: number, ms = 120) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
      await p.waitForTimeout(ms / 2)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }] })
      await p.waitForTimeout(ms / 2)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const tab = () => p.locator('.room').getAttribute('data-tab')
    expect(await tab()).toBe('add')
    const box = (await p.locator('.source').boundingBox())!
    const y = box.y + 6 // the panel's own padding: a swipe that starts on a field is left to the field
    await swipe(300, y, 80, y) // to the left: the next tab
    await expect.poll(tab).toBe('list')
    await expect(p.locator('.source__section[data-section="list"]')).toBeVisible()
    await swipe(80, y, 300, y) // to the right: back
    await expect.poll(tab).toBe('add')
    await swipe(80, y, 300, y) // nothing before the first one
    expect(await tab()).toBe('add')
    // mostly vertical, too short, and too slow: not a swipe
    await swipe(300, y, 240, y + 200)
    await swipe(300, y, 270, y)
    await swipe(300, y, 80, y, 1500)
    await p.waitForTimeout(300)
    expect(await tab()).toBe('add')
    // a start on the player does nothing
    const player = (await p.locator('.room__stage').boundingBox())!
    await swipe(300, player.y + 60, 80, player.y + 60)
    await p.waitForTimeout(300)
    expect(await tab()).toBe('add')
    // all the way through and back
    await swipe(300, y, 80, y)
    await swipe(300, y, 80, y)
    await swipe(300, y, 80, y)
    await expect.poll(tab).toBe('room')
    await swipe(300, y + 5, 80, y + 5)
    expect(await tab()).toBe('room')
    // the bar still works
    await p.locator('.tabs__tab[data-tab="share"]').click()
    expect(await tab()).toBe('share')
  })

  test('swiping does nothing on a computer-sized screen', async ({ browser }) => {
    const p = await newPage(browser)
    await createRoom(p)
    const cdp = await p.context().newCDPSession(p)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 600 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 600 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(300)
    expect(await p.locator('.room').getAttribute('data-tab')).toBe('add')
  })
})
