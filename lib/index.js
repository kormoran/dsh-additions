/**
 * dsh-additions — commands for DeepSeek Harness.
 *
 * Three host surfaces live here: the `/quit` slash command (see `quit.js`), the
 * `/rename` slash command (see `rename.js`), and the chat move, whose engine is
 * in `move.js` and which is driven by the authenticated routes below and by the
 * browser half. The notification cues and their settings page are described in
 * `sounds.js` and the browser bundle.
 *
 * ## Moving a chat
 *
 * The engine refuses a chat that is still working (turn, subagent, job,
 * reminder), writes the clone, validates it by reading it back, and only then
 * accounts it in the target workspace and archives the original. See
 * `move.js` for the full sequence and the identity rules.
 *
 * @module dsh-additions
 */

import { realpath } from 'node:fs/promises'

import {
  MoveError,
  buildHeader,
  createMoveEngine,
  pathsEqual,
  performMove,
  preflightMove,
  readSource,
  reidentifyDeliveryMarkers,
  resolveTargetWorkspace,
} from './move.js'
import { normalizeQuitConfig, registerQuitCommand } from './quit.js'
import { registerRenameCommand } from './rename.js'
import { SOUND_PATH, normalizeSoundsConfig, readSound } from './sounds.js'
import { STATS_PATH, normalizeStatsConfig, resolveStatsTarget, scanWorkspace } from './workspace-stats.js'

export {
  MoveError,
  buildHeader,
  createMoveEngine,
  pathsEqual,
  performMove,
  preflightMove,
  readSource,
  reidentifyDeliveryMarkers,
  resolveTargetWorkspace,
}

/**
 * Schemastery is the schema library DSH uses for plugin config. It is a normal
 * runtime dependency of this package, because the settings form is built from
 * the `Config` schema below.
 *
 * The import is guarded so the module still loads when the package is missing
 * (a checkout run without an install): `Config` stays undefined, DSH skips
 * config validation, and the settings page is simply absent. The `apply`
 * function logs that condition once.
 */
let z
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = undefined
}

/**
 * Plugin configuration schema — the `additions` settings namespace.
 *
 * DSH derives the profile form from this schema, so a field must be
 * `.volatile()` to appear in the settings page and to be written without
 * remounting the plugin. The notification cue fields are the ones this plugin
 * exposes for live editing: the enable switch and the two audio paths. `volume`
 * stays an ordinary field (editable through the profile patch only), and the
 * remaining blocks keep their historical bundle-config shape.
 *
 * The sounds form is the only part with volatile fields: `settings.describe()`
 * serves exactly `{ sounds: { enabled, ding, approval } }` for this entry.
 */
export const Config =
  z === undefined
    ? undefined
    : z.object({
        archiveSource: z.boolean().default(true),
        quit: z.object({
          command: z.string().default('quit'),
          delayMs: z.number().min(0).max(120000).default(500),
          graceMs: z.number().min(0).max(120000).default(5000),
        }),
        stats: z.object({
          timeLimitMs: z.number().min(0).max(120000).default(10000),
          cacheTtlMs: z.number().min(0).max(600000).default(15000),
          maxEntries: z.number().min(0).max(2000000).default(200000),
          maxBytesRead: z.number().min(0).max(1073741824).default(67108864),
        }),
        sounds: z.object({
          enabled: z.boolean().default(true).volatile(),
          volume: z.number().min(0).max(1).default(0.7),
          ding: z.string().default('').volatile(),
          approval: z.string().default('').volatile(),
        }),
      })

/** Authenticated POST route that performs one move. */
export const MOVE_PATH = '/api/additions.move'
/** Authenticated GET route that answers whether one chat can be moved now. */
export const PREFLIGHT_PATH = '/api/additions.preflight'
/** Authenticated GET route with host-half availability and configuration. */
export const INFO_PATH = '/api/additions.info'

const PLUGIN_NAME = 'dsh-additions'
const VERSION = '0.9.0'

export const name = PLUGIN_NAME
export const inject = [
  'sessions',
  'sessionPersistence',
  'workspaceRegistry',
  'connection',
  'commands',
]

/**
 * Register the slash commands, the authenticated routes, and keep them alive
 * with the plugin.
 * @param ctx - host context carrying the injected services.
 * @param config - bundle config (`archiveSource`, `quit`, `stats`, `sounds`).
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const moves = createMoveEngine()
  const register = (route) => ctx.effect(() => ctx.connection.fetch.register(route))

  if (Config === undefined) {
    const message =
      '@deepseek-ai/schemastery is not installed: the "additions" settings namespace (notification cue paths and switch) is unavailable'
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
  }

  registerQuitCommand(ctx, settings.quit)

  // `/rename` needs the title service; a composition without it keeps every
  // other surface and simply has no rename command.
  ctx.inject(['sessionTitle'], (scope) => registerRenameCommand(scope))

  register({
    path: MOVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleMoveRequest(ctx, settings, moves, request),
  })

  register({
    path: PREFLIGHT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    // Read-only admission probe: the dialog asks before offering destinations,
    // so a running or ineligible chat reports its reason up front.
    fetch: (request) => handlePreflightRequest(ctx, request),
  })

  register({
    path: STATS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleStatsRequest(ctx, settings, request),
  })

  register({
    path: SOUND_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    // The cue config is read on every request: those fields are volatile, so
    // the settings page can repoint a sound without remounting the plugin.
    fetch: (request) => handleSoundRequest(ctx, config?.sounds, request),
  })

  register({
    path: INFO_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () =>
      Promise.resolve(
        json(200, {
          ok: true,
          plugin: PLUGIN_NAME,
          version: VERSION,
          archiveSource: settings.archiveSource,
          quit: settings.quit,
          stats: settings.stats,
          sounds: normalizeSoundsConfig(config?.sounds),
        }),
      ),
  })
}

/**
 * Normalize the bundle config. `archiveSource` defaults to `true`: moving a
 * chat hides the original instead of deleting it. The `quit` block only tunes
 * `/quit` timing (`quit.js`); the `stats` block the workspace scan
 * (`workspace-stats.js`); the `sounds` block the notification cues
 * (`sounds.js`).
 * @param config - raw bundle config.
 * @returns the effective settings.
 */
export function normalizeConfig(config) {
  return {
    archiveSource: config?.archiveSource !== false,
    quit: normalizeQuitConfig(config?.quit),
    stats: normalizeStatsConfig(config?.stats),
    sounds: normalizeSoundsConfig(config?.sounds),
  }
}

/**
 * GET /api/additions.sound handler.
 *
 * Streams one notification cue. The bytes are read on every request (no cache
 * on purpose): replacing a configured file — or repointing it from the settings
 * page — takes effect at the next sound, without reinstalling anything.
 *
 * @param ctx - host context.
 * @param rawSounds - raw `sounds` config block, volatile references included.
 * @param request - GET request whose `which` query names the cue.
 * @returns the audio response, or the JSON error envelope.
 */
async function handleSoundRequest(ctx, rawSounds, request) {
  const which = new URL(request.url).searchParams.get('which') ?? ''
  try {
    const sound = await readSound(which, normalizeSoundsConfig(rawSounds))
    return new Response(sound.bytes, {
      status: 200,
      headers: {
        'content-type': sound.contentType,
        'content-length': String(sound.bytes.byteLength),
        'cache-control': 'no-store',
        'x-additions-sound-source': sound.source,
      },
    })
  } catch (error) {
    if (typeof error?.status === 'number') return errorResponse(error)
    logFailure(ctx, error)
    return errorResponse(
      new MoveError('internal', 500, 'Internal error while reading the sound.', {
        reason: messageOf(error),
      }),
    )
  }
}

/**
 * Cache of settled scans, keyed by canonical path. A workspace that is opened
 * twice in a row answers from memory instead of walking the tree again.
 * @type {Map<string, { at: number, value: object }>}
 */
const statsCache = new Map()

/**
 * GET /api/additions.workspace-stats handler.
 *
 * Answers one workspace's size, directory and file counts, and code/documentation
 * line totals. The scan is bounded; a result that hit a budget reports
 * `truncated` and `exhausted`.
 *
 * @param ctx - host context carrying `workspaceRegistry`.
 * @param settings - normalized bundle config.
 * @param request - GET request whose query names the workspace.
 * @returns the JSON response.
 */
async function handleStatsRequest(ctx, settings, request) {
  const query = new URL(request.url).searchParams
  try {
    const target = await resolveStatsTarget(
      { workspaceId: query.get('workspaceId') ?? undefined, path: query.get('path') ?? undefined },
      { workspaceRegistry: ctx.workspaceRegistry, realpath },
    )
    const cached = statsCache.get(target.path)
    const fresh = cached !== undefined && Date.now() - cached.at <= settings.stats.cacheTtlMs
    const result = fresh ? cached.value : await scanWorkspace(target.path, settings.stats)
    if (!fresh) statsCache.set(target.path, { at: Date.now(), value: result })
    return json(200, { ok: true, workspaceTitle: target.title, cached: fresh, ...result })
  } catch (error) {
    if (typeof error?.status === 'number') return errorResponse(error)
    logFailure(ctx, error)
    return errorResponse(
      new MoveError('internal', 500, 'Internal error while reading the workspace.', {
        reason: messageOf(error),
      }),
    )
  }
}

/**
 * POST /api/additions.move handler.
 * @param ctx - host context.
 * @param settings - normalized bundle config.
 * @param moves - the plugin instance's move engine (locks and request memory).
 * @param request - buffered request whose body is the move input.
 * @returns the JSON response.
 */
async function handleMoveRequest(ctx, settings, moves, request) {
  let input
  try {
    input = await request.json()
  } catch {
    return errorResponse(new MoveError('invalid-body', 400, 'Invalid request body: expected JSON.'))
  }

  try {
    const result = await moves.move(ctx, settings, input)
    return json(200, { ok: true, ...result })
  } catch (error) {
    if (error instanceof MoveError) return errorResponse(error)
    logFailure(ctx, error)
    return errorResponse(
      new MoveError('internal', 500, 'Internal error while moving.', { reason: messageOf(error) }),
    )
  }
}

/**
 * GET /api/additions.preflight handler.
 *
 * Read-only: it never creates, attaches or archives anything. The answer is a
 * normal 200 payload with `movable: false` and a stable `code` for an expected
 * refusal, so the dialog can render a localized reason without treating it as
 * a failure.
 *
 * @param ctx - host context.
 * @param request - GET request whose `sessionId` query names the chat.
 * @returns the JSON response.
 */
async function handlePreflightRequest(ctx, request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId') ?? ''
  try {
    const result = await preflightMove(ctx, { sessionId })
    return json(200, { ok: true, ...result })
  } catch (error) {
    if (error instanceof MoveError) return errorResponse(error)
    logFailure(ctx, error)
    return errorResponse(
      new MoveError('internal', 500, 'Internal error while checking the chat.', {
        reason: messageOf(error),
      }),
    )
  }
}

/**
 * @param error - a caught failure.
 * @returns a displayable message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Log an unexpected failure without breaking the response path.
 * @param ctx - host context.
 * @param error - the failure to report.
 */
function logFailure(ctx, error) {
  const logger = ctx.logger
  if (logger !== undefined && typeof logger.warn === 'function') logger.warn(error)
  else console.warn(`[${PLUGIN_NAME}]`, error)
}

/**
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 * @returns an uncached JSON response.
 */
function json(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * @param error - refusal to render.
 * @returns the JSON error response for it.
 */
function errorResponse(error) {
  return json(error.status, {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  })
}
