/**
 * Notification sounds for `dsh-additions`.
 *
 * Two cues, both shipped as small synthesised WAV files in `assets/`:
 *
 * - `ding` — the model finished its turn;
 * - `approval` — something is waiting for a permission decision.
 *
 * The browser cannot read the host filesystem, so the files are served by an
 * authenticated route (`GET /api/additions.sound?which=…`). Either cue can be
 * replaced from the bundle config (`sounds.ding`, `sounds.approval`): an
 * absolute path to any audio file the browser can decode. A configured file
 * that cannot be read falls back to the packaged asset and the response says so
 * in a header, so a typo costs nobody their notification.
 *
 * @module dsh-additions/sounds
 */

import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Authenticated route that streams one notification sound. */
export const SOUND_PATH = '/api/additions.sound'
/** Cue names the route accepts. */
export const SOUND_KINDS = ['ding', 'approval']
/** Default playback gain the browser half applies. */
export const DEFAULT_VOLUME = 0.7

/** Packaged assets, one per cue. */
const ASSETS = {
  ding: new URL('../assets/ding.wav', import.meta.url),
  approval: new URL('../assets/uh-oh.wav', import.meta.url),
}

/** Audio content types by extension. */
const CONTENT_TYPES = {
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}

/**
 * Normalize the `sounds` bundle config.
 *
 * @param config - raw config (`{ enabled?, volume?, ding?, approval? }`).
 * @returns `{ enabled, volume, ding, approval }`, with `null` for "use the asset".
 */
export function normalizeSoundsConfig(config) {
  const raw = config ?? {}
  return {
    enabled: raw.enabled !== false,
    volume: readVolume(raw.volume),
    ding: readPath(raw.ding),
    approval: readPath(raw.approval),
  }
}

/**
 * Read one cue.
 *
 * @param which - `ding` or `approval`.
 * @param config - normalized sounds config.
 * @returns `{ bytes, contentType, source, name }`.
 * @throws an error with `code`/`status` for an unknown cue.
 */
export async function readSound(which, config) {
  if (!SOUND_KINDS.includes(which)) {
    const error = new Error(`Unknown sound cue "${String(which)}".`)
    error.code = 'unknown-sound'
    error.status = 400
    error.details = { which: String(which), kinds: SOUND_KINDS }
    throw error
  }

  const custom = config?.[which] ?? null
  if (typeof custom === 'string' && custom.length > 0) {
    try {
      const bytes = await readFile(custom)
      return {
        bytes,
        contentType: contentTypeOf(custom),
        source: 'custom',
        name: custom,
      }
    } catch {
      // A configured file that vanished must not silence the cue.
    }
  }

  const asset = ASSETS[which]
  const bytes = await readFile(fileURLToPath(asset))
  return {
    bytes,
    contentType: contentTypeOf(asset.pathname),
    source: 'default',
    name: `assets/${which === 'ding' ? 'ding' : 'uh-oh'}.wav`,
  }
}

/**
 * @param path - file path or URL pathname.
 * @returns the audio content type, or a safe binary type.
 */
function contentTypeOf(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * @param value - candidate volume.
 * @returns a gain in `[0, 1]`.
 */
function readVolume(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(1, Math.max(0, value))
}

/**
 * @param value - candidate path.
 * @returns the absolute path, or null when unset/unusable.
 */
function readPath(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return isAbsolute(trimmed) ? trimmed : null
}
