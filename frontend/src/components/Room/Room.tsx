import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorText, getConfig, resolvePage, resolvePlaylist } from '../../lib/api'
import type { ListEntry } from '../../lib/listfile'
import { rememberRoom } from '../../lib/lastRoom'
import { formatTime } from '../../lib/fmt'
import { titleFromUrl } from '../../lib/labels'
import { fromResolved, lookupFailed, pickQuality, stepDown, toResolving } from '../../lib/page'
import type { PageSource } from '../../lib/page'
import { go } from '../../lib/router'
import { fromRoom, labelFor } from '../../lib/source'
import { beep } from '../../lib/beep'
import { fetchTitle } from '../../lib/titles'
import type { Source } from '../../lib/source'
import { isPlaylistUrl, normalizeUrl, splitLinks } from '../../lib/url'
import { useRoom } from '../../lib/useRoom'
import { TABS } from '../../lib/tabs'
import type { Tab } from '../../lib/tabs'
import { useSwipe } from '../../lib/useSwipe'
import { useSharing } from '../../lib/useSharing'
import { Header } from '../Header/Header'
import { Player } from '../Player/Player'
import { ReadyCheck } from '../ReadyCheck/ReadyCheck'
import { RoomCode } from '../RoomCode/RoomCode'
import { RoomTabs } from '../RoomTabs/RoomTabs'
import { SourcePanel } from '../SourcePanel/SourcePanel'
import './Room.css'

export function Room({ code }: { code: string }) {
  const { t } = useTranslation()
  const { connection, state, problem, send, myId, clock, onSignal } = useRoom(code)
  const [source, setSource] = useState<Source | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [canResolve, setCanResolve] = useState(false)
  const [tab, setTab] = useState<Tab>('add')
  const [dir, setDir] = useState<'next' | 'prev' | ''>('')
  const grid = useRef<HTMLDivElement | null>(null)
  const [adTipOff, setAdTipOff] = useState(() => {
    try {
      return localStorage.getItem('wt.adtip') === '1'
    } catch {
      return false
    }
  })
  const video = useRef<HTMLVideoElement | null>(null)
  const objectUrl = useRef<string | null>(null)
  const sourceRef = useRef<Source | null>(null)
  const roomKey = useRef('')

  useEffect(() => {
    sourceRef.current = source
  }, [source])

  // A flick to the left or right moves to the next or previous tab (phones, portrait); the bar at the bottom still works.
  const swipeTab = useCallback((step: 1 | -1) => {
    setDir(step === 1 ? 'next' : 'prev')
    setTab((cur) => TABS[TABS.indexOf(cur) + step] ?? cur)
  }, [])
  useSwipe(grid, swipeTab, '.room__stage')
  const pickTab = useCallback((next: Tab) => {
    setDir('')
    setTab(next)
  }, [])

  // A short confirmation that fades by itself (errors stay until something else happens).
  const flashTimer = useRef<number | undefined>(undefined)
  const flash = useCallback((message: string) => {
    setNotice(message)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3500)
  }, [])
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const sharing = useSharing({ send, onSignal, state, myId, connection, video, notify: setNotice })

  // This device remembers the room, so the home page can offer a way back.
  useEffect(() => {
    if (connection === 'live') rememberRoom(code)
  }, [connection, code])

  useEffect(() => {
    let alive = true
    void getConfig().then((c) => alive && setCanResolve(c.resolver))
    return () => {
      alive = false
    }
  }, [])

  const replaceSource = useCallback(
    (next: Source | null) => {
      if (sharing.isSharing()) sharing.stop()
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = next?.kind === 'file' ? next.url : null
      setNotice(null)
      setSource(next)
    },
    [sharing],
  )

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    },
    [],
  )

  const titleOf = useCallback((item: string | undefined) => state?.queue.find((q) => q.id === item)?.title ?? null, [state?.queue])

  // What the room plays, everybody plays: a link, or somebody's shared file or tab. (A newer one replaces the older.)
  useEffect(() => {
    if (!state) return
    const rs = state.source
    if (!rs) {
      roomKey.current = ''
      return
    }
    if (rs.kind === 'p2p' && rs.by === myId()) return // my own share
    const key = rs.kind === 'link' ? `link:${rs.url}:${rs.item ?? ''}` : rs.kind === 'p2p' ? `p2p:${rs.by}:${rs.name}:${rs.live}` : `${rs.kind}:${JSON.stringify(rs)}`
    if (roomKey.current === key) return
    roomKey.current = key
    const wasSharing = sharing.isSharing() !== null
    if (wasSharing) sharing.stop(false)
    const next = fromRoom(rs, rs.kind === 'link' ? titleOf(rs.item) : null)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the room told us what to watch
    if (next) replaceSource(next)
    if (wasSharing) setNotice(t('room.takenOver'))
  }, [state, myId, sharing, replaceSource, titleOf, t])

  // The sharer left or stopped: stop waiting for a stream that will not come.
  useEffect(() => {
    if (source?.kind !== 'watch' || !state) return
    const still = state.source?.kind === 'p2p' && state.source.by === source.sharer
    if (!still) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the thing being watched no longer exists
      setSource(null)
      setNotice(t('room.shareEnded'))
    }
  }, [state, source, t])

  // A link nobody has played has no name yet: whoever added it asks the platform once and tells the room.
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const item of state?.queue ?? []) {
      if (item.title || item.by !== myId() || asked.current.has(item.id)) continue
      asked.current.add(item.id)
      void fetchTitle(item.url).then((title) => title && send({ t: 'queue_title', item: item.id, title }))
    }
  }, [state?.queue, myId, send])

  // Somebody paused the tab I am sharing, and I am probably looking at that tab, not at this page: say it loudly (the
  // banner is in the player; here the page title and a short beep), because a website cannot pause another tab for me.
  const shareRunning = sharing.sharing === 'screen' ? state?.playing : undefined
  const lastRunning = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    const before = lastRunning.current
    lastRunning.current = shareRunning
    if (shareRunning === undefined) return
    if (before !== undefined && before !== shareRunning) beep(shareRunning ? 'resume' : 'pause')
    if (shareRunning) return
    // Still paused after a few seconds: say it again (a handful of times), in case the first cue was missed.
    let repeats = 0
    const again = window.setInterval(() => {
      if (++repeats > 6) window.clearInterval(again)
      else beep('pause')
    }, 5000)
    const title = document.title
    document.title = `⏸ ${t('player.sharePausedTitle')}`
    return () => {
      window.clearInterval(again)
      document.title = title
    }
  }, [shareRunning, t])

  const onVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
  }, [])

  // ---- playing a link: the platform's own player, then the address as a video, then (if the server offers it) a lookup
  const lookup = useCallback(
    async (page: PageSource) => {
      setSource(toResolving(page))
      setNotice(null)
      const still = (cur: Source | null): cur is PageSource => cur?.kind === 'page' && cur.url === page.url && cur.item === page.item
      try {
        const res = await resolvePage(page.url)
        setSource((cur) => (still(cur) ? fromResolved(cur, res) : cur))
        if (res.title && page.item) send({ t: 'queue_title', item: page.item, title: res.title })
        setNotice(res.needsHeaders ? t('room.resolvedHeaders') : null)
      } catch (err) {
        setSource((cur) => (still(cur) ? lookupFailed(cur, errorText(err)) : cur))
      }
    },
    [send, t],
  )

  const onPageFailed = useCallback(
    (message: string) => {
      const cur = sourceRef.current
      if (cur?.kind !== 'page' || cur.how === 'resolving') return
      if (cur.how === 'resolved') {
        const lower = stepDown(cur)
        if (lower) {
          setSource(lower)
          setNotice(t('room.usedFallback'))
        } else setSource({ ...cur, failed: message })
      } else if (canResolve && !cur.tried) void lookup(cur)
      else setSource({ ...cur, failed: message })
    },
    [canResolve, lookup, t],
  )

  const onPickQuality = useCallback((height: number) => {
    setSource((cur) => (cur?.kind === 'page' ? pickQuality(cur, height) : cur))
  }, [])

  // The video ended: the room moves on to the next one in the watch list. (Everybody reports it; the server counts once.)
  const onEnded = useCallback(() => {
    const cur = sourceRef.current
    if (cur?.kind === 'page' && cur.item) send({ t: 'queue_next', item: cur.item })
  }, [send])

  const onTitle = useCallback(
    (title: string) => {
      const cur = sourceRef.current
      if (cur?.kind === 'page' && cur.item) send({ t: 'queue_title', item: cur.item, title })
    },
    [send],
  )

  // ---- the toolbar
  const check = (raw: string) => {
    const url = normalizeUrl(raw)
    if (!url) setNotice(t('source.badLink'))
    return url
  }
  // Many links at once (a pasted batch, a saved list, a playlist): one message, the room adds what fits.
  const importLinks = useCallback(
    (items: ListEntry[], playFirst: boolean) => {
      const list = items.slice(0, 50)
      if (list.length === 0) return
      if (playFirst) send({ t: 'queue_add', url: list[0].url, play: true, ...(list[0].title ? { title: list[0].title } : {}) })
      send({ t: 'queue_import', items: list })
      flash(t('list.imported', { count: list.length }))
    },
    [send, flash, t],
  )
  const withTitles = (links: string[]): ListEntry[] => links.map((url) => ({ url, ...(titleFromUrl(url) ? { title: titleFromUrl(url) as string } : {}) }))

  /** A playlist page: ask the server for its videos (only when its lookup tool is on). */
  const loadPlaylist = async (raw: string, playFirst: boolean) => {
    if (!canResolve) {
      setNotice(t('list.needsLookup'))
      return
    }
    flash(t('list.loadingPlaylist'))
    try {
      const { items } = await resolvePlaylist(raw)
      importLinks(items.map((i) => ({ url: i.url, ...(i.title ? { title: i.title } : {}) })), playFirst)
    } catch (err) {
      setNotice(errorText(err))
    }
  }
  const onPlay = (raw: string) => {
    const links = splitLinks(raw)
    if (links.length > 1) return importLinks(withTitles(links), true)
    if (links.length === 1 && isPlaylistUrl(links[0])) return void loadPlaylist(links[0], true)
    const url = check(raw)
    if (!url) return
    setNotice(null)
    send({ t: 'queue_add', url, play: true, ...(titleFromUrl(url) ? { title: titleFromUrl(url) as string } : {}) })
  }
  const onAdd = (raw: string) => {
    const links = splitLinks(raw)
    if (links.length > 1) {
      importLinks(withTitles(links), false)
      return true
    }
    if (links.length === 1 && isPlaylistUrl(links[0])) {
      void loadPlaylist(links[0], false)
      return true
    }
    const url = check(raw)
    if (!url) return false
    send({ t: 'queue_add', url, ...(titleFromUrl(url) ? { title: titleFromUrl(url) as string } : {}) })
    flash(t('list.added'))
    return true
  }
  const onFile = (file: File) => replaceSource({ kind: 'file', url: URL.createObjectURL(file), label: file.name })
  const onShareScreen = async () => {
    const before = sourceRef.current
    if (await sharing.startScreen()) {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
      setSource({ kind: 'screen', label: t('room.tabName') })
    } else setSource(before)
  }
  const onReturn = () => {
    const rs = state?.source
    const next = rs && !(rs.kind === 'p2p' && rs.by === myId()) ? fromRoom(rs, rs.kind === 'link' ? titleOf(rs.item) : null) : null
    if (next) replaceSource(next)
  }

  if (connection === 'closed') {
    return (
      <div className="room room--lost">
        <Header />
        <div className="room__lost">
          <h1>{t('room.lostTitle')}</h1>
          <p>{problem ?? t('room.connecting')}</p>
          <button type="button" className="btn btn--primary" onClick={() => go('/')}>
            {t('room.back')}
          </button>
        </div>
      </div>
    )
  }

  const members = state?.n ?? 0
  const roomSource = state?.source
  const canLookup = canResolve && source?.kind === 'page' && !source.tried && (source.how === 'embed' || source.how === 'direct')
  const canReturn = (source?.kind === 'file' || source?.kind === 'screen') && sharing.sharing === null && !!roomSource && roomSource.kind === 'link'
  const cutsMatter = source?.kind === 'file' || (source?.kind === 'page' && (source.how === 'direct' || source.how === 'resolved'))
  return (
    <div className="room" data-tab={tab} data-dir={dir || undefined}>
      <Header>
        <p className="room__status" data-state={connection} role="status">
          {connection === 'live' && t('room.people', { count: members })}
          {connection === 'connecting' && t('room.connecting')}
          {connection === 'reconnecting' && t('room.reconnecting')}
        </p>
      </Header>

      <main className="room__main">
        <div className="room__grid" ref={grid}>
          <div className="room__info">
            <RoomCode code={code} />
          </div>
          {state?.media && cutsMatter && (
            <p className="room__warn" role="status">
              {t('room.differentCuts', { lo: formatTime(state.media.lo), hi: formatTime(state.media.hi) })}
            </p>
          )}
          <div className="room__stage">
            <Player
              source={source}
              state={state}
              clock={clock}
              myId={myId}
              send={send}
              onSignal={onSignal}
              onVideo={onVideo}
              onPageFailed={onPageFailed}
              onPickQuality={onPickQuality}
              onEnded={onEnded}
              onTitle={onTitle}
              onShareEnded={() => {
                setSource(null)
                setNotice(t('room.shareEnded'))
              }}
              sharingViewers={sharing.viewers}
            />
            <ReadyCheck state={state} clock={clock} myId={myId} send={send} />
          </div>
          <SourcePanel
            current={source}
            label={source ? labelFor(source, state?.queue ?? []) : ''}
            notice={notice}
            items={state?.queue ?? []}
            currentItem={roomSource?.kind === 'link' && source?.kind === 'page' && source.url === roomSource.url ? roomSource.item : undefined}
            sharing={sharing.sharing}
            viewers={sharing.viewers}
            sendInfo={sharing.sendInfo}
            sound={sharing.sound}
            canLookup={canLookup}
            canReturn={canReturn}
            onPlay={onPlay}
            onAdd={onAdd}
            onFile={onFile}
            onShareFile={() => source?.kind === 'file' && void sharing.startFile(source.label)}
            onShareScreen={onShareScreen}
            onStopShare={() => {
              sharing.stop()
              if (sourceRef.current?.kind === 'screen') setSource(null)
            }}
            onLookup={() => source?.kind === 'page' && void lookup(source)}
            onReturn={onReturn}
            onSoundList={sharing.soundList}
            onSoundUse={sharing.soundUse}
            onSoundStop={sharing.soundStop}
            onPlayItem={(item) => send({ t: 'queue_play', item })}
            onRemoveItem={(item) => send({ t: 'queue_remove', item })}
            onMoveItem={(item, index) => send({ t: 'queue_move', item, index })}
            onImport={(items) => importLinks(items, false)}
            onListProblem={setNotice}
            onReady={() => send({ t: 'ready_start' })}
            readyBusy={!!state?.check || state?.go != null}
            adTip={!adTipOff && source?.kind === 'page' && source.how === 'embed'}
            onDismissAdTip={() => {
              setAdTipOff(true)
              try {
                localStorage.setItem('wt.adtip', '1')
              } catch {
                /* it just comes back next time */
              }
            }}
          />
        </div>
      </main>
      <RoomTabs tab={tab} onTab={pickTab} count={state?.queue.length ?? 0} />
    </div>
  )
}
