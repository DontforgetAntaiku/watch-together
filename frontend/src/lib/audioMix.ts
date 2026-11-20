/**
 * One outgoing audio track that always exists (silent when nothing is connected), so a sound source added later
 * (a device such as "Monitor of …") can join a running share without renegotiating the connection.
 */
export class AudioMix {
  readonly track: MediaStreamTrack
  private ctx: AudioContext
  private dest: MediaStreamAudioDestinationNode
  private bus: GainNode
  private meter: AnalyserNode
  private sources = new Map<MediaStream, MediaStreamAudioSourceNode>()

  /**
   * Create it inside the click that starts a share, before any `await`: a browser lets an audio context run only
   * while (or soon after) a person is interacting, and a context made after the screen picker may stay silent.
   */
  constructor() {
    this.ctx = new AudioContext()
    this.bus = this.ctx.createGain()
    this.dest = this.ctx.createMediaStreamDestination()
    this.meter = this.ctx.createAnalyser()
    this.meter.fftSize = 1024
    this.bus.connect(this.dest)
    this.bus.connect(this.meter)
    this.track = this.dest.stream.getAudioTracks()[0]
    void this.ctx.resume()
  }

  /** Start (or restart) the context; call it from a click handler too. True when it is running. */
  async resume(): Promise<boolean> {
    try {
      await this.ctx.resume()
    } catch {
      /* the state below tells */
    }
    return this.ctx.state === 'running'
  }

  add(stream: MediaStream) {
    if (this.sources.has(stream) || stream.getAudioTracks().length === 0) return
    const node = this.ctx.createMediaStreamSource(stream)
    node.connect(this.bus)
    this.sources.set(stream, node)
  }

  /** The loudest sample (0 to 1) of what is being sent right now. */
  level(): number {
    const data = new Float32Array(this.meter.fftSize)
    this.meter.getFloatTimeDomainData(data)
    return data.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0)
  }

  /** Listen for a moment: the loudest level seen. Silence for a few seconds means a muted or wrong input. */
  async listen(ms: number): Promise<number> {
    let peak = 0
    const end = Date.now() + ms
    while (Date.now() < end) {
      peak = Math.max(peak, this.level())
      await new Promise((r) => setTimeout(r, 80))
    }
    return peak
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
