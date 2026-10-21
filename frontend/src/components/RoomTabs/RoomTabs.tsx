import { useTranslation } from 'react-i18next'
import './RoomTabs.css'

export type Tab = 'add' | 'list' | 'share' | 'room'

type Props = {
  tab: Tab
  onTab: (tab: Tab) => void
  /** How many videos are in the watch list. */
  count: number
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)
const ICONS: Record<Tab, string> = {
  add: 'M5 4.5v15l13-7.5z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  share: 'M3 5h18v11H3zM8 20h8M12 16v4',
  room: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 6v12',
}

/** The phone's way around a room: a floating bar at the bottom, one section at a time under the pinned player. */
export function RoomTabs({ tab, onTab, count }: Props) {
  const { t } = useTranslation()
  return (
    <nav className="tabs" aria-label={t('tabs.label')}>
      <div className="tabs__bar" role="tablist">
        {(['add', 'list', 'share', 'room'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="tabs__tab" data-tab={id} onClick={() => onTab(id)}>
            <span className="tabs__icon">
              <Icon d={ICONS[id]} />
              {id === 'list' && count > 0 && <span className="tabs__badge">{count}</span>}
            </span>
            <span className="tabs__label">{t(`tabs.${id}`)}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
