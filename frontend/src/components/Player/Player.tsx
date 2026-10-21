import { useTranslation } from 'react-i18next'
import type { ClientMessage, RoomState, Signal } from '../../lib/api'
import type { ServerClock } from '../../lib/clock'
import type { Source } from '../../lib/source'
import { EmbedPlayer } from '../EmbedPlayer/EmbedPlayer'
import { StreamPlayer } from '../StreamPlayer/StreamPlayer'
import { VideoPlayer } from '../VideoPlayer/VideoPlayer'
import './Player.css'

type Props = {
  source: Source | null
  state: RoomState | null
  clock: ServerClock
  myId: () => string
  send: (msg: ClientMessage) => void
  onSignal: (fn: (s: Signal) => void) => () => void
  onVideo: (el: HTMLVideoElement | null) => void
  onShareEnded: () => void
  sharingViewers: number
}

/** The 16:9 frame; the player inside depends on what is being watched. */
export function Player({ source, state, clock, myId, send, onSignal, onVideo, onShareEnded, sharingViewers }: Props) {
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
      {(source?.kind === 'link' || source?.kind === 'file') && (
        <VideoPlayer key={source.url} mode="media" url={source.url} onVideo={onVideo} {...common} />
      )}
      {source?.kind === 'embed' && (
        <EmbedPlayer key={JSON.stringify(source.embed)} embed={source.embed} {...common} />
      )}
      {source?.kind === 'watch' && (
        <StreamPlayer
          key={source.sharer}
          sharer={source.sharer}
          dur={source.dur}
          live={source.live}
          onSignal={onSignal}
          onEnded={onShareEnded}
          {...common}
        />
      )}
      {source?.kind === 'screen' && (
        <div className="player__empty">
          <p className="player__empty-title">{t('player.sharingTitle')}</p>
          <p>{t('player.sharingCount', { count: sharingViewers })}</p>
        </div>
      )}
    </div>
  )
}
