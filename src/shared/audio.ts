let context: AudioContext | null = null

/** Lazily create (and reuse) a single AudioContext. */
export function getAudioContext(): AudioContext {
  if (!context) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext
    if (!Ctor) {
      throw new Error('Web Audio API is not supported in this browser')
    }
    context = new Ctor()
  }
  return context
}

/**
 * Resume the AudioContext. iOS keeps it "suspended" until a user gesture,
 * so this is called from the first pointerdown (see GameFrame).
 */
export function unlockAudio(): void {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
}

/** Play a short synthesized tone — no audio assets required. */
export function playTone(
  frequency: number,
  durationMs = 120,
  type: OscillatorType = 'sine',
  gain = 0.12,
): void {
  const ctx = getAudioContext()
  if (ctx.state !== 'running') return

  const oscillator = ctx.createOscillator()
  const envelope = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.value = frequency
  oscillator.connect(envelope)
  envelope.connect(ctx.destination)

  const now = ctx.currentTime
  const end = now + durationMs / 1000
  envelope.gain.setValueAtTime(gain, now)
  envelope.gain.exponentialRampToValueAtTime(0.0001, end)
  oscillator.start(now)
  oscillator.stop(end)
}
