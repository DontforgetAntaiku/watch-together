/**
 * A short cue for a page the person is not looking at. The pause alert is three soft notes: easy to notice, not loud;
 * the resume cue is an even quieter rising pair. Never throws.
 */
export function beep(kind: 'pause' | 'resume') {
  try {
    const ctx = new AudioContext()
    void ctx.resume()
    const notes = kind === 'pause' ? [880, 660, 440] : [440, 660]
    const volume = kind === 'pause' ? 0.1 : 0.05
    notes.forEach((hz, i) => {
      const start = ctx.currentTime + i * 0.2
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.2)
    })
    window.setTimeout(() => void ctx.close(), notes.length * 200 + 300)
  } catch {
    /* no audio available: the banner and the title are still there */
  }
}
