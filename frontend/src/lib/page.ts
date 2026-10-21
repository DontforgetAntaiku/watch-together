import type { Resolved } from './api'
import { parseEmbed } from './embed'
import type { Embed } from './embed'

/** What a lookup found, as kept locally: this is per person, the room only shares the page address. */
export type Media = {
  url: string
  audioUrl?: string
  fallbackUrl?: string
  /** The resolutions to choose from, and the chosen height. */
  options?: { height: number; url: string; audioUrl?: string }[]
  quality?: number
}

/**
 * A link the whole room plays. Everybody loads it themselves, and each tries the ways in this order:
 * the platform's embedded player, then the address itself as a video, then (when the server offers it) a lookup.
 */
export type PageSource = {
  kind: 'page'
  /** The address everybody in the room was given. */
  url: string
  /** Its entry in the watch list, if it has one. */
  item?: string
  /** A real title, when one is known (otherwise the name is worked out when it is shown, in the current language). */
  label?: string
  how: 'embed' | 'direct' | 'resolving' | 'resolved'
  embed?: Embed
  media?: Media
  /** The lookup has been tried (or is running), so it is not tried again by itself. */
  tried: boolean
  /** Nothing worked: the reason, for the person to read. */
  failed?: string
}

export function startPage(url: string, item?: string, title?: string | null): PageSource {
  const embed = parseEmbed(url)
  return {
    kind: 'page',
    url,
    item,
    label: title || undefined,
    how: embed ? 'embed' : 'direct',
    embed: embed ?? undefined,
    tried: false,
  }
}

export function toResolving(page: PageSource): PageSource {
  return { ...page, how: 'resolving', tried: true, failed: undefined }
}

export function fromResolved(page: PageSource, res: Resolved): PageSource {
  const options = res.options?.length ? res.options.map((o) => ({ height: o.height, url: o.url, audioUrl: o.audioUrl ?? undefined })) : undefined
  return {
    ...page,
    how: 'resolved',
    tried: true,
    failed: undefined,
    label: res.title || page.label,
    media: {
      url: res.url,
      audioUrl: res.audioUrl ?? undefined,
      fallbackUrl: res.fallbackUrl ?? undefined,
      options,
      quality: options ? (res.height ?? undefined) : undefined,
    },
  }
}

/** The lookup failed: go back to what was showing, with the reason. */
export function lookupFailed(page: PageSource, message: string): PageSource {
  return { ...page, how: page.embed ? 'embed' : 'direct', tried: true, failed: message }
}

export function pickQuality(page: PageSource, height: number): PageSource {
  const option = page.media?.options?.find((o) => o.height === height)
  if (!page.media || !option) return page
  return { ...page, media: { ...page.media, url: option.url, audioUrl: option.audioUrl, quality: option.height } }
}

/** Something in the chosen resolution did not load: the next lower one, else the single-file fallback, else nothing. */
export function stepDown(page: PageSource): PageSource | null {
  const media = page.media
  if (!media) return null
  const options = media.options ?? []
  const at = options.findIndex((o) => o.url === media.url)
  const next = at >= 0 ? options[at + 1] : undefined
  if (next) return { ...page, media: { ...media, url: next.url, audioUrl: next.audioUrl, quality: next.height } }
  if (media.fallbackUrl) return { ...page, media: { url: media.fallbackUrl } }
  return null
}

/** The same video as far as the room is concerned: starting it again would only restart it. */
export const samePage = (a: PageSource | { kind: string }, url: string, item?: string) => a.kind === 'page' && (a as PageSource).url === url && (a as PageSource).item === item
