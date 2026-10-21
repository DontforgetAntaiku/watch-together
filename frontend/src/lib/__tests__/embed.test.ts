import { describe, expect, it } from 'vitest'
import { embedFromOffer, embedKey, isSynced, parseEmbed } from '../embed'

describe('parseEmbed', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', { provider: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://youtu.be/aqz-KE-bpKQ?t=30', { provider: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://m.youtube.com/shorts/aqz-KE-bpKQ', { provider: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', { provider: 'youtube', id: 'aqz-KE-bpKQ' }],
    ['https://vimeo.com/76979871', { provider: 'vimeo', id: '76979871', hash: null }],
    ['https://vimeo.com/76979871/abcdef1234', { provider: 'vimeo', id: '76979871', hash: 'abcdef1234' }],
    ['https://player.vimeo.com/video/76979871?h=abcdef1234', { provider: 'vimeo', id: '76979871', hash: 'abcdef1234' }],
    ['https://www.twitch.tv/videos/2902385151', { provider: 'twitch', type: 'video', id: '2902385151' }],
    ['https://www.twitch.tv/Twitch', { provider: 'twitch', type: 'channel', id: 'twitch' }],
    ['https://clips.twitch.tv/FriendlyAmazingSlothFutureMan', { provider: 'twitch', type: 'clip', id: 'FriendlyAmazingSlothFutureMan' }],
    ['https://www.twitch.tv/twitch/clip/FriendlyAmazingSlothFutureMan', { provider: 'twitch', type: 'clip', id: 'FriendlyAmazingSlothFutureMan' }],
    ['https://streamable.com/moo', { provider: 'streamable', id: 'moo' }],
    ['https://streamable.com/e/moo', { provider: 'streamable', id: 'moo' }],
  ])('%s', (url, expected) => {
    expect(parseEmbed(url)).toEqual(expected)
  })

  it.each([
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/feed/subscriptions',
    'https://vimeo.com/channels/staffpicks',
    'https://www.twitch.tv/directory',
    'https://www.twitch.tv/videos/abc',
    'https://streamable.com/login',
    'https://example.com/video.mp4',
    'https://evil.test/https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'not a url',
    '',
  ])('does not treat %s as an embed', (url) => {
    expect(parseEmbed(url)).toBeNull()
  })
})

describe('embed helpers', () => {
  it('only Twitch videos can be synchronised', () => {
    expect(isSynced({ provider: 'twitch', type: 'video', id: '123456' })).toBe(true)
    expect(isSynced({ provider: 'twitch', type: 'channel', id: 'twitch' })).toBe(false)
    expect(isSynced({ provider: 'twitch', type: 'clip', id: 'abcdefgh' })).toBe(false)
    expect(isSynced({ provider: 'youtube', id: 'aqz-KE-bpKQ' })).toBe(true)
  })

  it('names Twitch variants separately for the translations', () => {
    expect(embedKey({ provider: 'twitch', type: 'video', id: '123456' })).toBe('twitch')
    expect(embedKey({ provider: 'twitch', type: 'channel', id: 'abc' })).toBe('twitchLive')
    expect(embedKey({ provider: 'twitch', type: 'clip', id: 'abcdefgh' })).toBe('twitchClip')
  })

  it('rebuilds an embed from what the room sends and refuses nonsense', () => {
    expect(embedFromOffer({ provider: 'vimeo', id: '1', hash: 'abc123' })).toEqual({ provider: 'vimeo', id: '1', hash: 'abc123' })
    expect(embedFromOffer({ provider: 'twitch', id: 'x', type: 'bad' })).toBeNull()
    expect(embedFromOffer({ provider: 'nope', id: 'x' })).toBeNull()
  })
})
