import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createRoom, media, newPage, playLink, untranslated, waitForVideo } from './helpers'

const noSideways = async (page: Page, width: number) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(wide, `horizontal scroll at ${width}px`).toBeLessThanOrEqual(width)
}

test.describe('every page', () => {
  test('has the language switch: home, a room, and a room that does not exist', async ({ browser }) => {
    const p = await newPage(browser)
    await p.goto('/')
    await expect(p.getByRole('group', { name: 'Language' })).toBeVisible()
    await createRoom(p)
    await expect(p.getByRole('group', { name: 'Language' })).toBeVisible()
    await p.goto('/r/ZZZZZZ')
    await expect(p.getByRole('heading', { name: "Can't open this room" })).toBeVisible()
    await expect(p.getByRole('group', { name: 'Language' })).toBeVisible()
  })

  test('the name is never translated', async ({ browser }) => {
    const p = await newPage(browser, { locale: 'ru-RU' })
    await p.goto('/')
    await expect(p.locator('.header')).toContainText('Watch Together')
    expect(await p.title()).toContain('Watch Together')
    await createRoom(p)
    expect(await p.title()).toContain('Watch Together')
    await expect(p.locator('.header')).toContainText('Watch Together')
  })

  test('switching language changes the text, the page language and is remembered', async ({ browser }) => {
    const p = await newPage(browser)
    await p.goto('/')
    await p.getByRole('button', { name: 'RU' }).click()
    await expect(p.getByRole('button', { name: 'Создать комнату' })).toBeVisible()
    expect(await p.evaluate(() => document.documentElement.lang)).toBe('ru')
    await p.reload()
    await expect(p.getByRole('button', { name: 'Создать комнату' })).toBeVisible()
  })

  test('has what Telegram and other link previews read', async ({ request }) => {
    const html = await (await request.get('/')).text()
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:type', 'og:site_name', 'twitter:card']) expect(html, tag).toContain(tag)
    expect(html).toMatch(/<meta name="description" content="[^"]{60,}"/)
    const image = html.match(/property="og:image" content="([^"]+)"/)![1]
    const res = await request.get(image.startsWith('http') ? new URL(image).pathname : image)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  })

  test('is installable: a manifest with icons', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json()
    expect(manifest.name).toBe('Watch Together')
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4)
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200)
  })
})

test.describe('translation', () => {
  test('Russian has no leftover English on the home page, in a room with a list, with notices or with errors', async ({ browser }) => {
    const p = await newPage(browser, { locale: 'ru-RU' })
    await p.goto('/')
    expect(await untranslated(p)).toEqual([])
    await p.getByRole('textbox').fill('abc')
    await p.getByRole('button', { name: 'Войти' }).click()
    await expect(p.getByRole('alert')).toBeVisible()
    expect(await untranslated(p)).toEqual([])
    await p.locator('.home__create').click()
    await p.waitForURL('**/r/*')
    await expect(p.locator('.room__status')).toContainText('здесь')
    expect(await untranslated(p)).toEqual([])
    await playLink(p, media('clip.webm'))
    await waitForVideo(p)
    await p.locator('#video-url').fill(media('short1.webm'))
    await p.getByRole('button', { name: 'Добавить в список' }).click()
    await expect(p.locator('.list__item')).toHaveCount(2)
    await p.locator('.vp').dispatchEvent('pointermove', { pointerType: 'mouse', bubbles: true })
    expect(await untranslated(p)).toEqual([])
    await p.locator('#video-url').fill('это не ссылка')
    await p.getByRole('button', { name: 'Смотреть' }).click()
    await expect(p.locator('.source__notice')).toBeVisible()
    expect(await untranslated(p)).toEqual([])
    await p.goto('/r/ZZZZZZ')
    await expect(p.locator('.room__lost h1')).toContainText('Не удаётся')
    expect(await untranslated(p)).toEqual([])
  })

  test('a failing link is explained in Russian too', async ({ browser }) => {
    const p = await newPage(browser, { locale: 'ru-RU' })
    await createRoom(p)
    await playLink(p, media('does-not-exist.webm'))
    await expect(p.locator('.player__empty-title, .vp__error')).toBeVisible({ timeout: 30_000 })
    expect(await untranslated(p)).toEqual([])
  })
})

test.describe('phones', () => {
  for (const [width, height] of [[320, 640], [360, 740], [390, 844], [430, 932]]) {
    for (const locale of ['en-US', 'ru-RU']) {
      test(`no sideways scroll at ${width}px in ${locale}, home and room with a long list`, async ({ browser }) => {
        const p = await newPage(browser, { viewport: { width, height }, locale, isMobile: true, hasTouch: true })
        await p.goto('/')
        await noSideways(p, width)
        await p.locator('.btn--primary').first().click()
        await p.waitForURL('**/r/*')
        await playLink(p, media('clip.webm').replace('clip', 'a-very-long-file-name-that-keeps-going-and-going-and-going-for-a-while-to-test-wrapping-in-the-list'))
        for (let i = 0; i < 4; i++) {
          await p.locator('#video-url').fill(media('short1.webm') + `?x=${i}`)
          await p.locator('.source__add').click()
        }
        await noSideways(p, width)
      })
    }
  }

  test('the player stays pinned while the list scrolls (portrait), and controls are big enough to tap', async ({ browser }) => {
    const p = await newPage(browser, { viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true })
    await createRoom(p)
    await playLink(p, media('clip.webm'))
    await waitForVideo(p)
    for (let i = 0; i < 8; i++) {
      await p.locator('#video-url').fill(media('short1.webm') + `?x=${i}`)
      await p.locator('.source__add').click()
    }
    for (const sel of ['.source__play', '.source__add']) {
      expect((await p.locator(sel).first().boundingBox())!.height, sel).toBeGreaterThanOrEqual(40)
    }
    await p.locator('.tabs__tab[data-tab="list"]').click()
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await p.waitForTimeout(300)
    expect((await p.locator('.player').boundingBox())!.y).toBeLessThan(10)
    expect((await p.locator('.list__play').first().boundingBox())!.height).toBeGreaterThanOrEqual(40)
  })
})

test.describe('phone tabs', () => {
  test('one section at a time under the pinned player, switched with the bottom bar', async ({ browser }) => {
    const p = await newPage(browser, { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true })
    await createRoom(p)
    const tab = (id: string) => p.locator(`.tabs__tab[data-tab="${id}"]`)
    // Play: the link field and button
    await expect(p.locator('.source__form')).toBeVisible()
    await expect(p.locator('.list')).toBeHidden()
    await expect(p.locator('.room__info')).toBeHidden()
    await playLink(p, media('clip.webm'))
    await expect(tab('list').locator('.tabs__badge')).toHaveText('1')
    // List
    await tab('list').click()
    await expect(p.locator('.list')).toBeVisible()
    await expect(p.locator('.source__form')).toBeHidden()
    // Share
    await tab('share').click()
    await expect(p.getByRole('button', { name: 'File', exact: true })).toBeVisible()
    await expect(p.locator('.list')).toBeHidden()
    // Room: the code and the invite buttons
    await tab('room').click()
    await expect(p.locator('.room__info')).toBeVisible()
    await expect(p.locator('.source')).toBeHidden()
    // the tab bar floats above the bottom edge and does not hide the last element
    const bar = (await p.locator('.tabs__bar').boundingBox())!
    expect(bar.y + bar.height).toBeLessThanOrEqual(800)
    await expect(tab('room')).toHaveAttribute('aria-selected', 'true')
  })

  test('on a computer there is no tab bar and everything is on the page', async ({ browser }) => {
    const p = await newPage(browser)
    await createRoom(p)
    await expect(p.locator('.tabs')).toBeHidden()
    for (const sel of ['.source__form', '.list', '.room__info', '.source__alt']) await expect(p.locator(sel).first()).toBeVisible()
  })

  test('a phone held sideways shows everything and no tab bar', async ({ browser }) => {
    const p = await newPage(browser, { viewport: { width: 800, height: 390 }, isMobile: true, hasTouch: true })
    await createRoom(p)
    await expect(p.locator('.tabs')).toBeHidden()
    for (const sel of ['.source__form', '.list', '.room__info']) await expect(p.locator(sel).first()).toBeVisible()
  })
})

test.describe('hints', () => {
  test('the little i explains on hover and on tap, and the page stays short', async ({ browser }) => {
    const p = await newPage(browser)
    await createRoom(p)
    const hint = p.locator('.hint').first()
    await hint.hover()
    await expect(hint.locator('.hint__tip')).toBeVisible()
    await p.mouse.move(5, 5)
    await expect(hint.locator('.hint__tip')).toBeHidden()
    await hint.locator('.hint__btn').click()
    await expect(hint.locator('.hint__tip')).toBeVisible()
    // the whole control panel fits on a laptop screen without scrolling
    expect((await p.locator('.source').boundingBox())!.height).toBeLessThan(420)
  })
})
