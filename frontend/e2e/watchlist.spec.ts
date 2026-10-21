import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createRoom, expectSettled, joinRoom, media, newPage, playLink, roomWithViewers, seen, waitForVideo } from './helpers'

const names = (p: Page) => p.locator('.list__name').allInnerTexts()
const add = async (p: Page, url: string) => {
  await p.locator('#video-url').fill(url)
  await p.getByRole('button', { name: 'Add to the watch list' }).click()
}

test.describe('watch list', () => {
  test('Play starts the link for everybody and puts it in the list', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'short1.webm')
    for (const p of pages) expect(await names(p)).toEqual(['short1'])
    await expect(pages[1].locator('.list__item[data-playing="true"]')).toHaveCount(1)
  })

  test('adding does not interrupt what is playing; anyone can add; everybody sees it', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    await add(pages[1], media('short1.webm'))
    await expect.poll(() => names(pages[0])).toEqual(['clip', 'short1'])
    expect((await seen(pages[0]))!.src).toBe('clip.webm')
    await expectSettled(pages, { playing: true })
  })

  test('the room plays the next video by itself when one ends', async ({ browser }) => {
    // The list is set up first and only then started, so the short first video cannot end before the second is queued.
    const a = await newPage(browser)
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await add(a, media('short1.webm'))
    await add(a, media('short2.webm'))
    await expect.poll(() => names(b)).toEqual(['short1', 'short2'])
    await a.locator('.list__item >> nth=0 >> .list__play').click()
    for (const p of [a, b]) await expect.poll(async () => (await seen(p))?.src, { timeout: 30_000 }).toBe('short1.webm')
    for (const p of [a, b]) await expect.poll(async () => (await seen(p))?.src, { timeout: 30_000 }).toBe('short2.webm')
    await expectSettled([a, b], { playing: true })
    // the last one simply ends: nothing is skipped, nobody is stuck
    await expect.poll(async () => (await seen(b))!.ended, { timeout: 30_000 }).toBe(true)
    expect((await seen(a))!.src).toBe('short2.webm')
  })

  test('clicking an item plays it for everybody from the start', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    await add(pages[0], media('short2.webm'))
    await expect.poll(() => names(pages[1])).toHaveLength(2)
    await pages[1].locator('.list__item >> nth=1 >> .list__play').click()
    for (const p of pages) await expect.poll(async () => (await seen(p))?.src, { timeout: 20_000 }).toBe('short2.webm')
    await expectSettled(pages, { playing: true })
    expect((await seen(pages[0]))!.t).toBeLessThan(6)
  })

  test('moving and removing items', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    await add(pages[0], media('short1.webm'))
    await add(pages[0], media('short2.webm'))
    await expect.poll(() => names(pages[1])).toEqual(['clip', 'short1', 'short2'])
    await pages[1].locator('.list__item >> nth=2 >> button[aria-label^="Move"]').click()
    await expect.poll(() => names(pages[0])).toEqual(['clip', 'short2', 'short1'])
    await pages[0].locator('.list__item >> nth=1 >> button[aria-label^="Remove"]').click()
    await expect.poll(() => names(pages[1])).toEqual(['clip', 'short1'])
    // removing what is playing lets it finish; it is just no longer listed
    await pages[1].locator('.list__item >> nth=0 >> button[aria-label^="Remove"]').click()
    await expect.poll(() => names(pages[0])).toEqual(['short1'])
    expect((await seen(pages[0]))!.src).toBe('clip.webm')
    await expectSettled(pages, { playing: true })
  })

  test('the same link twice is one entry', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 1, 'short1.webm')
    await add(pages[0], media('short1.webm'))
    await add(pages[0], media('short1.webm'))
    await pages[0].waitForTimeout(500)
    expect(await names(pages[0])).toEqual(['short1'])
  })

  test('someone who joins later gets the list and the current video', async ({ browser }) => {
    const { pages, code } = await roomWithViewers(browser, 1, 'clip.webm')
    await add(pages[0], media('short1.webm'))
    const late = await newPage(browser)
    await joinRoom(late, code)
    await expect.poll(() => names(late)).toEqual(['clip', 'short1'])
    await waitForVideo(late)
    await expectSettled([pages[0], late], { playing: true })
  })

  test('typing rubbish says so and does nothing', async ({ browser }) => {
    const a = await newPage(browser)
    await createRoom(a)
    for (const bad of ['not a link at all', 'javascript:alert(1)', 'ftp://x.test/y']) {
      await a.locator('#video-url').fill(bad)
      await a.locator('.source__play').click()
      await expect(a.locator('.source__notice')).toBeVisible()
    }
    expect(await names(a)).toEqual([])
  })

  test('a link typed without https:// is accepted (https is added), a typo is refused', async ({ browser }) => {
    const a = await newPage(browser)
    await createRoom(a)
    await playLink(a, 'example.com/some/film.mp4')
    await expect.poll(() => names(a)).toEqual(['film'])
    await expect(a.locator('.source__notice')).toHaveCount(0)
    await a.locator('#video-url').fill('example')
    await a.locator('.source__play').click()
    await expect(a.locator('.source__notice')).toBeVisible()
  })

  test('the list survives a reload of the page (it lives in the room)', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    await add(pages[1], media('short1.webm'))
    await pages[0].reload()
    await expect.poll(() => names(pages[0])).toEqual(['clip', 'short1'])
    await waitForVideo(pages[0])
    await playLink(pages[1], media('short2.webm'))
    for (const p of pages) await expect.poll(async () => (await seen(p))?.src, { timeout: 20_000 }).toBe('short2.webm')
  })

  test('a link nobody has played gets its real title, and everybody sees it', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2, 'clip.webm')
    await pages[0].context().route('https://www.youtube.com/oembed**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ title: 'Big Buck Bunny' }) }),
    )
    await add(pages[0], 'https://youtu.be/aqz-KE-bpKQ')
    // before the answer it is named after the platform, never just "youtube.com"
    await expect.poll(() => names(pages[1])).toHaveLength(2)
    for (const p of pages) await expect.poll(() => names(p), { timeout: 15_000 }).toEqual(['clip', 'Big Buck Bunny'])
    await expect(pages[1].locator('.list__host').nth(1)).toHaveText('youtu.be')
  })

  test('a title that cannot be fetched leaves a readable name, not a bare address', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 1, 'clip.webm')
    await pages[0].context().route('https://www.youtube.com/oembed**', (route) => route.abort())
    await add(pages[0], 'https://youtu.be/aqz-KE-bpKQ')
    await expect.poll(() => names(pages[0])).toEqual(['clip', 'YouTube video'])
  })

  for (const [label, size] of [['a computer', { width: 1280, height: 800 }], ['a small phone', { width: 320, height: 640 }]] as const) {
    test(`very long titles wrap and never push the buttons out of the row (${label})`, async ({ browser }) => {
      const long = 'ВОТ ЧТО БУДЕТ ЕСЛИ УБРАТЬ ПОРЯДОК ИЗ ВСЕЛЕННОЙ И ПОСМОТРЕТЬ НА ЭТО ВСЕ ВМЕСТЕ С ДРУЗЬЯМИ ' + 'LONGWORDWITHOUTANYSPACESINIT'.repeat(3)
      const a = await newPage(browser, { viewport: size, isMobile: size.width < 500, hasTouch: size.width < 500 })
      await a.context().route('https://www.youtube.com/oembed**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ title: long }) }),
      )
      await createRoom(a)
      await playLink(a, media('clip.webm'))
      await add(a, 'https://youtu.be/aqz-KE-bpKQ')
      await add(a, 'https://youtu.be/dQw4w9WgXcQ')
      if (size.width < 500) await a.locator('.tabs__tab[data-tab="list"]').click()
      await expect.poll(async () => (await names(a)).filter((n) => n.length > 100).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
      const fits = await a.evaluate(() => {
        const list = document.querySelector('.list__items') as HTMLElement
        const box = list.getBoundingClientRect()
        const problems: string[] = []
        if (list.scrollWidth > list.clientWidth + 1) problems.push(`the list scrolls sideways: ${list.scrollWidth} > ${list.clientWidth}`)
        for (const item of document.querySelectorAll('.list__item')) {
          const r = item.getBoundingClientRect()
          const last = item.querySelector('.list__icon:last-of-type')?.getBoundingClientRect()
          if (r.right > box.right + 1) problems.push('a row is wider than the list')
          if (!last || last.right > r.right + 1 || last.left < r.left) problems.push('the remove button is outside its row')
          const name = item.querySelector('.list__name') as HTMLElement
          if (name.getBoundingClientRect().height > 60) problems.push(`a title is more than two lines (${name.getBoundingClientRect().height}px)`)
        }
        if (document.documentElement.scrollWidth > innerWidth) problems.push('the page scrolls sideways')
        return problems
      })
      expect(fits).toEqual([])
      // and the button really is clickable: it removes the entry
      await a.locator('.list__item >> nth=1 >> button[aria-label^="Remove"]').click()
      await expect.poll(async () => (await names(a)).length).toBe(2)
    })
  }
})
