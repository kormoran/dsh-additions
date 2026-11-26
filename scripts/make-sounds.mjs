/**
 * Generate the two default notification sounds shipped with `dsh-additions`.
 *
 * Both are synthesised from sine partials — no samples, no third-party audio,
 * so the package stays self-contained and license-clean. Run with:
 *
 * ```powershell
 * node scripts/make-sounds.mjs
 * ```
 *
 * Output (16-bit PCM mono, 22050 Hz):
 *
 * - `assets/ding.wav` — a soft bell: a fast attack and an exponential decay over
 *   a fundamental plus two inharmonic partials;
 * - `assets/uh-oh.wav` — two descending syllables, the "uh" shorter and higher
 *   than the "oh".
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Sample rate of both assets. */
const RATE = 22050
/** Peak amplitude kept below full scale to avoid clipping on summation. */
const PEAK = 0.62

/**
 * Encode mono float samples as a PCM WAV file.
 * @param samples - values in [-1, 1].
 * @returns the WAV bytes.
 */
function encodeWav(samples) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(RATE, 24)
  buffer.writeUInt32LE(RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2)
  }
  return buffer
}

/**
 * Mix a partial into a sample buffer.
 * @param samples - target buffer.
 * @param options - frequency, start, duration, gain and exponential decay.
 */
function addPartial(samples, { frequency, start, duration, gain, decay, glideTo }) {
  const from = Math.floor(start * RATE)
  const length = Math.floor(duration * RATE)
  let phase = 0
  for (let index = 0; index < length; index += 1) {
    const at = index / RATE
    const target = index / length
    const current = glideTo === undefined ? frequency : frequency + (glideTo - frequency) * target
    phase += (2 * Math.PI * current) / RATE
    const envelope = Math.exp(-decay * at) * attack(at)
    const position = from + index
    if (position < samples.length) samples[position] += Math.sin(phase) * gain * envelope
  }
}

/**
 * Short attack ramp so a partial never starts with a click.
 * @param at - seconds since the partial started.
 * @returns the attack gain in [0, 1].
 */
function attack(at) {
  const ramp = 0.008
  return at >= ramp ? 1 : at / ramp
}

/** @returns the bell: fundamental plus two inharmonic partials. */
function bell() {
  const samples = new Float64Array(Math.floor(1.2 * RATE))
  addPartial(samples, { frequency: 1046.5, start: 0, duration: 1.2, gain: PEAK, decay: 4.2 })
  addPartial(samples, { frequency: 2093, start: 0, duration: 0.7, gain: PEAK * 0.38, decay: 7.5 })
  addPartial(samples, { frequency: 3139.5, start: 0, duration: 0.35, gain: PEAK * 0.16, decay: 12 })
  return normalize(samples)
}

/** @returns the "uh oh": two descending syllables. */
function uhOh() {
  const samples = new Float64Array(Math.floor(0.72 * RATE))
  addPartial(samples, { frequency: 660, glideTo: 600, start: 0, duration: 0.2, gain: PEAK * 0.85, decay: 4.5 })
  addPartial(samples, { frequency: 1320, glideTo: 1200, start: 0, duration: 0.16, gain: PEAK * 0.16, decay: 7 })
  addPartial(samples, { frequency: 440, glideTo: 360, start: 0.28, duration: 0.42, gain: PEAK, decay: 3.4 })
  addPartial(samples, { frequency: 880, glideTo: 720, start: 0.28, duration: 0.3, gain: PEAK * 0.18, decay: 5 })
  return normalize(samples)
}

/**
 * Scale a buffer so its loudest sample sits at {@link PEAK}.
 * @param samples - raw mix.
 * @returns the scaled buffer.
 */
function normalize(samples) {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (peak === 0) return samples
  const factor = PEAK / peak
  for (let index = 0; index < samples.length; index += 1) samples[index] *= factor
  return samples
}

const here = dirname(fileURLToPath(import.meta.url))
const assets = join(here, '..', 'assets')
await mkdir(assets, { recursive: true })
await writeFile(join(assets, 'ding.wav'), encodeWav(bell()))
await writeFile(join(assets, 'uh-oh.wav'), encodeWav(uhOh()))
console.log(`wrote ${join(assets, 'ding.wav')}`)
console.log(`wrote ${join(assets, 'uh-oh.wav')}`)
