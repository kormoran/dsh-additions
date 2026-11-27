/**
 * The chat-move engine for `dsh-additions`.
 *
 * A chat is an event-sourced session log: its workspace membership is the
 * directory that owns the log, and the log header carries the recorded cwd.
 * There is no official "change the workspace of this session" primitive, so a
 * move is performed as a clone with history:
 *
 * 1. read the source session (live in memory, or through persistence);
 * 2. refuse a session that is still working (turn, subagent, job, reminder);
 * 3. write a NEW persisted log whose header carries the target workspace's
 *    canonical path, appending the source events with the clone's own delivery
 *    watermarks re-pointed at its new identity;
 * 4. validate the clone by re-opening it and reading the log back;
 * 5. only then account it in the target workspace and archive the original.
 *
 * A failed validation or attachment never archives the original: the copy is
 * cleaned up best-effort and the caller receives a stable refusal code.
 *
 * The clone keeps a new id — the moved chat is a copy with history, not the
 * same identity — and it does not need the source's single-writer lock, so a
 * chat that is currently open can be moved too, as long as it is idle.
 *
 * @module dsh-additions/move
 */

import { randomUUID } from 'node:crypto'
import { realpath, rm, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

/** Log-only watermark written by the official DeepSeek log uploader. */
const DELIVERY_ACCEPTED = 'session-log-deepseek/delivery-accepted'
/**
 * A usable session id: non-empty, free of whitespace, control characters and
 * path separators. Ids are only used for lookups and as the clone's lineage,
 * but a separator would make a backend-derived path ambiguous.
 */
const SESSION_ID_PATTERN = /^[^\s\u0000-\u001f\u007f/\\]+$/u
/** How many settled `requestId` answers one engine retains. */
const REQUEST_MEMORY = 50

/**
 * Every refusal code this module can answer with. `lib/index.js` adds the two
 * route-level codes (`invalid-body`, `internal`); the browser bundle maps each
 * code to a localized reason and a test keeps the two lists in sync.
 */
export const MOVE_ERROR_CODES = Object.freeze([
  'missing-session',
  'invalid-session-id',
  'session-not-found',
  'subagent-session',
  'empty-session',
  'unsupported-format',
  'source-busy',
  'same-workspace',
  'workspace-not-found',
  'missing-target',
  'relative-path',
  'invalid-path',
  'workspace-create-failed',
  'move-in-progress',
  'clone-invalid',
  'attach-failed',
])

/**
 * A move refusal with a stable machine code and the HTTP status the route
 * answers with. Business failures are expected and carry an English message
 * the browser localizes by `code` when it knows it.
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

/**
 * Compare two canonical paths the way the platform's filesystem does.
 * @param left - first path.
 * @param right - second path.
 * @param platform - platform id, injectable for tests.
 * @returns whether both name the same location.
 */
export function pathsEqual(left, right, platform = process.platform) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  return platform === 'win32' || platform === 'darwin' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * Move one chat to another workspace.
 *
 * @param ctx - host context carrying `sessions`, `sessionPersistence` and `workspaceRegistry`.
 * @param settings - normalized bundle config.
 * @param input - `{ sessionId, workspaceId? | targetPath?, keepOriginal?, requestId? }`.
 * @returns the receipt: new session id, target workspace, copied event count and archive outcome.
 * @throws {MoveError} for every expected refusal.
 */
export async function performMove(ctx, settings, input) {
  const request = input ?? {}
  const sessionId = readString(request.sessionId)
  if (!sessionId) throw new MoveError('missing-session', 400, 'Missing the chat to move.')
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new MoveError('invalid-session-id', 400, 'Invalid chat id.')

  const source = await readSource(ctx, sessionId)
  assertMovable(source)
  await assertIdle(ctx, sessionId)

  const target = await resolveTargetWorkspace(ctx, request)
  if (await isSameDirectory(source.header.cwd, target.path)) {
    throw new MoveError('same-workspace', 409, 'The chat is already in this workspace.')
  }

  const newSessionId = `session-${randomUUID()}`
  const header = buildHeader(source.header, newSessionId, target.path, source.inheritedEventCount)
  const written = reidentifyDeliveryMarkers(source.events, newSessionId, source.inheritedEventCount)
  const location = await writeClone(ctx, header, written, source.inheritedEventCount)

  const validation = await validateClone(ctx, newSessionId, header, written, source.inheritedEventCount)
  if (!validation.ok) {
    const cleaned = await cleanupClone(ctx, newSessionId)
    throw new MoveError(
      'clone-invalid',
      500,
      `The copy was written but could not be validated (${validation.reason}); the original was not archived.`,
      { sessionId: newSessionId, reason: validation.reason, cleaned },
    )
  }

  try {
    await target.attachSession(newSessionId)
  } catch (error) {
    const cleaned = await cleanupClone(ctx, newSessionId)
    throw new MoveError(
      'attach-failed',
      500,
      `The copy was created (${newSessionId}) but could not be registered in workspace "${target.title}": ${messageOf(error)}`,
      { sessionId: newSessionId, workspace: target.title, reason: messageOf(error), cleaned },
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
    validated: true,
    archived: archive.archived,
    archiveError: archive.error,
  }
}

/**
 * Answer whether one chat can be moved right now, without moving it. The
 * browser dialog asks this before offering destinations, so a running or
 * otherwise ineligible chat reports its reason instead of failing after the
 * operator picked a workspace.
 *
 * @param ctx - host context.
 * @param input - `{ sessionId }`.
 * @returns `{ movable: true, source }` or `{ movable: false, code, message, details? }`.
 */
export async function preflightMove(ctx, input) {
  const sessionId = readString(input?.sessionId)
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    return { movable: false, code: 'invalid-session-id', message: 'Invalid chat id.' }
  }
  try {
    const source = await readSource(ctx, sessionId)
    const problem = movabilityProblem(source)
    if (problem !== undefined) return { movable: false, ...problem }
    const activity = await queryActivity(ctx, sessionId)
    if (activity.length > 0) {
      return {
        movable: false,
        code: 'source-busy',
        message: 'This chat is running: finish or stop its work before moving it.',
        details: { activity },
      }
    }
    return {
      movable: true,
      source: {
        sessionId,
        cwd: source.header.cwd ?? null,
        live: source.live,
        events: source.events.length,
        formatStatus: source.formatStatus ?? null,
      },
    }
  } catch (error) {
    if (error instanceof MoveError) {
      return {
        movable: false,
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      }
    }
    throw error
  }
}

/**
 * Create the stateful move engine: one per plugin instance, so concurrent
 * moves of the same chat are serialized and one `requestId` always answers the
 * same settled copy.
 *
 * @returns `{ move, preflight }`.
 */
export function createMoveEngine() {
  /** In-flight move per source session id. */
  const locks = new Map()
  /** Fulfilled `requestId` answers, oldest first. */
  const settled = new Map()

  const remember = (requestId, run) => {
    settled.set(requestId, run)
    run.catch(() => {
      // A failed request may be retried with the same id.
      if (settled.get(requestId) === run) settled.delete(requestId)
    })
    while (settled.size > REQUEST_MEMORY) {
      const oldest = settled.keys().next().value
      settled.delete(oldest)
    }
  }

  return {
    preflight: (ctx, input) => preflightMove(ctx, input),
    async move(ctx, settings, input) {
      const requestId = readString(input?.requestId)
      if (requestId !== undefined) {
        const answer = settled.get(requestId)
        if (answer !== undefined) return answer
      }

      const sessionId = readString(input?.sessionId)
      if (sessionId !== undefined && locks.has(sessionId)) {
        throw new MoveError(
          'move-in-progress',
          409,
          'Another move of this chat is already in progress.',
          { sessionId },
        )
      }

      const run = performMove(ctx, settings, input)
      if (sessionId !== undefined) locks.set(sessionId, run)
      if (requestId !== undefined) remember(requestId, run)
      try {
        return await run
      } finally {
        if (sessionId !== undefined && locks.get(sessionId) === run) locks.delete(sessionId)
      }
    },
  }
}

/**
 * Read one source session's header and complete event log. A live session is
 * read from memory, because its newest events may not be durable yet; a cold
 * one is read through the persistence seam without taking write ownership.
 *
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
 * Refuse a session that must not be cloned.
 * @param source - result of {@link readSource}.
 * @returns a refusal payload, or undefined when the session is movable.
 */
function movabilityProblem(source) {
  if (source.header.origin === 'subagent') {
    return {
      code: 'subagent-session',
      message: 'This is a subagent session: it cannot be moved to a workspace. Move the main chat.',
    }
  }
  if (source.events.length === 0) {
    return { code: 'empty-session', message: 'The chat is empty: there is nothing to move.' }
  }
  if (!Number.isSafeInteger(source.header.version) || source.header.version < 1) {
    return {
      code: 'unsupported-format',
      message: 'The chat log has no readable format version.',
      details: { version: source.header.version ?? null },
    }
  }
  return undefined
}

/**
 * @param source - result of {@link readSource}.
 * @throws {MoveError} when the session cannot be cloned.
 */
function assertMovable(source) {
  const problem = movabilityProblem(source)
  if (problem !== undefined) throw new MoveError(problem.code, 409, problem.message, problem.details)
}

/**
 * Ask every composed activity provider what still runs for a session.
 *
 * The registry's own archive admission uses the same waterfall, so this is the
 * product's definition of "busy": a running turn, subagent descendants, owned
 * background jobs, and active reminders. A composition without providers (or a
 * provider failure) reports nothing; the move then proceeds and the archive
 * step still asks the providers to stop any work.
 *
 * @param ctx - host context.
 * @param sessionId - session to inspect.
 * @returns the reported activity families.
 */
async function queryActivity(ctx, sessionId) {
  if (typeof ctx.waterfall !== 'function') return []
  try {
    const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    return Array.isArray(activity) ? activity : []
  } catch (error) {
    logFailure(ctx, error)
    return []
  }
}

/**
 * Refuse a session that is still working.
 * @param ctx - host context.
 * @param sessionId - session about to be copied.
 * @throws {MoveError} with the reported activity families attached.
 */
async function assertIdle(ctx, sessionId) {
  const activity = await queryActivity(ctx, sessionId)
  if (activity.length === 0) return
  throw new MoveError(
    'source-busy',
    409,
    'This chat is running: finish or stop its work before moving it.',
    { sessionId, activity },
  )
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
 * verbatim copy makes the clone unreadable. Markers inside an inherited fork
 * prefix keep naming the ancestor: the format exempts them, exactly as for a
 * fork. Other identity fields are deliberately left alone: `job/registered`
 * and `job/settled` carry the original owner because copied history does not
 * transfer execution ownership, and `subagent/catalog` names child sessions.
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
 * Write the clone through the persistence seam: create, append the prepared
 * events, flush so the log is materialized for other readers and for the
 * workspace registry, then release write ownership.
 * @param ctx - host context.
 * @param header - clone header.
 * @param events - events with their original contiguous seqs.
 * @param inheritedEventCount - source fork-inherited prefix length.
 * @returns the materialized artifact path when the backend reports one.
 */
async function writeClone(ctx, header, events, inheritedEventCount) {
  const handle = await ctx.sessionPersistence.create(header, {
    inheritedEventCount: header.isSeeded ? inheritedEventCount : 0,
  })
  try {
    await handle.append(events)
    await handle.flush()
  } finally {
    await handle.close()
  }
  const stored = await ctx.sessionPersistence.stat(header.id)
  return stored?.location?.path
}

/**
 * Re-open the clone read-only and prove it carries exactly what was written:
 * its own identity and cwd, the intended seed cut, a dense sequence from zero,
 * the same event types and timestamps, and delivery markers naming the clone.
 *
 * @param ctx - host context.
 * @param sessionId - clone identity.
 * @param header - header handed to persistence.
 * @param written - events appended to the clone.
 * @param inheritedEventCount - source fork-inherited prefix length.
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export async function validateClone(ctx, sessionId, header, written, inheritedEventCount) {
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    const { events } = await handle.read(0)
    const stored = handle.header
    const problems = []
    if (String(stored.id) !== String(sessionId)) problems.push('id')
    if ((stored.cwd ?? null) !== (header.cwd ?? null)) problems.push('cwd')
    if (stored.isSeeded !== header.isSeeded) problems.push('seeded')
    const expectedCut = header.isSeeded ? inheritedEventCount : 0
    if (Number(handle.inheritedEventCount ?? 0) !== expectedCut) problems.push('cut')
    if (events.length !== written.length) problems.push('count')
    const limit = Math.min(events.length, written.length)
    for (let index = 0; index < limit; index += 1) {
      if (Number(events[index].seq) !== index) {
        problems.push(`seq:${index}`)
        break
      }
      if (events[index].type !== written[index].type) {
        problems.push(`type:${index}`)
        break
      }
      if (events[index].time !== written[index].time) {
        problems.push(`time:${index}`)
        break
      }
    }
    for (const event of events) {
      if (event.type !== DELIVERY_ACCEPTED) continue
      if (Number(event.seq) < expectedCut) continue
      if (String(event.data?.sessionId) !== String(sessionId)) {
        problems.push('delivery-marker')
        break
      }
    }
    return problems.length === 0 ? { ok: true } : { ok: false, reason: problems.join(',') }
  } finally {
    await handle.close()
  }
}

/**
 * Best-effort removal of an unvalidated or unregistered clone. Only an
 * absolute artifact path is touched, and only the artifact file: a relative or
 * backend-specific location is reported as not cleaned instead of risking a
 * stray removal.
 *
 * @param ctx - host context.
 * @param sessionId - clone to remove.
 * @returns whether the artifact was removed.
 */
export async function cleanupClone(ctx, sessionId) {
  try {
    const snapshot = await ctx.sessionPersistence.stat(sessionId)
    const location = snapshot?.location?.path
    if (typeof location !== 'string' || !isAbsolute(location)) return false
    await rm(location, { force: true })
    await rmdir(dirname(location)).catch(() => {})
    return true
  } catch (error) {
    logFailure(ctx, error)
    return false
  }
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
  if (a === undefined || b === undefined) return false
  return pathsEqual(a, b)
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
  else console.warn('[dsh-additions]', error)
}
