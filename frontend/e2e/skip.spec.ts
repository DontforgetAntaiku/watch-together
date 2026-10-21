import { expect, test } from '@playwright/test'
import { atEnd, expectSettled, roomWithViewers, seen, setTime, skipBack, skipForward, wake } from './helpers'

test.describe('+10 s / -10 s', () => {
  test('one press moves everybody ten seconds ahead, nobody gets stuck loading', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 3)
    const [a, b, c] = pages
    await expectSettled(pages, { playing: true })
    const before = (await seen(b))!.t
    await skipForward(a)
    await expectSettled(pages, { playing: true })
    for (const p of [a, b, c]) expect((await seen(p))!.t).toBeGreaterThan(before + 8)
  })

  test('the other users can skip too, forward and back', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await setTime(a, 40)
    await expectSettled(pages, { playing: true })
    await skipForward(b)
    await expectSettled(pages, { playing: true })
    expect((await seen(a))!.t).toBeGreaterThan(48)
    await skipBack(b)
    await skipBack(b)
    await expectSettled(pages, { playing: true })
    expect((await seen(a))!.t).toBeLessThan(40)
  })

  test('five quick presses in a row add about fifty seconds and everybody still agrees', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await expectSettled(pages, { playing: true })
    const before = (await seen(a))!.t
    for (let i = 0; i < 5; i++) {
      await skipForward(a)
      await a.waitForTimeout(120)
    }
    await expectSettled(pages, { playing: true })
    expect((await seen(b))!.t).toBeGreaterThan(before + 45)
  })

  test('-10 s at the very start stays at zero (never negative, never stuck)', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await a.evaluate(() => document.querySelector('video')!.pause())
    await setTime(a, 0)
    await expectSettled(pages, { playing: false })
    await skipBack(a)
    await expectSettled(pages, { playing: false })
    expect((await seen(b))!.t).toBeLessThan(0.5)
  })

  test('+10 s while paused moves everybody and keeps them paused', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await a.evaluate(() => document.querySelector('video')!.pause())
    await expectSettled(pages, { playing: false })
    const at = (await seen(b))!.t
    await skipForward(a)
    await expectSettled(pages, { playing: false })
    const after = (await seen(b))!
    expect(after.t).toBeGreaterThan(at + 9)
    expect(after.paused).toBe(true)
  })

  test('+10 s near the end stops at the end for everybody, and then it can be played again', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    const duration = (await seen(a))!.duration
    await setTime(a, duration - 4)
    await skipForward(a)
    await skipForward(a)
    await expect.poll(() => atEnd(b), { timeout: 20_000 }).toBe(true)
    for (const p of pages) expect((await seen(p))!.spinner).toBe(false)
    await setTime(a, 2)
    await a.evaluate(() => void document.querySelector('video')!.play())
    await expectSettled(pages, { playing: true })
  })

  test('keyboard: right arrow +5 s, L +10 s, J -10 s', async ({ browser }) => {
    const { pages } = await roomWithViewers(browser, 2)
    const [a, b] = pages
    await setTime(a, 30)
    await expectSettled(pages, { playing: true })
    await a.locator('body').press('l')
    await expectSettled(pages, { playing: true })
    const afterL = (await seen(b))!.t
    expect(afterL).toBeGreaterThan(38)
    await a.locator('body').press('ArrowRight')
    await expectSettled(pages, { playing: true })
    expect((await seen(b))!.t).toBeGreaterThan(afterL + 4)
    await a.locator('body').press('j')
    await expectSettled(pages, { playing: true })
    expect((await seen(b))!.t).toBeLessThan(afterL + 2)
    await wake(a)
  })
})
