import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomSource } from '../../lib/api'
import { canCaptureElement, canShareScreen } from '../../lib/p2p'
import { offerLabel } from '../../lib/source'
import type { Source } from '../../lib/source'
import './SourcePanel.css'

type Props = {
  current: Source | null
  offer: RoomSource | null
  offeredByMe: boolean
  sharing: 'file' | 'screen' | null
  viewers: number
  notice: string | null
  onUrl: (url: string, share: boolean) => void
  onFile: (file: File) => void
  onStopOffer: () => void
  onUseOffer: () => void
  onShareFile: () => void
  onShareScreen: () => void
  onStopShare: () => void
}

export function SourcePanel(p: Props) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [share, setShare] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(true)
  const loaded = p.current?.kind === 'link' || p.current?.kind === 'file' || p.current?.kind === 'yt' || p.current?.kind === 'vimeo' ? p.current.kind + (('url' in p.current && p.current.url) || ('id' in p.current && p.current.id) || '') : p.current?.kind

  // On a phone, tuck the panel away once a video is loaded so the player has the room.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a new source from the parent
    if (loaded && window.matchMedia('(max-width: 999px)').matches) setOpen(false)
  }, [loaded])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = url.trim()
    if (value) p.onUrl(value, share)
  }

  const watchingOffer = p.offer && p.current?.kind === 'watch' && p.offer.kind === 'p2p' && p.current.sharer === p.offer.by
  const showOffer = p.offer && !p.offeredByMe && !watchingOffer
  const isFileSource = p.current?.kind === 'file'

  return (
    <section className="source" data-open={open} aria-labelledby="source-title">
      <div className="source__head">
        <h2 id="source-title" className="source__title">
          {t('source.title')}
        </h2>
        <button
          type="button"
          className="btn source__toggle"
          aria-expanded={open}
          aria-controls="source-body"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('source.hide') : p.current ? t('source.change') : t('source.choose')}
        </button>
      </div>
      {!open && p.current && (
        <p className="source__summary">
          {t('source.watching')} <strong>{p.current.label}</strong>
        </p>
      )}

      <div id="source-body" className="source__body">
        {showOffer && p.offer && (
          <div className="source__suggest">
            <span>
              {p.offer.kind === 'p2p' ? t('source.offerShare') : t('source.offerLink')}{' '}
              <strong>{offerLabel(p.offer)}</strong>
            </span>
            <button type="button" className="btn btn--primary source__btn" onClick={p.onUseOffer}>
              {p.offer.kind === 'p2p' ? t('source.watch') : t('source.use')}
            </button>
          </div>
        )}

        {p.sharing && (
          <div className="source__live">
            <p>
              <strong>{p.sharing === 'file' ? t('source.sharingFile') : t('source.sharingTab')}</strong>
              <br />
              {t('source.viewers', { count: p.viewers })}
            </p>
            <button type="button" className="btn source__btn" onClick={p.onStopShare}>
              {t('source.stopShare')}
            </button>
          </div>
        )}

        <h3 className="source__sub">{t('source.linkTitle')}</h3>
        <p className="source__hint">{t('source.linkHint')}</p>
        <form className="source__row" onSubmit={submit}>
          <label className="sr-only" htmlFor="video-url">
            {t('source.linkLabel')}
          </label>
          <input
            id="video-url"
            className="field"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('source.linkPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="btn btn--primary source__btn" disabled={!url.trim()}>
            {t('source.load')}
          </button>
        </form>
        <label className="source__check">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          {t('source.offerCheck')}
        </label>
        {p.offeredByMe && (
          <p className="source__now">
            {t('source.offered')}{' '}
            <button type="button" className="source__link" onClick={p.onStopOffer}>
              {t('source.stopOffer')}
            </button>
          </p>
        )}

        <h3 className="source__sub">{t('source.fileTitle')}</h3>
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
        <button type="button" className="btn source__file" onClick={() => file.current?.click()}>
          {t('source.openFile')}
        </button>
        {isFileSource && !p.sharing && canCaptureElement && (
          <>
            <button type="button" className="btn btn--primary source__file source__share" onClick={p.onShareFile}>
              {t('source.shareFile')}
            </button>
            <p className="source__hint source__hint--small">{t('source.shareFileHint')}</p>
          </>
        )}
        {!isFileSource && !p.sharing && (
          <p className="source__hint source__hint--small">{t('source.fileHint')}</p>
        )}

        {canShareScreen && !p.sharing && (
          <>
            <h3 className="source__sub">{t('source.tabTitle')}</h3>
            <p className="source__hint">{t('source.tabHint')}</p>
            <button type="button" className="btn source__file" onClick={p.onShareScreen}>
              {t('source.shareTab')}
            </button>
          </>
        )}

        {p.notice && (
          <p className="source__error" role="alert">
            {p.notice}
          </p>
        )}

        {p.current && (
          <p className="source__now">
            {t('source.watching')} <strong>{p.current.label}</strong>
          </p>
        )}
      </div>
    </section>
  )
}
