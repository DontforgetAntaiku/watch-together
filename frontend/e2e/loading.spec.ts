import { expect, test } from '@playwright/test'
import { MEDIA_DIR, createRoom, expectSettled, joinRoom, media, newPage, playLink, roomWithViewers, seen, setTime, throttle, waitForVideo } from './helpers'

test.describe('nobody is left loading forever', () => {
  test('a slow connection makes the room wait instead of chasing it (the old infinite loading)', async ({ browser }) => {
    test.setTimeout(150_000)
    const a = await newPage(browser)
    const code = await createRoom(a)
    const slowContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const b = await slowContext.newPage()
    await joinRoom(b, code)
    await throttle(slowContext, b, 1500) // about a third of what the video needs
    await playLink(a, media('big.webm'))
    await expect.poll(async () => (await seen(b))?.readyState ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
    await b.evaluate(() => {
      const w = window as unknown as { __seeks: number }
      w.__seeks = 0
      document.querySelector('video')!.addEventListener('seeking', () => w.__seeks++)
    })
    await a.evaluate(() => void document.querySelector('video')!.play())

    // Over 25 seconds the slow person must not be dragged around by corrective seeks, A must be told to wait,
    // and they must keep moving together.
    let sawWaiting = false
    const together: number[] = []
    for (let i = 0; i < 10; i++) {
      await a.waitForTimeout(2500)
      if (await a.locator('.vp__wait').count()) sawWaiting = true
      const [sa, sb] = [await seen(a), await seen(b)]
      together.push(Math.abs(sa!.t - sb!.t))
    }
    const seeks = await b.evaluate(() => (window as unknown as { __seeks: number }).__seeks)
    expect(seeks, 'the slow player must not chase the room with a seek every few seconds').toBeLessThanOrEqual(8)
    expect(sawWaiting, 'the fast user should see that the room is waiting').toBe(true)
    expect(Math.max(...together), 'both stay at (almost) the same moment').toBeLessThan(4)
    expect((await seen(b))!.t, 'the slow user did get to watch something').toBeGreaterThan(2)
  })

  test('once the connection is fine again, everybody settles and no spinner remains', async ({ browser }) => {
    test.setTimeout(150_000)
    const a = await newPage(browser)
    const code = await createRoom(a)
    const slowContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const b = await slowContext.newPage()
    await joinRoom(b, code)
    const cdp = await throttle(slowContext, b, 1500)
    await playLink(a, media('big.webm'))
    await expect.poll(async () => (await seen(a))?.readyState ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
    await a.evaluate(() => void document.querySelector('video')!.play())
    await a.waitForTimeout(8000)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await expectSettled([a, b], { within: 60_000, tolerance: 2.5, playing: true })
  })

  test('a slow person who joins late does not stop the others from watching', async ({ browser }) => {
    test.setTimeout(150_000)
    const { pages, code } = await roomWithViewers(browser, 2, 'big.webm')
    const slowContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const c = await slowContext.newPage()
    await throttle(slowContext, c, 1200)
    await joinRoom(c, code)
    await setTime(pages[0], 20)
    // Whatever the slow user does, after a while the room moves again (the hold has a limit) and nobody is frozen forever.
    await expect
      .poll(async () => (await seen(pages[1]))!.t, { timeout: 60_000, intervals: [2000] })
      .toBeGreaterThan(21)
    for (const p of pages) expect((await seen(p))!.spinner).toBe(false)
  })

  test('a short loss of the network does not break the room', async ({ browser }) => {
    test.setTimeout(120_000)
    const a = await newPage(browser)
    const code = await createRoom(a)
    const bContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const b = await bContext.newPage()
    await joinRoom(b, code)
    await playLink(a, media('clip.webm'))
    for (const p of [a, b]) await waitForVideo(p)
    await a.evaluate(() => void document.querySelector('video')!.play())
    await expectSettled([a, b], { playing: true })
    await bContext.setOffline(true)
    await b.waitForTimeout(4000)
    await bContext.setOffline(false)
    await setTime(a, 45)
    await expectSettled([a, b], { within: 45_000, playing: true })
    expect((await seen(b))!.t).toBeGreaterThan(44)
  })

  test('opening a video that does not exist shows a message, never a spinner', async ({ browser }) => {
    const a = await newPage(browser)
    await createRoom(a)
    await playLink(a, media('does-not-exist.webm'))
    await expect(a.locator('.player__empty-title, .vp__error')).toBeVisible({ timeout: 30_000 })
    await expect(a.locator('.vp__spinner')).toHaveCount(0)
  })

  test('different cuts of the same film are noticed', async ({ browser }) => {
    const a = await newPage(browser)
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await playLink(a, media('clip.webm'))
    await waitForVideo(a)
    await waitForVideo(b)
    await expect(a.locator('.room__warn')).toHaveCount(0)
    // B opens a different, shorter file on their own device
    await b.locator('#video-file').setInputFiles(`${MEDIA_DIR}/short1.webm`)
    await expect(a.locator('.room__warn')).toBeVisible({ timeout: 20_000 })
    await expect(b.locator('.room__warn')).toBeVisible()
  })
})
