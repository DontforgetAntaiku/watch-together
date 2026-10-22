import { expect, test } from '@playwright/test'
import { MEDIA_DIR, createRoom, expectSettled, joinRoom, newPage, seen, wake } from './helpers'

test.describe('sharing a file with the room', () => {
  test('a shared file reaches the other person, and their pause and skip drive the sharer', async ({ browser }) => {
    test.setTimeout(120_000)
    const a = await newPage(browser)
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await a.locator('#video-file').setInputFiles(`${MEDIA_DIR}/clip.webm`)
    await expect.poll(async () => (await seen(a))?.readyState ?? 0).toBeGreaterThanOrEqual(2)
    await a.evaluate(() => void document.querySelector('video')!.play())
    await a.getByRole('button', { name: 'Share this file' }).click()

    // B watches the stream without clicking anything
    await expect
      .poll(() => b.evaluate(() => { const v = document.querySelector('video'); return !!v && !!v.srcObject && v.videoWidth > 0 && v.currentTime > 0.5 }), { timeout: 45_000 })
      .toBe(true)
    await expect(a.getByText('1 person is watching')).toBeVisible()

    await wake(b)
    await b.getByRole('button', { name: 'Pause' }).first().click({ force: true })
    await expect.poll(async () => (await seen(a))!.paused, { timeout: 15_000 }).toBe(true)
    await b.locator('.controls__row-skip[aria-label="Forward 10 seconds"]').click({ force: true })
    await expect.poll(async () => (await seen(a))!.t, { timeout: 15_000 }).toBeGreaterThan(9)
    await b.getByRole('button', { name: 'Play' }).first().click({ force: true })
    await expect.poll(async () => (await seen(a))!.paused, { timeout: 15_000 }).toBe(false)
    await expectSettled([a], { playing: true })
  })

  test('the viewer of a paused share never sees a spinner', async ({ browser }) => {
    test.setTimeout(120_000)
    const a = await newPage(browser)
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await a.locator('#video-file').setInputFiles(`${MEDIA_DIR}/clip.webm`)
    await expect.poll(async () => (await seen(a))?.readyState ?? 0).toBeGreaterThanOrEqual(2)
    await a.evaluate(() => void document.querySelector('video')!.play())
    await a.getByRole('button', { name: 'Share this file' }).click()
    await expect.poll(() => b.evaluate(() => !!document.querySelector('video')?.srcObject)).toBe(true)
    await a.evaluate(() => document.querySelector('video')!.pause())
    await b.waitForTimeout(5000)
    await expect(b.locator('.vp__spinner')).toHaveCount(0)
  })

  test('a viewer pauses a shared tab: everybody freezes and the sharer is told to pause too', async ({ browser }) => {
    test.setTimeout(120_000)
    // headless Chromium has no screen picker: a drawing canvas stands in for the shared tab (and its sound is a tone)
    const stub = () => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement('canvas')
        c.width = 320
        c.height = 180
        const g = c.getContext('2d')!
        let n = 0
        setInterval(() => {
          g.fillStyle = `hsl(${(n++ * 7) % 360},80%,50%)`
          g.fillRect(0, 0, 320, 180)
        }, 50)
        return c.captureStream(15)
      }
    }
    const sharerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await sharerContext.addInitScript(stub)
    // count the notes the page plays: a sound cue is exactly what a sharer in another tab relies on
    await sharerContext.addInitScript(() => {
      const w = window as unknown as { __notes: number }
      w.__notes = 0
      const make = AudioContext.prototype.createOscillator
      AudioContext.prototype.createOscillator = function (this: AudioContext) {
        w.__notes++
        return make.call(this)
      }
    })
    const notes = (p: typeof a) => p.evaluate(() => (window as unknown as { __notes: number }).__notes)
    const a = await sharerContext.newPage()
    const code = await createRoom(a)
    const b = await newPage(browser)
    const c = await newPage(browser)
    await joinRoom(b, code)
    await joinRoom(c, code)
    await a.getByRole('button', { name: 'Tab', exact: true }).click()
    const live = (p: typeof a) => p.evaluate(() => { const v = document.querySelector('video'); return !!v && !!v.srcObject && v.videoWidth > 0 && !v.paused })
    for (const p of [b, c]) await expect.poll(() => live(p), { timeout: 45_000 }).toBe(true)
    await expect(a.locator('.player__empty[data-paused="true"]')).toHaveCount(0)

    // B presses pause
    await wake(b)
    await b.getByRole('button', { name: 'Pause' }).first().click({ force: true })
    for (const p of [b, c]) await expect.poll(() => p.evaluate(() => document.querySelector('video')!.paused), { timeout: 15_000 }).toBe(true)
    await expect(a.locator('.player__empty[data-paused="true"]')).toBeVisible()
    await expect(a.locator('.player__empty-title')).toHaveText('Someone paused your share')
    await expect.poll(() => a.title()).toContain('⏸')
    await expect(b.locator('.controls__live')).toHaveText('PAUSED')
    // the sound: a three-note alert right away, and again while the share stays paused
    await expect.poll(() => notes(a), { timeout: 5_000 }).toBeGreaterThanOrEqual(3)
    await expect.poll(() => notes(a), { timeout: 12_000 }).toBeGreaterThanOrEqual(6)

    // C presses play: everybody is live again and the sharer's warning goes away
    await wake(c)
    await c.getByRole('button', { name: 'Play' }).first().click({ force: true })
    for (const p of [b, c]) await expect.poll(() => live(p), { timeout: 20_000 }).toBe(true)
    await expect(a.locator('.player__empty[data-paused="true"]')).toHaveCount(0)
    await expect.poll(() => a.title()).not.toContain('⏸')
    await expect(b.locator('.controls__live')).toHaveText('LIVE')
    // resuming plays a short cue once, and then the alert stops for good
    await expect.poll(() => notes(a)).toBeGreaterThanOrEqual(8)
    const after = await notes(a)
    await a.waitForTimeout(7000)
    expect(await notes(a)).toBe(after)
  })
})
