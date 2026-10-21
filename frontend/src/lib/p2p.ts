import type { ClientMessage, Signal } from './api'
import { debug } from './debug'
import { ICE_SERVERS } from './ice'
import i18n from '../i18n'

type Send = (msg: ClientMessage) => void

/** Wait until the browser has found all its network candidates (one offer/answer carries them all). */
function gathered(pc: RTCPeerConnection, maxMs = 3500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      window.clearTimeout(timer)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const timer = window.setTimeout(done, maxMs)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

const MAX_VIEWERS = 8
const MAX_BITRATE = 4_000_000

/** Bitrate that suits a picture of this height. */
const bitrateFor = (height: number) => Math.min(6_000_000, Math.max(300_000, Math.round(height * height * 4.5)))

/** The person who shares a file or a tab: one direct connection per viewer. */
export class Sharer {
  private peers = new Map<string, RTCPeerConnection>()
  private getStream: () => Promise<MediaStream>
  private send: Send
  private onCount: (n: number) => void

  constructor(getStream: () => Promise<MediaStream>, send: Send, onCount: (n: number) => void) {
    this.getStream = getStream
    this.send = send
    this.onCount = onCount
  }

  async handleOffer(from: string, sdp: string) {
    this.close(from)
    if (this.peers.size >= MAX_VIEWERS) {
      this.send({ t: 'signal', to: from, sig: 'bye' })
      return
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.peers.set(from, pc)
    pc.onconnectionstatechange = () => {
      debug('sharer peer', from, pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close(from)
      else this.onCount(this.connected())
    }
    try {
      const stream = await this.getStream()
      await pc.setRemoteDescription({ type: 'offer', sdp })
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
      await pc.setLocalDescription(await pc.createAnswer())
      await gathered(pc)
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        const params = sender.getParameters()
        if (!params.encodings?.length) params.encodings = [{}]
        params.encodings[0].maxBitrate = MAX_BITRATE
        await sender.setParameters(params).catch(() => {})
      }
      this.send({ t: 'signal', to: from, sig: 'answer', sdp: pc.localDescription?.sdp ?? '' })
    } catch (err) {
      debug('sharer failed', err)
      this.close(from)
    }
  }

  /** A viewer asked for a lower resolution (or `auto`): scale only that viewer's video. */
  async setQuality(id: string, value: string) {
    const pc = this.peers.get(id)
    if (!pc) return
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue
      const params = sender.getParameters()
      if (!params.encodings?.length) params.encodings = [{}]
      const enc = params.encodings[0]
      if (value === 'auto') {
        delete enc.scaleResolutionDownBy
        enc.maxBitrate = MAX_BITRATE
      } else {
        const target = Number(value)
        const source = sender.track.getSettings().height || target
        enc.scaleResolutionDownBy = Math.max(1, source / target)
        enc.maxBitrate = bitrateFor(Math.min(target, source))
      }
      await sender.setParameters(params).catch(() => {})
    }
  }

  /** What this sharer is really sending (frames are the proof that a capture method works on this device). */
  async videoStats(): Promise<{ frames: number; width: number; height: number; fps: number } | null> {
    let frames = 0
    let width = 0
    let height = 0
    let fps = 0
    let peers = 0
    for (const pc of this.peers.values()) {
      if (pc.connectionState !== 'connected') continue
      peers++
      const report = await pc.getStats()
      report.forEach((s) => {
        if (s.type !== 'outbound-rtp' || s.kind !== 'video') return
        frames += s.framesEncoded ?? 0
        width = Math.max(width, s.frameWidth ?? 0)
        height = Math.max(height, s.frameHeight ?? 0)
        fps = Math.max(fps, s.framesPerSecond ?? 0)
      })
    }
    return peers ? { frames, width, height, fps } : null
  }

  /** Swap the picture of every running connection without renegotiating. */
  async replaceVideoTrack(track: MediaStreamTrack) {
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((x) => x.track?.kind === 'video')
      await sender?.replaceTrack(track).catch(() => {})
    }
  }

  private connected() {
    return [...this.peers.values()].filter((pc) => pc.connectionState === 'connected').length
  }

  close(id: string) {
    const pc = this.peers.get(id)
    if (!pc) return
    this.peers.delete(id)
    pc.onconnectionstatechange = null
    pc.close()
    this.onCount(this.connected())
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id)
  }
}

export type ViewerState = 'connecting' | 'connected' | 'failed' | 'ended'

/** The person who watches someone else's share. */
export function watchShare(
  sharer: string,
  send: Send,
  subscribe: (fn: (s: Signal) => void) => () => void,
  onStream: (stream: MediaStream) => void,
  onState: (state: ViewerState) => void,
): { stop: () => void; setQuality: (value: string) => void } {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let stopped = false
  let desired = 'auto'
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => {
    if (e.streams[0]) onStream(e.streams[0])
  }
  pc.onconnectionstatechange = () => {
    debug('viewer', pc.connectionState)
    if (stopped) return
    if (pc.connectionState === 'connected') {
      onState('connected')
      if (desired !== 'auto') send({ t: 'signal', to: sharer, sig: 'quality', sdp: desired })
    }
    else if (pc.connectionState === 'failed') onState('failed')
    else if (pc.connectionState === 'disconnected') {
      window.setTimeout(() => !stopped && pc.connectionState === 'disconnected' && onState('failed'), 5000)
    }
  }
  const unsubscribe = subscribe((signal) => {
    if (signal.from !== sharer || stopped) return
    if (signal.sig === 'answer' && signal.sdp) {
      void pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp }).catch(() => onState('failed'))
    } else if (signal.sig === 'bye') {
      onState('ended')
    }
  })
  const timeout = window.setTimeout(() => {
    if (!stopped && pc.connectionState !== 'connected') onState('failed')
  }, 20_000)
  void (async () => {
    try {
      await pc.setLocalDescription(await pc.createOffer())
      await gathered(pc)
      if (!stopped) send({ t: 'signal', to: sharer, sig: 'offer', sdp: pc.localDescription?.sdp ?? '' })
    } catch {
      if (!stopped) onState('failed')
    }
  })()
  return {
    stop: () => {
      stopped = true
      window.clearTimeout(timeout)
      unsubscribe()
      send({ t: 'signal', to: sharer, sig: 'bye' })
      pc.close()
    },
    setQuality: (value: string) => {
      desired = value
      if (pc.connectionState === 'connected') send({ t: 'signal', to: sharer, sig: 'quality', sdp: value })
    },
  }
}

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }

export const canCaptureElement = typeof HTMLMediaElement !== 'undefined' && ('captureStream' in HTMLMediaElement.prototype || 'mozCaptureStream' in HTMLMediaElement.prototype)
export const canShareScreen = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

export type Capture = { stream: MediaStream; stop: () => void; mode: 'direct' | 'canvas' }

/**
 * Phones (hardware video decoding) often hand `captureStream()` black frames, so there each frame is copied
 * through a canvas instead. Override with localStorage `wt-capture` = `canvas` | `direct`.
 */
function wantsCanvas(): boolean {
  try {
    const forced = localStorage.getItem('wt-capture')
    if (forced === 'canvas') return true
    if (forced === 'direct') return false
  } catch {
    /* storage unavailable */
  }
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
}

/** Capture what a <video> is playing (a local file) as a live stream. Call `stop` when the share ends. */
export async function captureVideo(video: HTMLVideoElement, force?: 'direct' | 'canvas'): Promise<Capture> {
  const el = video as CapturableVideo
  const capture = el.captureStream ?? el.mozCaptureStream
  if (!capture) throw new Error(i18n.t('errors.noCapture'))
  let direct: MediaStream | null = null
  for (let i = 0; i < 40 && !direct; i++) {
    const stream = capture.call(el)
    if (stream.getVideoTracks().length > 0) direct = stream
    else await new Promise((r) => setTimeout(r, 100))
  }
  if (!direct) throw new Error(i18n.t('errors.noPicture'))
  if ((force ?? (wantsCanvas() ? 'canvas' : 'direct')) === 'direct') return { stream: direct, stop: () => {}, mode: 'direct' }

  const scale = Math.min(1, 1280 / (video.videoWidth || 1280))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round((video.videoWidth || 1280) * scale))
  canvas.height = Math.max(2, Math.round((video.videoHeight || 720) * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(i18n.t('errors.noCapture'))
  let alive = true
  const draw = () => {
    if (!alive) return
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch {
      /* frame not ready yet */
    }
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(draw)
    else requestAnimationFrame(draw)
  }
  draw()
  const stream = canvas.captureStream(30)
  direct.getAudioTracks().forEach((track) => stream.addTrack(track))
  return {
    stream,
    mode: 'canvas',
    stop: () => {
      alive = false
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}

export const isFirefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent)
