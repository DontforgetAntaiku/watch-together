import { expect, test } from '@playwright/test'
import { atEnd, createRoom, expectSettled, joinRoom, media, newPage, playLink, roomWithViewers, seen, setTime, waitForVideo, wake } from './helpers'

test.describe('changing the time by hand', () => {
  test('seeking on one screen moves everybody', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 3)
    await setTime(pages[1], 61)
    await expectSettled(pages, { playing: true })
    for (const p of pages) expect((await seen(p))!.t).toBeGreaterThan(60)
  })

  test('clicking the seek bar moves everybody', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await wake(a)
    const bar = a.locator('.controls__seek')
    const box = (await bar.boundingBox())!
    await a.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
    await expectSettled(pages, { playing: true })
    const duration = (await seen(b))!.duration
    expect(Math.abs((await seen(b))!.t - duration / 2)).toBeLessThan(5)
  })

  test('seeking by keyboard on the seek bar works too', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await wake(a)
    await a.locator('.controls__seek').focus()
    await a.keyboard.press('End')
    await expect.poll(() => atEnd(b), { timeout: 20_000 }).toBe(true)
  })

  test('seeking while paused moves everybody and keeps the pause', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await a.evaluate(() => document.querySelector('video')!.pause())
    await expectSettled(pages, { playing: false })
    await setTime(b, 70)
    await expectSettled(pages, { playing: false })
    expect((await seen(a))!.t).toBeGreaterThan(69)
    await a.evaluate(() => void document.querySelector('video')!.play())
    await expectSettled(pages, { playing: true })
  })

  test('seeking far past the end or to a negative time is clamped, not stuck', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await setTime(a, 1_000_000)
    await expect.poll(() => atEnd(b), { timeout: 20_000 }).toBe(true)
    await setTime(a, -50)
    await expectSettled(pages)
    expect((await seen(b))!.t).toBeLessThan(2)
  })

  test('fifteen quick random seeks leave everybody together, with no spinner', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 3)
    for (let i = 0; i < 15; i++) {
      await setTime(pages[i % 3], 3 + Math.random() * 80)
      await pages[0].waitForTimeout(80 + Math.random() * 300)
    }
    await expectSettled(pages, { playing: true })
  })

  test('a person who joins in the middle of the seeking catches up', async ({ browser }) => {
    const { pages, code } = await roomWithViewers(browser, 2)
    const late = await newPage(browser)
    await joinRoom(late, code)
    for (let i = 0; i < 5; i++) {
      await setTime(pages[0], 5 + Math.random() * 70)
      await pages[0].waitForTimeout(400)
    }
    await waitForVideo(late)
    await expectSettled([...pages, late], { playing: true })
  })

  test('somebody who opens the room after a long time in the video lands on the right second', async ({ browser }) => {
    const { pages, code } = await roomWithViewers(browser, 1)
    await setTime(pages[0], 55)
    await expectSettled(pages, { playing: true })
    const late = await newPage(browser)
    await joinRoom(late, code)
    await waitForVideo(late)
    await expectSettled([pages[0], late], { playing: true })
    expect((await seen(late))!.t).toBeGreaterThan(54)
  })

  test('pause, play, pause, play: ten quick changes end in one agreed state', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    for (let i = 0; i < 10; i++) {
      await pages[i % 2].evaluate((on) => (on ? void document.querySelector('video')!.play() : document.querySelector('video')!.pause()), i % 2 === 1)
      await pages[0].waitForTimeout(150)
    }
    const states = await Promise.all(pages.map(async (p) => (await seen(p))!.paused))
    await expect.poll(async () => new Set(await Promise.all(pages.map(async (p) => (await seen(p))!.paused))).size, { timeout: 15_000 }).toBe(1)
    expect(states.length).toBe(2)
  })

  test('two people loading two different videos at once still agree on one afterwards', async ({ browser }) => {
    const a = await newPage(browser)
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await Promise.all([playLink(a, media('short1.webm')), playLink(b, media('short2.webm'))])
    await expect
      .poll(async () => new Set((await Promise.all([a, b].map(seen))).map((s) => s?.src)).size, { timeout: 20_000 })
      .toBe(1)
  })
})
