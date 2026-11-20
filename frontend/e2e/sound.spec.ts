import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createRoom, joinRoom, newPage } from './helpers'

// Headless Chromium has no screen picker: a drawing canvas stands in for the shared tab, without any sound of its own.
const silentTab = () => {
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

/** The loudest sample that reaches this page's shared video over a few seconds. */
const loudest = (p: Page, ms = 4000) =>
  p.evaluate(async (time) => {
    const stream = (document.querySelector('video') as HTMLVideoElement).srcObject as MediaStream
    if (!stream || stream.getAudioTracks().length === 0) return -1
    const ctx = new AudioContext()
    await ctx.resume()
    const analyser = ctx.createAnalyser()
    ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser)
    const data = new Float32Array(analyser.fftSize)
    let peak = 0
    const end = Date.now() + time
    while (Date.now() < end) {
      analyser.getFloatTimeDomainData(data)
      for (const v of data) peak = Math.max(peak, Math.abs(v))
      await new Promise((r) => setTimeout(r, 40))
    }
    return peak
  }, ms)

const live = (p: Page) => p.evaluate(() => { const v = document.querySelector('video'); return !!v && !!v.srcObject && v.videoWidth > 0 && !v.paused })

test.describe('sound from a device (a microphone, or "Monitor of …") in a shared tab', () => {
  test('a viewer hears the microphone, and nothing warns the sharer', async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(silentTab)
    const a = await ctx.newPage()
    const code = await createRoom(a)
    const b = await newPage(browser)
    await joinRoom(b, code)
    await a.getByRole('button', { name: 'Tab', exact: true }).click()
    await expect.poll(() => live(b), { timeout: 45_000 }).toBe(true)
    // the picked tab has no sound: the viewer's stream is silent so far
    expect(await loudest(b, 1500)).toBeLessThan(0.003)

    await a.getByRole('button', { name: 'Choose a sound input' }).click()
    await expect(a.locator('#sound-device')).toBeVisible()
    await a.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(a.locator('.sound__on')).toBeVisible()
    expect(await loudest(b, 5000)).toBeGreaterThan(0.01)
    await expect(a.locator('.sound__error')).toHaveCount(0)
    // taking it away makes the share silent again
    await a.getByRole('button', { name: 'Remove' }).click()
    await a.waitForTimeout(1000)
    expect(await loudest(b, 1500)).toBeLessThan(0.003)
  })

  test('an input that is muted gets a warning instead of silent sharing', async ({ browser }) => {
    test.setTimeout(90_000)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(silentTab)
    await ctx.addInitScript(() => {
      const md = navigator.mediaDevices
      const real = md.getUserMedia.bind(md)
      md.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'mute', label: 'Muted microphone', groupId: 'g' } as MediaDeviceInfo]
      md.getUserMedia = async (c) => {
        if (typeof c?.audio === 'object' && (c.audio as MediaTrackConstraints).deviceId) {
          const x = new AudioContext()
          return x.createMediaStreamDestination().stream // a track that carries nothing
        }
        return real(c)
      }
    })
    const a = await ctx.newPage()
    await createRoom(a)
    await a.getByRole('button', { name: 'Tab', exact: true }).click()
    await a.getByRole('button', { name: 'Choose a sound input' }).click()
    await a.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(a.locator('.sound__error')).toContainText('silent', { timeout: 10_000 })
  })

  test('the device list is our own dropdown: mouse, keyboard, Escape, outside click', async ({ browser }) => {
    test.setTimeout(90_000)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(silentTab)
    await ctx.addInitScript(() => {
      const md = navigator.mediaDevices
      md.enumerateDevices = async () =>
        ['Monitor of Speakers', 'Built-in Microphone', 'USB Headset'].map((label, i) => ({ kind: 'audioinput', deviceId: `d${i}`, label, groupId: 'g' }) as MediaDeviceInfo)
    })
    const a = await ctx.newPage()
    await createRoom(a)
    await a.getByRole('button', { name: 'Tab', exact: true }).click()
    await a.getByRole('button', { name: 'Choose a sound input' }).click()
    const box = a.locator('#sound-device')
    expect(await a.locator('select').count()).toBe(0) // never the browser's own popup
    await expect(box).toHaveText('Monitor of Speakers') // the "Monitor of …" input is preferred
    await box.click()
    await expect(a.getByRole('listbox')).toBeVisible()
    await expect(a.getByRole('option')).toHaveText(['Monitor of Speakers', 'Built-in Microphone', 'USB Headset'])
    await a.getByRole('option', { name: 'USB Headset' }).click()
    await expect(a.getByRole('listbox')).toHaveCount(0)
    await expect(box).toHaveText('USB Headset')
    await box.focus()
    await a.keyboard.press('ArrowDown') // opens
    await a.keyboard.press('Home')
    await a.keyboard.press('ArrowDown')
    await a.keyboard.press('Enter')
    await expect(box).toHaveText('Built-in Microphone')
    await a.keyboard.press('Enter')
    await a.keyboard.type('us') // type-ahead
    await expect(a.locator('.select__option[data-active]')).toHaveText('USB Headset')
    await a.keyboard.press('Escape')
    await expect(a.getByRole('listbox')).toHaveCount(0)
    await expect(box).toHaveText('Built-in Microphone')
    await box.click()
    await a.locator('.sound__title').click() // outside click
    await expect(a.getByRole('listbox')).toHaveCount(0)
  })
})
