export type Source =
  | { kind: 'url'; url: string; label: string }
  | { kind: 'file'; url: string; label: string }

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}
