import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTime } from '../../lib/fmt'
import './Controls.css'

type Props = {
  playing: boolean
  time: number
  duration: number
  bufferedEnd: number
  live: boolean
  muted: boolean
  volume: number
  fullscreen: boolean
  canFullscreen: boolean
  visible: boolean
  onToggle: () => void
  onSkip: (seconds: number) => void
  onScrub: (t: number) => void
  /** The person let go of the bar (no value) or moved it with the keyboard (that value). */
  onCommit: (value?: number) => void
  onMute: () => void
  onVolume: (v: number) => void
  onFullscreen: () => void
  qualityOptions: { value: string; label: string }[]
  quality: string
  onQuality: (value: string) => void
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
)
const PLAY = 'M8 5v14l11-7z'
const PAUSE = 'M6 5h4v14H6zm8 0h4v14h-4z'
const BACK = 'M12.5 3a9 9 0 1 1-8.2 5.3l1.8.8A7 7 0 1 0 12.5 5v3.5L7 4.2 12.5 0z'
const FWD = 'M11.5 3a9 9 0 1 0 8.2 5.3l-1.8.8A7 7 0 1 1 11.5 5v3.5L17 4.2 11.5 0z'
const VOL = 'M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z'
const MUTE = 'M16.5 12a4.5 4.5 0 0 0-2.5-4v2.2l2.5 2.5zM19 12a7 7 0 0 1-.9 3.4l1.5 1.5A9 9 0 0 0 21 12a9 9 0 0 0-7-8.8v2.1A7 7 0 0 1 19 12zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3a8.6 8.6 0 0 1-2.3 1.2v2.1a11 11 0 0 0 3.7-1.9l2 2 1.3-1.3zM12 4 9.9 6.1 12 8.2z'
const GEAR = 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.67 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.61.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.42.49.42h3.84c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z'
const FS = 'M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z'
const FS_EXIT = 'M8 5h2v5H5V8h3zm6 0h2v3h3v2h-5zM5 14h5v5H8v-3H5zm9 0h5v2h-3v3h-2z'

export function Controls(p: Props) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState(false)
  const dragging = useRef(false)
  const hasQuality = p.qualityOptions.length > 1
  const menuOpen = menu && p.visible
  const max = p.duration > 0 ? p.duration : 0
  const played = max ? (p.time / max) * 100 : 0
  const buffered = max ? (p.bufferedEnd / max) * 100 : 0
  return (
    <div className="controls" data-visible={p.visible} data-playing={p.playing}>
      <div className="controls__center">
        {!p.live && (
          <button type="button" className="controls__skip" onClick={() => p.onSkip(-10)} aria-label={t('controls.back')}>
            <Icon d={BACK} />
            <span>10</span>
          </button>
        )}
        <button type="button" className="controls__big" onClick={p.onToggle} aria-label={p.playing ? t('controls.pause') : t('controls.play')}>
          <Icon d={p.playing ? PAUSE : PLAY} />
        </button>
        {!p.live && (
          <button type="button" className="controls__skip" onClick={() => p.onSkip(10)} aria-label={t('controls.forward')}>
            <Icon d={FWD} />
            <span>10</span>
          </button>
        )}
      </div>

      {menuOpen && hasQuality && (
        <div className="controls__menu" role="menu" aria-label={t('controls.quality')}>
          <p className="controls__menu-title">{t('controls.quality')}</p>
          {p.qualityOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === p.quality}
              className="controls__menu-item"
              onClick={() => {
                p.onQuality(o.value)
                setMenu(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="controls__bar">
        {!p.live && (
          <input
            className="controls__seek"
            type="range"
            min={0}
            max={max || 1}
            step={0.1}
            value={Math.min(p.time, max || 1)}
            disabled={!max}
            aria-label={t('controls.seek')}
            aria-valuetext={t('controls.seekValue', { time: formatTime(p.time), duration: formatTime(max) })}
            style={{ '--played': `${played}%`, '--buffered': `${buffered}%` } as CSSProperties}
            onChange={(e) => {
              p.onScrub(Number(e.target.value))
              if (!dragging.current) p.onCommit(Number(e.target.value)) // keyboard and assistive technology: no drag to wait for
            }}
            onPointerDown={() => {
              dragging.current = true
            }}
            onPointerUp={() => {
              dragging.current = false
              p.onCommit()
            }}
            onPointerCancel={() => {
              dragging.current = false
              p.onCommit()
            }}
            onBlur={() => p.onCommit()}
          />
        )}
        <div className="controls__row">
          <button type="button" className="controls__btn" onClick={p.onToggle} aria-label={p.playing ? t('controls.pause') : t('controls.play')}>
            <Icon d={p.playing ? PAUSE : PLAY} />
          </button>
          {!p.live && (
            <>
              <button type="button" className="controls__btn controls__row-skip" onClick={() => p.onSkip(-10)} aria-label={t('controls.back')}>
                <Icon d={BACK} />
              </button>
              <button type="button" className="controls__btn controls__row-skip" onClick={() => p.onSkip(10)} aria-label={t('controls.forward')}>
                <Icon d={FWD} />
              </button>
            </>
          )}
          <span className="controls__time">
            {p.live ? <strong className="controls__live">{t('controls.live')}</strong> : `${formatTime(p.time)} / ${formatTime(max)}`}
          </span>
          <span className="controls__spacer" />
          <div className="controls__volume">
            <button type="button" className="controls__btn" onClick={p.onMute} aria-label={p.muted ? t('controls.unmute') : t('controls.mute')}>
              <Icon d={p.muted || p.volume === 0 ? MUTE : VOL} />
            </button>
            <input
              className="controls__vol"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={p.muted ? 0 : p.volume}
              aria-label={t('controls.volume')}
              style={{ '--played': `${(p.muted ? 0 : p.volume) * 100}%`, '--buffered': '0%' } as CSSProperties}
              onChange={(e) => p.onVolume(Number(e.target.value))}
            />
          </div>
          {hasQuality && (
            <button
              type="button"
              className="controls__btn"
              onClick={() => setMenu((v) => !v)}
              aria-label={t('controls.quality')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Icon d={GEAR} />
            </button>
          )}
          {p.canFullscreen && (
            <button type="button" className="controls__btn" onClick={p.onFullscreen} aria-label={p.fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}>
              <Icon d={p.fullscreen ? FS_EXIT : FS} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
