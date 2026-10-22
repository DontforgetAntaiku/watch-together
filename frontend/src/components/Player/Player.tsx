import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState, Signal } from '../../lib/api'
import type { ServerClock } from '../../lib/clock'
import type { PageSource } from '../../lib/page'
import type { Source } from '../../lib/source'
import { EmbedPlayer } from '../EmbedPlayer/EmbedPlayer'
import { StreamPlayer } from '../StreamPlayer/StreamPlayer'
import { VideoPlayer } from '../VideoPlayer/VideoPlayer'
import './Player.css'

type Common = {
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
}

type Props = Common & {
  source: Source | null
  onSignal: (fn: (s: Signal) => void) => () => void
  onVideo: (el: HTMLVideoElement | null) => void
  onShareEnded: () => void
  sharingViewers: number
  /** Something in the page link did not load. */
  onPageFailed: (message: string) => void
  onPickQuality: (height: number) => void
  onEnded: () => void
  onTitle: (title: string) => void
}

function PageView({
  page,
  onVideo,
  onPageFailed,
  onPickQuality,
  onEnded,
  onTitle,
  ...common
}: Common & Pick<Props, 'onVideo' | 'onPageFailed' | 'onPickQuality' | 'onEnded' | 'onTitle'> & { page: PageSource }) {
  const { t } = useTranslation()
  if (page.how === 'resolving') {
    return (
      <div className="player__empty">
        <div className="player__spin" aria-hidden="true" />
        <p className="player__empty-title">{t('player.lookingUp')}</p>
        <p>{t('player.lookingUpText')}</p>
      </div>
    )
  }
  if (page.failed) {
    return (
      <div className="player__empty">
        <p className="player__empty-title">{t('player.cantPlay')}</p>
        <p>{page.failed}</p>
        <p>{t('player.cantPlayHint')}</p>
      </div>
    )
  }
  if (page.how === 'embed' && page.embed) {
    return <EmbedPlayer key={JSON.stringify(page.embed)} embed={page.embed} onFailed={onPageFailed} onEnded={onEnded} onTitle={onTitle} {...common} />
  }
  const media = page.how === 'resolved' ? page.media : { url: page.url }
  if (!media) return null
  const options = page.how === 'resolved' ? page.media?.options : undefined
  return (
    // The key ignores the chosen quality, so picking another one reloads the source inside the same player.
    <VideoPlayer
      key={`${page.url}:${page.how}`}
      mode="media"
      url={media.url}
      audioUrl={'audioUrl' in media ? media.audioUrl : undefined}
      onFailed={onPageFailed}
      onEnded={onEnded}
      choices={options?.length ? options.map((o) => ({ value: String(o.height), label: `${o.height}p` })) : undefined}
      choice={page.media?.quality ? String(page.media.quality) : undefined}
      onChoice={(value) => onPickQuality(Number(value))}
      onVideo={onVideo}
      {...common}
    />
  )
}

/** The 16:9 frame; the player inside depends on what is being watched. */
export function Player({ source, state, clock, myId, send, onSignal, onVideo, onShareEnded, sharingViewers, onPageFailed, onPickQuality, onEnded, onTitle }: Props) {
  const { t } = useTranslation()
  const common = { state, clock, myId, send }
  return (
    <div className="player">
      {!source && (
        <div className="player__empty">
          <p className="player__empty-title">{t('player.emptyTitle')}</p>
          <p>{t('player.emptyText')}</p>
        </div>
      )}
      {source?.kind === 'page' && (
        <PageView page={source} onVideo={onVideo} onPageFailed={onPageFailed} onPickQuality={onPickQuality} onEnded={onEnded} onTitle={onTitle} {...common} />
      )}
      {source?.kind === 'file' && <VideoPlayer key={source.url} mode="media" url={source.url} onVideo={onVideo} onEnded={onEnded} {...common} />}
      {source?.kind === 'watch' && (
        <StreamPlayer key={source.sharer} sharer={source.sharer} dur={source.dur} live={source.live} onSignal={onSignal} onEnded={onShareEnded} {...common} />
      )}
      {source?.kind === 'screen' && (
        <div className="player__empty" data-paused={state?.playing === false}>
          {state?.playing === false ? (
            <>
              <p className="player__empty-title">{t('player.sharePaused')}</p>
              <p>{t('player.sharePausedText')}</p>
            </>
          ) : (
            <>
              <p className="player__empty-title">{t('player.sharingTitle')}</p>
              <p>{t('player.sharingCount', { count: sharingViewers })}</p>
              <p>{t('player.sharingPauseNote')}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
