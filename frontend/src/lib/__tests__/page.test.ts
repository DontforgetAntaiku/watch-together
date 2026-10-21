import { describe, expect, it } from 'vitest'
import type { Resolved } from '../api'
import { fromResolved, lookupFailed, pickQuality, startPage, stepDown, toResolving } from '../page'

const resolved = (over: Partial<Resolved> = {}): Resolved => ({
  title: 'Film',
  url: 'https://cdn/1080.mp4',
  protocol: 'https',
  height: 1080,
  duration: 60,
  needsHeaders: false,
  audioUrl: 'https://cdn/a.m4a',
  fallbackUrl: 'https://cdn/small.mp4',
  options: [
    { height: 1080, url: 'https://cdn/1080.mp4', audioUrl: 'https://cdn/a.m4a', protocol: 'https' },
    { height: 720, url: 'https://cdn/720.mp4', audioUrl: null, protocol: 'https' },
    { height: 360, url: 'https://cdn/360.mp4', audioUrl: null, protocol: 'https' },
  ],
  ...over,
})

describe('how a link is played', () => {
  it('a platform page starts in its embedded player, anything else as a plain video', () => {
    expect(startPage('https://youtu.be/aqz-KE-bpKQ').how).toBe('embed')
    expect(startPage('https://host.test/clip.mp4').how).toBe('direct')
    expect(startPage('https://host.test/page.html', 'abcd1234', 'Title')).toMatchObject({ item: 'abcd1234', label: 'Title', tried: false })
  })

  it('a lookup result replaces the way and remembers that the lookup was tried', () => {
    const page = fromResolved(toResolving(startPage('https://host.test/page')), resolved())
    expect(page).toMatchObject({ how: 'resolved', tried: true, label: 'Film' })
    expect(page.media).toMatchObject({ url: 'https://cdn/1080.mp4', audioUrl: 'https://cdn/a.m4a', quality: 1080 })
  })

  it('no quality menu data when there is only one choice', () => {
    const page = fromResolved(startPage('https://host.test/page'), resolved({ options: [] }))
    expect(page.media?.options).toBeUndefined()
    expect(page.media?.quality).toBeUndefined()
  })

  it('a failed lookup goes back to the previous way with the reason', () => {
    const page = lookupFailed(toResolving(startPage('https://youtu.be/aqz-KE-bpKQ')), 'nope')
    expect(page).toMatchObject({ how: 'embed', tried: true, failed: 'nope' })
    expect(lookupFailed(toResolving(startPage('https://host.test/x')), 'nope').how).toBe('direct')
  })

  it('picking a quality swaps the addresses, ignoring unknown heights', () => {
    const page = fromResolved(startPage('https://host.test/page'), resolved())
    const picked = pickQuality(page, 720)
    expect(picked.media).toMatchObject({ url: 'https://cdn/720.mp4', audioUrl: undefined, quality: 720 })
    expect(pickQuality(page, 123)).toBe(page)
  })

  it('a quality that fails steps down one by one, then to the single file, then gives up', () => {
    let page = fromResolved(startPage('https://host.test/page'), resolved())
    page = stepDown(page)!
    expect(page.media).toMatchObject({ quality: 720 })
    page = stepDown(page)!
    expect(page.media).toMatchObject({ quality: 360 })
    page = stepDown(page)!
    expect(page.media).toEqual({ url: 'https://cdn/small.mp4' })
    expect(stepDown(page)).toBeNull()
  })
})
