import { go } from '../../lib/router'

export function Logo() {
  return (
    <a
      href="/"
      onClick={(e) => {
        e.preventDefault()
        go('/')
      }}
      className="inline-flex min-h-11 items-center gap-2 text-lg font-bold tracking-tight text-ink no-underline"
    >
      <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="var(--accent)" />
        <path d="M24 18v28l23-14z" fill="var(--accent-ink)" />
      </svg>
      Watch Together
    </a>
  )
}
