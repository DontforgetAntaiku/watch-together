/**
 * One outgoing audio track that always exists (silent when nothing is connected), so a sound source added later
 * (a device such as "Monitor of …") can join a running share without renegotiating the connection.
 */
export class AudioMix {
  readonly track: MediaStreamTrack
  private ctx: AudioContext
  private dest: MediaStreamAudioDestinationNode
  private sources = new Map<MediaStream, MediaStreamAudioSourceNode>()

  constructor() {
    this.ctx = new AudioContext()
    this.dest = this.ctx.createMediaStreamDestination()
    this.track = this.dest.stream.getAudioTracks()[0]
    void this.ctx.resume()
  }

  add(stream: MediaStream) {
    if (this.sources.has(stream) || stream.getAudioTracks().length === 0) return
    const node = this.ctx.createMediaStreamSource(stream)
    node.connect(this.dest)
    this.sources.set(stream, node)
  }

  remove(stream: MediaStream) {
    this.sources.get(stream)?.disconnect()
    this.sources.delete(stream)
  }

  close() {
    this.sources.forEach((node) => node.disconnect())
    this.sources.clear()
    this.track.stop()
    void this.ctx.close()
  }
}

export type AudioInput = { id: string; label: string }

/** List sound inputs. The first call asks for microphone permission, because labels stay hidden without it. */
export async function listAudioInputs(): Promise<AudioInput[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
  probe.getTracks().forEach((t) => t.stop())
  const all = await navigator.mediaDevices.enumerateDevices()
  return all
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `#${i + 1}` }))
}

/** Raw capture: echo cancellation and noise suppression would mangle music and film sound. */
export function openAudioInput(id: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
}
