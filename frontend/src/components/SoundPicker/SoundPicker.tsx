import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AudioInput } from '../../lib/audioMix'
import './SoundPicker.css'

type Props = {
  devices: AudioInput[] | null
  active: string | null
  busy: boolean
  error: string | null
  onList: () => void
  onUse: (id: string) => void
  onStop: () => void
}

/** Add sound from an input device to a tab share, e.g. "Monitor of …" on Linux to share everything you hear. */
export function SoundPicker({ devices, active, busy, error, onList, onUse, onStop }: Props) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState('')
  const picked = choice || devices?.find((d) => /monitor/i.test(d.label))?.id || devices?.[0]?.id || ''

  return (
    <div className="sound">
      <p className="sound__title">{t('sound.title')}</p>
      <p className="sound__hint">{t('sound.hint')}</p>
      {active ? (
        <div className="sound__row">
          <span className="sound__on">{t('sound.on', { name: devices?.find((d) => d.id === active)?.label ?? '' })}</span>
          <button type="button" className="btn sound__btn" onClick={onStop}>
            {t('sound.remove')}
          </button>
        </div>
      ) : devices ? (
        <div className="sound__row">
          <label className="sr-only" htmlFor="sound-device">
            {t('sound.device')}
          </label>
          <select id="sound-device" className="field sound__select" value={picked} onChange={(e) => setChoice(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--primary sound__btn" disabled={!picked || busy} onClick={() => onUse(picked)}>
            {t('sound.add')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn sound__btn" disabled={busy} onClick={onList}>
          {t('sound.choose')}
        </button>
      )}
      {error && (
        <p className="sound__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
