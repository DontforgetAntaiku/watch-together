import { describe, expect, it } from 'vitest'
import { exportList, parseList } from '../listfile'
import { isPlaylistUrl, splitLinks } from '../url'

describe('saved watch list', () => {
  it('round-trips through the file', () => {
    const items = [
      { url: 'https://youtu.be/abcdefghijk', title: 'One' },
      { url: 'https://x.example/b.mp4', title: null },
    ]
    expect(parseList(exportList(items))).toEqual([{ url: 'https://youtu.be/abcdefghijk', title: 'One' }, { url: 'https://x.example/b.mp4' }])
  })

  it('reads a plain list of links, a bare JSON array and ignores junk', () => {
    expect(parseList('https://a.example/1\n\n  b.example/2  \nnot a link\njavascript:alert(1)\nhttps://a.example/1')).toEqual([
      { url: 'https://a.example/1' },
      { url: 'https://b.example/2' },
    ])
    expect(parseList('["https://a.example/1", 5, {"url": "https://a.example/2", "title": "  Two "}, {"title": "x"}]')).toEqual([
      { url: 'https://a.example/1' },
      { url: 'https://a.example/2', title: 'Two' },
    ])
    expect(parseList('{"items": "no"}')).toEqual([])
    expect(parseList('')).toEqual([])
  })

  it('keeps at most 50 links', () => {
    const lines = Array.from({ length: 80 }, (_, i) => `https://a.example/${i}`).join('\n')
    expect(parseList(lines)).toHaveLength(50)
  })
})

describe('pasted links', () => {
  it('splits several links and drops repeats and junk', () => {
    expect(splitLinks('https://a.example/1  b.example/2\nhttps://a.example/1 nonsense')).toEqual(['https://a.example/1', 'https://b.example/2'])
    expect(splitLinks('')).toEqual([])
  })

  it('knows a playlist page from a video', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PL123')).toBe(true)
    expect(isPlaylistUrl('https://youtube.com/playlist?list=PL123')).toBe(true)
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=abcdefghijk&list=PL123')).toBe(false)
    expect(isPlaylistUrl('https://example.com/playlist?list=1')).toBe(false)
    expect(isPlaylistUrl('nonsense')).toBe(false)
  })
})
