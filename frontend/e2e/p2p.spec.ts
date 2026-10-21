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
})
