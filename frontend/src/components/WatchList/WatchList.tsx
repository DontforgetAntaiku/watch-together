import { useTranslation } from 'react-i18next'
import type { QueueItem } from '../../lib/api'
import { hostLabel, titleFromUrl } from '../../lib/labels'
import './WatchList.css'

type Props = {
  items: QueueItem[]
  /** The list entry that is playing now. */
  current: string | undefined
  onPlay: (id: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, index: number) => void
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
)
const PLAY = 'M8 5v14l11-7z'
const UP = 'M12 5l7 8h-4.5v6h-5v-6H5z'
const CLOSE = 'M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z'
const BARS = 'M5 9h3v10H5zm5.5-4h3v14h-3zM16 12h3v7h-3z'

/** The room's shared list of links: anyone can add, play, move or remove; the room plays the next one by itself. */
export function WatchList({ items, current, onPlay, onRemove, onMove }: Props) {
  const { t } = useTranslation()
  return (
    <section className="list" aria-labelledby="list-title">
      <h2 id="list-title" className="list__title">
        {t('list.title')}
        {items.length > 0 && <span className="list__count">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="list__empty">{t('list.empty')}</p>
      ) : (
        <ol className="list__items">
          {items.map((item, i) => {
            const playing = item.id === current
            const name = item.title || titleFromUrl(item.url) || hostLabel(item.url)
            return (
              <li key={item.id} className="list__item" data-playing={playing}>
                <button type="button" className="list__play" onClick={() => onPlay(item.id)} aria-label={t('list.play', { name })} aria-current={playing || undefined}>
                  <Icon d={playing ? BARS : PLAY} />
                  <span className="list__text">
                    <span className="list__name">{name}</span>
                    <span className="list__host">{hostLabel(item.url)}</span>
                  </span>
                </button>
                {i > 0 && (
                  <button type="button" className="list__icon" onClick={() => onMove(item.id, i - 1)} aria-label={t('list.up', { name })} title={t('list.up', { name })}>
                    <Icon d={UP} />
                  </button>
                )}
                <button type="button" className="list__icon" onClick={() => onRemove(item.id)} aria-label={t('list.remove', { name })} title={t('list.remove', { name })}>
                  <Icon d={CLOSE} />
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
