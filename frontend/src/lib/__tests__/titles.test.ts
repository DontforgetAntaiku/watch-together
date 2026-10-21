import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTitle } from '../titles'

const answer = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) })
afterEach(() => vi.unstubAllGlobals())

describe('fetchTitle', () => {
  it('asks YouTube with the canonical address and cleans the title', async () => {
    const fetchMock = answer({ title: '  A   film\nabout   things ' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchTitle('https://youtu.be/aqz-KE-bpKQ?t=10')).toBe('A film about things')
    expect(String(fetchMock.mock.calls[0][0])).toContain('youtube.com/oembed')
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain('watch?v=aqz-KE-bpKQ')
  })

  it('knows Vimeo, Streamable and Dailymotion', async () => {
    vi.stubGlobal('fetch', answer({ title: 'T' }))
    expect(await fetchTitle('https://vimeo.com/76979871')).toBe('T')
    expect(await fetchTitle('https://streamable.com/moo')).toBe('T')
    expect(await fetchTitle('https://www.dailymotion.com/video/x8wbmts')).toBe('T')
    expect(await fetchTitle('https://dai.ly/x8wbmts')).toBe('T')
  })

  it('has no answer for what cannot be asked, without calling anything', async () => {
    const fetchMock = answer({ title: 'never' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchTitle('https://www.twitch.tv/videos/2902385151')).toBeNull()
    expect(await fetchTitle('https://host.test/film.mp4')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws: errors, bad answers and empty titles are just null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchTitle('https://youtu.be/aqz-KE-bpKQ')).toBeNull()
    vi.stubGlobal('fetch', answer({}, false))
    expect(await fetchTitle('https://youtu.be/aqz-KE-bpKQ')).toBeNull()
    vi.stubGlobal('fetch', answer({ title: '   ' }))
    expect(await fetchTitle('https://youtu.be/aqz-KE-bpKQ')).toBeNull()
    vi.stubGlobal('fetch', answer({ title: 42 }))
    expect(await fetchTitle('https://youtu.be/aqz-KE-bpKQ')).toBeNull()
  })

  it('cuts a very long title', async () => {
    vi.stubGlobal('fetch', answer({ title: 'x'.repeat(500) }))
    expect((await fetchTitle('https://youtu.be/aqz-KE-bpKQ'))!.length).toBe(200)
  })
})
