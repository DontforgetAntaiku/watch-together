import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueueItem } from '../../lib/api'
import type { ListEntry } from '../../lib/listfile'
import type { AudioInput } from '../../lib/audioMix'
import { canCaptureElement, canShareScreen, isFirefox } from '../../lib/p2p'
import type { Source } from '../../lib/source'
import { Hint } from '../Hint/Hint'
import { SoundPicker } from '../SoundPicker/SoundPicker'
import { WatchList } from '../WatchList/WatchList'
import './SourcePanel.css'

type Props = {
  current: Source | null
  /** The name of what is being watched, in the current language. */
  label: string
  notice: string | null
  items: QueueItem[]
  currentItem: string | undefined
  sharing: 'file' | 'screen' | null
  viewers: number
  sendInfo: string | null
  sound: { devices: AudioInput[] | null; active: string | null; busy: boolean; error: string | null }
  /** The server can look a page up (yt-dlp) and the current link has not been tried that way yet. */
  canLookup: boolean
  /** Playing something else on this device while the room has its own video. */
  canReturn: boolean
  onPlay: (url: string) => void
  onAdd: (url: string) => boolean
  onFile: (file: File) => void
  onShareFile: () => void
  onShareScreen: () => void
  onStopShare: () => void
  onLookup: () => void
  onReturn: () => void
  onSoundList: () => void
  onSoundUse: (id: string) => void
  onSoundStop: () => void
  onPlayItem: (id: string) => void
  onRemoveItem: (id: string) => void
  onMoveItem: (id: string, index: number) => void
  onImport: (items: ListEntry[]) => void
  onListProblem: (message: string) => void
  /** Ask everybody whether they are ready, then start together (nothing to ask about while a check runs). */
  onReady: () => void
  readyBusy: boolean
  /** Show the short tip about ad blockers (embedded players show their own ads). */
  adTip: boolean
  onDismissAdTip: () => void
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
)
const FILE = 'M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'
const TAB = 'M3 5h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8h16V7z'
const PLUS = 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'

export function SourcePanel(p: Props) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const isFileSource = p.current?.kind === 'file'

  const play = (e: FormEvent) => {
    e.preventDefault()
    if (url.trim()) p.onPlay(url)
  }

  const fileButton = (
    <span className="source__chip">
      <button type="button" className="btn source__chipbtn" onClick={() => file.current?.click()}>
        <Icon d={FILE} />
        {t('source.fileShort')}
      </button>
      <Hint text={t('source.fileHint')} />
    </span>
  )

  return (
    <section className="source" aria-labelledby="source-title">
      <h2 id="source-title" className="sr-only">
        {t('source.title')}
      </h2>

      {/* One section per tab on a phone; on a computer all of them are on the page. */}
      <div className="source__section" data-section="add">
        <form className="source__form" onSubmit={play}>
          <label className="sr-only" htmlFor="video-url">
            {t('source.linkLabel')}
          </label>
          <div className="source__field">
            <input
              id="video-url"
              className="field"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t('source.linkPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Hint text={t('source.linkHint')} />
          </div>
          <button type="submit" className="btn btn--primary source__play" disabled={!url.trim()}>
            {t('source.play')}
          </button>
          <button
            type="button"
            className="btn source__add"
            disabled={!url.trim()}
            aria-label={t('source.addToList')}
            title={t('source.addToList')}
            onClick={() => p.onAdd(url) && setUrl('')}
          >
            <Icon d={PLUS} />
          </button>
        </form>

        {p.notice && (
          <p className="source__notice" role="alert">
            {p.notice}
          </p>
        )}

        {p.current && !p.sharing && (
          <div className="source__now">
            <p className="source__nowtext">
              <span className="source__nowlabel">{t('source.watching')}</span> <strong>{p.label}</strong>
            </p>
            <div className="source__nowactions">
              {isFileSource && canCaptureElement && (
                <span className="source__chip">
                  <button type="button" className="btn btn--primary source__small" onClick={p.onShareFile}>
                    {t('source.shareFileShort')}
                  </button>
                  <Hint text={t('source.shareFileHint')} />
                </span>
              )}
              {p.canLookup && (
                <span className="source__chip">
                  <button type="button" className="btn source__small" onClick={p.onLookup}>
                    {t('source.lookup')}
                  </button>
                  <Hint text={t('source.lookupHint')} />
                </span>
              )}
              {p.canReturn && (
                <button type="button" className="btn source__small" onClick={p.onReturn}>
                  {t('source.returnToRoom')}
                </button>
              )}
              <span className="source__chip">
                <button type="button" className="btn source__small" onClick={p.onReady} disabled={p.readyBusy}>
                  {t('ready.start')}
                </button>
                <Hint text={t('ready.hint')} />
              </span>
            </div>
          </div>
        )}

        {p.adTip && (
          <p className="source__adtip" role="note">
            <span>
              {t('source.adTip')}{' '}
              <a href="https://ublockorigin.com/" target="_blank" rel="noopener noreferrer">
                {t('source.adTipLink')}
              </a>
            </span>
            <button type="button" className="source__adclose" onClick={p.onDismissAdTip} aria-label={t('source.adTipDismiss')} title={t('source.adTipDismiss')}>
              ×
            </button>
          </p>
        )}
      </div>

      <div className="source__section" data-section="share">
        <input
          ref={file}
          className="sr-only"
          id="video-file"
          type="file"
          accept="video/*,.mkv,.m3u8"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) p.onFile(f)
            e.target.value = ''
          }}
        />
        <div className="source__alt">
          {fileButton}
          {canShareScreen && !p.sharing && (
            <span className="source__chip">
              <button type="button" className="btn source__chipbtn" onClick={p.onShareScreen}>
                <Icon d={TAB} />
                {t('source.tabShort')}
              </button>
              <Hint text={t('source.tabHint') + (isFirefox ? ` ${t('source.tabFirefox')}` : '')} />
            </span>
          )}
        </div>
        {isFileSource && !p.sharing && canCaptureElement && <p className="source__tip">{t('source.shareFileTip')}</p>}

        {p.sharing && (
          <div className="source__live">
            <p>
              <strong>{p.sharing === 'file' ? t('source.sharingFile') : t('source.sharingTab')}</strong>
              <br />
              {t('source.viewers', { count: p.viewers })}
              {p.sendInfo && p.sharing === 'file' && <> · {t('source.sending', { info: p.sendInfo })}</>}
            </p>
            <button type="button" className="btn source__small" onClick={p.onStopShare}>
              {t('source.stopShare')}
            </button>
          </div>
        )}
        {p.sharing === 'screen' && (
          <SoundPicker
            devices={p.sound.devices}
            active={p.sound.active}
            busy={p.sound.busy}
            error={p.sound.error}
            onList={p.onSoundList}
            onUse={p.onSoundUse}
            onStop={p.onSoundStop}
          />
        )}
      </div>

      <div className="source__section" data-section="list">
        <WatchList items={p.items} current={p.currentItem} onPlay={p.onPlayItem} onRemove={p.onRemoveItem} onMove={p.onMoveItem} onImport={p.onImport} onProblem={p.onListProblem} />
      </div>
    </section>
  )
}
