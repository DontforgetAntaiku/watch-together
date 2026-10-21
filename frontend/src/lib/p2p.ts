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
): () => void {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let stopped = false
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => {
    if (e.streams[0]) onStream(e.streams[0])
  }
  pc.onconnectionstatechange = () => {
    debug('viewer', pc.connectionState)
    if (stopped) return
    if (pc.connectionState === 'connected') onState('connected')
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
  return () => {
    stopped = true
    window.clearTimeout(timeout)
    unsubscribe()
    send({ t: 'signal', to: sharer, sig: 'bye' })
    pc.close()
  }
}

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }

export const canCaptureElement = typeof HTMLMediaElement !== 'undefined' && ('captureStream' in HTMLMediaElement.prototype || 'mozCaptureStream' in HTMLMediaElement.prototype)
export const canShareScreen = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

/** Capture what a <video> is playing (a local file) as a live stream. */
export async function captureVideo(video: HTMLVideoElement): Promise<MediaStream> {
  const el = video as CapturableVideo
  const capture = el.captureStream ?? el.mozCaptureStream
  if (!capture) throw new Error(i18n.t('errors.noCapture'))
  for (let i = 0; i < 40; i++) {
    const stream = capture.call(el)
    if (stream.getVideoTracks().length > 0) return stream
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(i18n.t('errors.noPicture'))
}
