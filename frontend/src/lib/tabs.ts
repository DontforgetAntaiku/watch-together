/** The sections of a room on a phone, in the order a swipe moves through them. */
export const TABS = ['add', 'list', 'share', 'room'] as const
export type Tab = (typeof TABS)[number]
