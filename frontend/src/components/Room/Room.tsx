import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorText, getConfig, resolvePage } from '../../lib/api'
import { formatTime } from '../../lib/fmt'
import { titleFromUrl } from '../../lib/labels'
import { fromResolved, lookupFailed, pickQuality, stepDown, toResolving } from '../../lib/page'
import type { PageSource } from '../../lib/page'
import { go } from '../../lib/router'
import { fromRoom, labelFor } from '../../lib/source'
import { fetchTitle } from '../../lib/titles'
import type { Source } from '../../lib/source'
import { normalizeUrl } from '../../lib/url'
import { useRoom } from '../../lib/useRoom'
import { useSharing } from '../../lib/useSharing'
import { Header } from '../Header/Header'
import { Player } from '../Player/Player'
import { RoomCode } from '../RoomCode/RoomCode'
import { RoomTabs } from '../RoomTabs/RoomTabs'
import type { Tab } from '../RoomTabs/RoomTabs'
import { SourcePanel } from '../SourcePanel/SourcePanel'
import './Room.css'

export function Room({ code }: { code: string }) {
  const { t } = useTranslation()
  const { connection, state, problem, send, myId, clock, onSignal } = useRoom(code)
  const [source, setSource] = useState<Source | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [canResolve, setCanResolve] = useState(false)
  const [tab, setTab] = useState<Tab>('add')
  const video = useRef<HTMLVideoElement | null>(null)
  const objectUrl = useRef<string | null>(null)
  const sourceRef = useRef<Source | null>(null)
  const roomKey = useRef('')

  useEffect(() => {
    sourceRef.current = source
  }, [source])

  // A short confirmation that fades by itself (errors stay until something else happens).
  const flashTimer = useRef<number | undefined>(undefined)
  const flash = useCallback((message: string) => {
    setNotice(message)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3500)
  }, [])
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const sharing = useSharing({ send, onSignal, state, myId, connection, video, notify: setNotice })

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
  const onPlay = (raw: string) => {
    const url = check(raw)
    if (!url) return
    setNotice(null)
    send({ t: 'queue_add', url, play: true, ...(titleFromUrl(url) ? { title: titleFromUrl(url) as string } : {}) })
  }
  const onAdd = (raw: string) => {
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
    <div className="room" data-tab={tab}>
      <Header>
        <p className="room__status" data-state={connection} role="status">
          {connection === 'live' && t('room.people', { count: members })}
          {connection === 'connecting' && t('room.connecting')}
          {connection === 'reconnecting' && t('room.reconnecting')}
        </p>
      </Header>

      <main className="room__main">
        <div className="room__grid">
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
          />
        </div>
      </main>
      <RoomTabs tab={tab} onTab={setTab} count={state?.queue.length ?? 0} />
    </div>
  )
}
