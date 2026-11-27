/**
 * dsh-additions — commands for DeepSeek Harness.
 *
 * Three host surfaces live here: the `/quit` slash command (see `quit.js`), the
 * `/rename` slash command (see `rename.js`), and the chat move, which is driven
 * by the authenticated routes below and by the browser half. The notification
 * cues and their settings page are described in `sounds.js` and the browser
 * bundle.
 *
 * ## Moving a chat
 *
 * A chat is an event-sourced session log: its workspace membership is the
 * directory that owns the log, and the log header carries the recorded cwd.
 * There is no official "change the workspace of this session" primitive, so a
 * move is performed as a clone with history:
 *
 * 1. read the source session (live in memory, or from session persistence);
 * 2. write a NEW persisted log whose header carries the target workspace's
 *    canonical path, appending the source events and re-pointing the clone's
 *    own delivery-accepted markers at its new identity;
 * 3. account the new session under the target workspace registry record;
 * 4. archive (hide) the original, reversibly, unless asked to keep it.
 *
 * The clone keeps a new id — the moved chat is a copy with history, not the
 * same identity — and it does not need the source's single-writer lock, so a
 * chat that is currently open can be moved too. What does not travel:
 * subagent sessions, AGENTS.md / skills / project files (the moved chat reads
 * the new workspace's), and local folder permissions.
 *
 * @module dsh-additions
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { normalizeQuitConfig, registerQuitCommand } from './quit.js'
import { registerRenameCommand } from './rename.js'
import { SOUND_PATH, normalizeSoundsConfig, readSound } from './sounds.js'
import { STATS_PATH, normalizeStatsConfig, resolveStatsTarget, scanWorkspace } from './workspace-stats.js'

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
/** Authenticated GET route with host-half availability and configuration. */
export const INFO_PATH = '/api/additions.info'

const PLUGIN_NAME = 'dsh-additions'
const VERSION = '0.8.0'
/**
 * Log-only watermark written by the official DeepSeek log uploader. Its
 * `sessionId` must name the Session that owns the current format generation.
 */
const DELIVERY_ACCEPTED = 'session-log-deepseek/delivery-accepted'
/**
 * A usable session id: non-empty and free of whitespace or control characters.
 * The id is only ever used for lookups (the clone gets a fresh uuid), so this
 * deliberately accepts every spelling a deployment may have minted.
 */
const SESSION_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]+$/u

/**
 * A move refusal with a stable machine code and the HTTP status the route
 * answers with. Business failures are expected and carry Italian copy the
 * browser surface can show verbatim.
 */
export class MoveError extends Error {
  /**
   * @param code - stable machine-readable code the browser localizes.
   * @param status - HTTP status for the route answer.
   * @param message - locale-neutral English fallback for API consumers.
   * @param details - optional placeholder values (`sessionId`, `path`, ...).
   */
  constructor(code, status, message, details) {
    super(message)
    this.name = 'MoveError'
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }
}

export const name = PLUGIN_NAME
export const inject = [
  'sessions',
  'sessionPersistence',
  'workspaceRegistry',
  'connection',
  'commands',
]

/**
 * Register the slash command, the authenticated routes, and keep them alive
 * with the plugin.
 * @param ctx - host context carrying the injected services.
 * @param config - bundle config (`archiveSource`, `quit`, `stats`).
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
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
    fetch: (request) => handleMoveRequest(ctx, settings, request),
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
 * @param request - buffered request whose body is the move input.
 * @returns the JSON response.
 */
async function handleMoveRequest(ctx, settings, request) {
  let input
  try {
    input = await request.json()
  } catch {
    return errorResponse(new MoveError('invalid-body', 400, 'Invalid request body: expected JSON.'))
  }

  try {
    const result = await performMove(ctx, settings, input)
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
 * Move one chat to another workspace.
 *
 * @param ctx - host context carrying `sessions`, `sessionPersistence` and `workspaceRegistry`.
 * @param settings - normalized bundle config.
 * @param input - `{ sessionId, workspaceId? | targetPath?, keepOriginal? }`.
 * @returns the receipt: new session id, target workspace, copied event count and archive outcome.
 * @throws {MoveError} for every expected refusal.
 */
export async function performMove(ctx, settings, input) {
  const request = input ?? {}
  const sessionId = readString(request.sessionId)
  if (!sessionId) throw new MoveError('missing-session', 400, 'Missing the chat to move.')
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new MoveError('invalid-session-id', 400, 'Invalid chat id.')
  }

  const source = await readSource(ctx, sessionId)
  if (source.header.origin === 'subagent') {
    throw new MoveError(
      'subagent-session',
      409,
      'This is a subagent session: it cannot be moved to a workspace. Move the main chat.',
    )
  }
  if (source.events.length === 0) {
    throw new MoveError('empty-session', 409, 'The chat is empty: there is nothing to move.')
  }

  const target = await resolveTargetWorkspace(ctx, request)
  if (await isSameDirectory(source.header.cwd, target.path)) {
    throw new MoveError('same-workspace', 409, 'The chat is already in this workspace.')
  }

  const newSessionId = `session-${randomUUID()}`
  const header = buildHeader(source.header, newSessionId, target.path, source.inheritedEventCount)
  const location = await writeClone(ctx, header, source.events, source.inheritedEventCount)

  try {
    await target.attachSession(newSessionId)
  } catch (error) {
    throw new MoveError(
      'attach-failed',
      500,
      `The copy was created (${newSessionId}) but could not be registered in workspace "${target.title}": ${messageOf(error)}`,
      { sessionId: newSessionId, workspace: target.title, reason: messageOf(error) },
    )
  }

  const archive = await archiveSource(ctx, settings, request, sessionId)

  return {
    sessionId: newSessionId,
    workspaceId: String(target.id),
    workspaceTitle: target.title,
    workspacePath: target.path,
    source: {
      sessionId,
      cwd: source.header.cwd ?? null,
      live: source.live,
      formatStatus: source.formatStatus ?? null,
    },
    events: source.events.length,
    location: location ?? null,
    archived: archive.archived,
    archiveError: archive.error,
  }
}

/**
 * Read one source session's header and complete event log. A live session is
 * read from memory, because its newest events may not be durable yet; a cold
 * one is read through the persistence seam without taking write ownership.
 * @param ctx - host context.
 * @param sessionId - session to read.
 * @returns header, events, fork cut, and where they came from.
 * @throws {MoveError} when the session does not exist.
 */
export async function readSource(ctx, sessionId) {
  const live = ctx.sessions.get(sessionId)
  if (live) {
    return {
      header: live.header,
      events: live.snapshotEvents(),
      inheritedEventCount: live.inheritedEventCount ?? 0,
      live: true,
      formatStatus: undefined,
    }
  }

  const snapshot = await ctx.sessionPersistence.stat(sessionId)
  if (snapshot === undefined) {
    throw new MoveError('session-not-found', 404, `Chat "${sessionId}" was not found.`, { sessionId })
  }

  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    const { events } = await handle.read(0)
    return {
      header: handle.header,
      events,
      inheritedEventCount: handle.inheritedEventCount ?? 0,
      live: false,
      formatStatus: snapshot.formatStatus,
    }
  } finally {
    await handle.close()
  }
}

/**
 * Resolve the requested destination to a durable workspace record. An existing
 * unregistered directory is adopted as a new workspace; a registered id wins.
 * @param ctx - host context.
 * @param input - move input naming `workspaceId` or `targetPath`.
 * @returns the target workspace entity.
 */
export async function resolveTargetWorkspace(ctx, input) {
  const registry = ctx.workspaceRegistry
  const workspaceId = readString(input.workspaceId)
  if (workspaceId) {
    const workspace = registry.get(workspaceId)
    if (workspace === undefined) {
      throw new MoveError('workspace-not-found', 404, 'The destination workspace no longer exists.', {
        workspaceId: String(workspaceId),
      })
    }
    return workspace
  }

  const raw = readString(input.targetPath)
  if (!raw) {
    throw new MoveError('missing-target', 400, 'Choose a destination workspace or folder.')
  }
  if (!isAbsolute(raw)) {
    throw new MoveError('relative-path', 400, 'The destination path must be absolute.', { path: raw })
  }

  const path = resolve(raw)
  let existing
  try {
    existing = await registry.resolveByPath(path)
  } catch (error) {
    throw new MoveError('invalid-path', 400, `The folder "${path}" cannot be used: ${messageOf(error)}.`, {
      path,
      reason: messageOf(error),
    })
  }
  if (existing !== undefined) return existing

  try {
    return await registry.create(path)
  } catch (error) {
    throw new MoveError(
      'workspace-create-failed',
      400,
      `Cannot use "${path}" as a workspace: ${messageOf(error)}`,
      { path, reason: messageOf(error) },
    )
  }
}

/**
 * Build the cloned session header: same logical format version, new identity,
 * the target workspace path as cwd, and the source's fork cut.
 *
 * The cut matters: the copied log is byte-identical in shape to the source, so
 * a log containing an inherited `session/end-seed` marker must stay a seeded
 * header — the current format refuses an unseeded header whose log carries
 * that marker. An ordinary chat has no marker and stays unseeded. A recorded
 * agent preset travels so the moved chat keeps the same tools and prompt.
 *
 * @param sourceHeader - header of the source session.
 * @param newSessionId - identity of the clone.
 * @param cwd - canonical target workspace path.
 * @param inheritedEventCount - source fork-inherited prefix length.
 * @returns the header handed to persistence.
 */
export function buildHeader(sourceHeader, newSessionId, cwd, inheritedEventCount = 0) {
  const seeded = sourceHeader.isSeeded === true
  return {
    version: Number.isSafeInteger(sourceHeader.version) ? sourceHeader.version : 4,
    id: newSessionId,
    createdAt: Date.now(),
    cwd,
    isSeeded: seeded,
    ...(typeof sourceHeader.agentPreset === 'string' ? { agentPreset: sourceHeader.agentPreset } : {}),
  }
}

/**
 * Re-point the clone's own delivery-accepted markers at its new identity.
 *
 * The DeepSeek log uploader appends a `delivery-accepted` watermark whose
 * `sessionId` names the Session that accepted the uploaded log. The shipped
 * format refuses a current-generation marker naming a foreign Session, so a
 * verbatim copy makes the clone unreadable ("current-generation delivery
 * marker names the wrong Session"). Markers inside an inherited fork prefix
 * keep naming the ancestor: the format exempts them, exactly as for a fork.
 *
 * @param events - source events.
 * @param sessionId - identity of the clone.
 * @param inheritedEventCount - source fork-inherited prefix length.
 * @returns the events to append, with only the changed markers copied.
 */
export function reidentifyDeliveryMarkers(events, sessionId, inheritedEventCount = 0) {
  let changed = false
  const rewritten = events.map((event) => {
    if (event.type !== DELIVERY_ACCEPTED || event.seq < inheritedEventCount) return event
    const data = event.data
    if (data === null || typeof data !== 'object' || data.sessionId === sessionId) return event
    changed = true
    return { ...event, data: { ...data, sessionId } }
  })
  return changed ? rewritten : events
}

/**
 * Write the clone through the persistence seam: create, append the source
 * events, flush so the log is materialized for other readers and for the
 * workspace registry, then release write ownership.
 * @param ctx - host context.
 * @param header - clone header.
 * @param events - source events with their original contiguous seqs.
 * @param inheritedEventCount - source fork-inherited prefix length.
 * @returns the materialized artifact path when the backend reports one.
 */
async function writeClone(ctx, header, events, inheritedEventCount) {
  const handle = await ctx.sessionPersistence.create(header, {
    inheritedEventCount: header.isSeeded ? inheritedEventCount : 0,
  })
  try {
    await handle.append(reidentifyDeliveryMarkers(events, header.id, inheritedEventCount))
    await handle.flush()
  } finally {
    await handle.close()
  }
  const stored = await ctx.sessionPersistence.stat(header.id)
  return stored?.location?.path
}

/**
 * Hide the original chat in the registry-global archive set. Archiving is
 * reversible and never touches the source log, so the move can be undone with
 * the Workspace "unarchive" action.
 * @param ctx - host context.
 * @param settings - normalized bundle config.
 * @param input - move input (`keepOriginal` overrides the config per call).
 * @param sessionId - source session to hide.
 * @returns whether the archive is durable, and the failure text when it is not.
 */
async function archiveSource(ctx, settings, input, sessionId) {
  if (input.keepOriginal === true || settings.archiveSource !== true) return { archived: false }

  try {
    await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
    return { archived: true }
  } catch (error) {
    logFailure(ctx, error)
    return { archived: false, error: messageOf(error) }
  }
}

/**
 * Compare two recorded directories canonically, tolerating a missing path (a
 * dangling cwd is compared in absolute spelling instead of failing the move).
 * @param left - first directory, possibly absent.
 * @param right - second directory.
 * @returns whether both name the same directory.
 */
async function isSameDirectory(left, right) {
  const a = await canonicalPath(left)
  const b = await canonicalPath(right)
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase()
}

/**
 * @param path - recorded directory path.
 * @returns its realpath, its absolute spelling when realpath fails, or undefined.
 */
async function canonicalPath(path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  try {
    return await realpath(path)
  } catch {
    return isAbsolute(path) ? resolve(path) : undefined
  }
}

/**
 * @param text - candidate request field.
 * @returns the trimmed string, or undefined for anything else.
 */
function readString(text) {
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : undefined
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
