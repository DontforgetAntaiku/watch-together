import './HeroArt.css'

/** The idea of the app in one picture: the same moment on a screen and a phone, joined by a line that carries the sync. */
export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 480 360" role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ha-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--pink)" />
        </linearGradient>
        <linearGradient id="ha-phone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--pink)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <radialGradient id="ha-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="240" cy="180" r="170" fill="url(#ha-glow)" />

      {/* the big screen */}
      <g className="hero-art__float">
        <rect x="30" y="50" width="320" height="200" rx="18" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
        <rect x="42" y="62" width="296" height="150" rx="10" fill="url(#ha-screen)" />
        <circle cx="190" cy="137" r="30" fill="#fff" fillOpacity="0.92" />
        <path d="M181 120v34l28-17z" fill="var(--accent)" />
        <rect x="42" y="226" width="296" height="6" rx="3" fill="var(--surface-2)" />
        <rect x="42" y="226" width="148" height="6" rx="3" fill="var(--accent)" />
        <circle cx="190" cy="229" r="7" fill="#fff" stroke="var(--accent)" strokeWidth="3" />
        <path d="M150 262h80l8 18H142z" fill="var(--surface-2)" />
      </g>

      {/* the phone */}
      <g className="hero-art__float hero-art__float--late">
        <rect x="318" y="120" width="112" height="206" rx="20" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
        <rect x="328" y="138" width="92" height="120" rx="10" fill="url(#ha-phone)" />
        <circle cx="374" cy="198" r="22" fill="#fff" fillOpacity="0.92" />
        <path d="M367 186v24l20-12z" fill="var(--pink)" />
        <rect x="328" y="272" width="92" height="6" rx="3" fill="var(--surface-2)" />
        <rect x="328" y="272" width="46" height="6" rx="3" fill="var(--pink)" />
        <circle cx="374" cy="275" r="6" fill="#fff" stroke="var(--pink)" strokeWidth="3" />
        <rect x="352" y="306" width="44" height="5" rx="2.5" fill="var(--line)" />
      </g>

      {/* the sync line */}
      <path className="hero-art__line" d="M190 137C250 60 340 80 374 198" fill="none" stroke="var(--accent-text)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10" />

      {/* people in the room */}
      <g className="hero-art__float hero-art__float--late">
        <circle cx="64" cy="300" r="22" fill="var(--accent)" />
        <text x="64" y="307" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--accent-ink)">K</text>
        <circle cx="112" cy="318" r="18" fill="var(--pink)" />
        <text x="112" y="325" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">A</text>
        <circle cx="150" cy="304" r="14" fill="var(--surface-2)" stroke="var(--line)" strokeWidth="2" />
        <text x="150" y="309" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">+3</text>
      </g>

      {/* the code */}
      <g>
        <rect x="246" y="16" width="148" height="40" rx="12" fill="var(--surface)" stroke="var(--accent-text)" strokeWidth="2" strokeDasharray="5 4" />
        <text x="320" y="43" textAnchor="middle" fontFamily="ui-monospace, Menlo, Consolas, monospace" fontSize="22" fontWeight="700" letterSpacing="3" fill="var(--accent-text)">K7M2QX</text>
      </g>
    </svg>
  )
}
