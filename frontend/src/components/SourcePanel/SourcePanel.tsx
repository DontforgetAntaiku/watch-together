import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { hostLabel } from '../../lib/source'
import type { Source } from '../../lib/source'
import './SourcePanel.css'

type Props = {
  current: Source | null
  suggestion: string | null
  offered: boolean
  onUrl: (url: string, share: boolean) => void
  onFile: (file: File) => void
  onStopSharing: () => void
  onUseSuggestion: (url: string) => void
}

export function SourcePanel({ current, suggestion, offered, onUrl, onFile, onStopSharing, onUseSuggestion }: Props) {
  const [url, setUrl] = useState('')
  const [share, setShare] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(true)
  const loaded = current?.url

  // On a phone, tuck the panel away once a video is loaded so the player has the room.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a new source from the parent
    if (loaded && window.matchMedia('(max-width: 999px)').matches) setOpen(false)
  }, [loaded])
  const alreadyUsing = suggestion !== null && current?.kind === 'url' && current.url === suggestion

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = url.trim()
    if (value) onUrl(value, share)
  }

  return (
    <section className="source" data-open={open} aria-labelledby="source-title">
      <div className="source__head">
        <h2 id="source-title" className="source__title">
          Your video
        </h2>
        <button
          type="button"
          className="btn source__toggle"
          aria-expanded={open}
          aria-controls="source-body"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide' : current ? 'Change' : 'Choose'}
        </button>
      </div>
      {!open && current && (
        <p className="source__summary">
          Playing: <strong>{current.label}</strong>
        </p>
      )}
      <div id="source-body" className="source__body">
      <p className="source__hint">
        Only you choose what plays on your screen. Nothing goes through the server; it only passes play, pause and seek.
      </p>

      {suggestion && !alreadyUsing && (
        <div className="source__suggest">
          <span>
            Someone shared a link from <strong>{hostLabel(suggestion)}</strong>
          </span>
          <button type="button" className="btn btn--primary source__btn" onClick={() => onUseSuggestion(suggestion)}>
            Use it
          </button>
        </div>
      )}

      <form className="source__row" onSubmit={submit}>
        <label className="sr-only" htmlFor="video-url">
          Video link
        </label>
        <input
          id="video-url"
          className="field"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a video link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn btn--primary source__btn" disabled={!url.trim()}>
          Load link
        </button>
      </form>
      <label className="source__check">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Offer this link to everyone in the room
      </label>

      <div className="source__or">or</div>

      <input
        ref={file}
        className="sr-only"
        id="video-file"
        type="file"
        accept="video/*,.mkv,.m3u8"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <button type="button" className="btn source__file" onClick={() => file.current?.click()}>
        Open a file from this device
      </button>
      <p className="source__hint source__hint--small">
        The file stays on your device. Everyone should open the same cut of the video, or the positions will not match.
      </p>

      {current && (
        <p className="source__now">
          Playing: <strong>{current.label}</strong>
          {offered && suggestion && (
            <>
              {' · '}
              <button type="button" className="source__link" onClick={onStopSharing}>
                Stop offering the link
              </button>
            </>
          )}
        </p>
      )}
      </div>
    </section>
  )
}
