import { describe, expect, it } from 'vitest'
import { normalizeUrl } from '../url'

describe('normalizeUrl', () => {
  it('adds https when it was left off and trims', () => {
    expect(normalizeUrl('  youtube.com/watch?v=aqz-KE-bpKQ ')).toBe('https://youtube.com/watch?v=aqz-KE-bpKQ')
    expect(normalizeUrl('http://host.test/a.mp4')).toBe('http://host.test/a.mp4')
  })
  it.each(['', '   ', 'not a link at all', 'javascript:alert(1)', 'ftp://x.test/y', 'file:///etc/passwd', 'data:text/html,hi', 'https://', 'justoneword'])('refuses %j', (raw) => {
    expect(normalizeUrl(raw)).toBeNull()
  })
  it('refuses an address too long for the watch list', () => {
    expect(normalizeUrl('https://host.test/' + 'a'.repeat(1600))).toBeNull()
  })
})
