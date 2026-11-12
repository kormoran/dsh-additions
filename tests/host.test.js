import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MOVE_PATH, INFO_PATH, MoveError, apply, buildHeader, performMove, reidentifyDeliveryMarkers } from '../lib/index.js'

/**
 * In-memory stand-in for the persistence seam. It enforces the same
 * contiguity rule and the same in-process visibility of a created session.
 */
class MemoryPersistence {
  constructor() {
    this.sessions = new Map()
  }

  async create(header, options) {
    if (this.sessions.has(header.id)) throw new Error(`session ${header.id} already exists`)
    const record = {
      header: structuredClone(header),
      events: [],
      flushed: false,
      inheritedEventCount: options?.inheritedEventCount ?? 0,
    }
    this.sessions.set(header.id, record)
    return this.#handle(record, 'write')
  }

  async open(id, access) {
    const record = this.sessions.get(id)
    if (record === undefined) throw new Error(`session ${id} not found`)
    return this.#handle(record, access)
  }

  #handle(record, access) {
    return {
      id: record.header.id,
      header: record.header,
      inheritedEventCount: record.inheritedEventCount,
      access,
      read: async (offset = 0) => ({ eventState: 'detached', events: record.events.slice(offset) }),
      append: async (batch) => {
        const next = record.events.length
        batch.forEach((event, index) => {
          if (event.seq !== next + index) throw new Error(`non-contiguous batch at seq ${event.seq}`)
        })
        record.events.push(...batch.map((event) => structuredClone(event)))
      },
      flush: async () => {
        record.flushed = true
      },
      close: async () => {},
    }
  }

  async stat(id) {
    const record = this.sessions.get(id)
    if (record === undefined) return undefined
    return {
      header: record.header,
      revision: 'rev',
      eventCount: record.events.length,
      ...(record.flushed ? { location: { kind: 'jsonl', path: `<memory>/${id}` } } : {}),
    }
  }

  async list() {
    return [...this.sessions.values()].map((record) => ({ header: record.header }))
  }
}

/**
 * Registry stand-in over real directories: symbols resolve through `realpath`
 * like the shipped registry, and attaching records the accounted id.
 */
class FakeRegistry {
  constructor() {
    this.records = new Map()
    this.archived = []
    this.archiveError = undefined
  }

  get(id) {
    return [...this.records.values()].find((workspace) => workspace.id === id)
  }

  list() {
    return [...this.records.values()]
  }

  async resolveByPath(path) {
    const info = await stat(path)
    if (!info.isDirectory()) throw new Error('ENOTDIR')
    return this.records.get(await realpath(path))
  }

  async create(path) {
    const canonical = await realpath(path)
    if (this.records.has(canonical)) return this.records.get(canonical)
    const workspace = {
      id: `ws-${this.records.size + 1}`,
      path: canonical,
      title: canonical.split(/[\\/]/u).pop() || canonical,
      sessionIds: [],
      attachSession: async (sessionId) => {
        workspace.sessionIds.push(sessionId)
      },
      status: async () => 'ok',
    }
    this.records.set(canonical, workspace)
    return workspace
  }

  async archiveSession(sessionId, options) {
    if (this.archiveError !== undefined) throw this.archiveError
    this.archived.push({ sessionId, options })
  }
}

/**
 * @param seq - event sequence number.
 * @returns one durable-looking event.
 */
function event(seq) {
  return { type: 'user/message', seq, time: 1_700_000_000_000 + seq, data: { text: `message ${seq}` } }
}

/**
 * Build a host-context stand-in over the two fakes.
 * @param options - source sessions to install.
 * @returns the context, its parts, and a directory helper.
 */
async function harness(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chatshifter-'))
  const sourceDir = join(root, 'source-project')
  const targetDir = join(root, 'target-project')
  await mkdir(sourceDir, { recursive: true })
  await mkdir(targetDir, { recursive: true })

  const persistence = new MemoryPersistence()
  const registry = new FakeRegistry()
  const live = new Map()

  const ctx = {
    sessions: {
      get: (id) => live.get(id),
      list: () => [...live.values()],
    },
    sessionPersistence: persistence,
    workspaceRegistry: registry,
    logger: { warn() {} },
  }

  const sourceWorkspace = await registry.create(sourceDir)
  const targetWorkspace = await registry.create(targetDir)

  if (options.live) {
    const { header, events } = options.live
    const fullHeader = {
      version: 4,
      id: 'session-live',
      createdAt: 1,
      cwd: sourceDir,
      isSeeded: false,
      ...header,
    }
    live.set(fullHeader.id, {
      id: fullHeader.id,
      header: fullHeader,
      inheritedEventCount: options.live.inheritedEventCount ?? 0,
      snapshotEvents: () => events,
    })
  }

  if (options.stored) {
    const { header, events } = options.stored
    const fullHeader = {
      version: 4,
      id: 'session-cold',
      createdAt: 1,
      cwd: sourceDir,
      isSeeded: false,
      ...header,
    }
    const record = {
      header: fullHeader,
      events: events.map((item) => structuredClone(item)),
      flushed: true,
      inheritedEventCount: options.stored.inheritedEventCount ?? 0,
    }
    persistence.sessions.set(fullHeader.id, record)
  }

  return {
    ctx,
    persistence,
    registry,
    live,
    root,
    sourceDir,
    targetDir,
    sourceWorkspace,
    targetWorkspace,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('moving a live chat writes a new persisted log under the target workspace', async () => {
  const parts = await harness({
    live: { header: { id: 'session-live', agentPreset: 'standard' }, events: [event(0), event(1), event(2)] },
  })
  try {
    const result = await performMove(parts.ctx, { archiveSource: true }, {
      sessionId: 'session-live',
      workspaceId: parts.targetWorkspace.id,
    })

    assert.match(result.sessionId, /^session-[0-9a-f-]{36}$/u)
    assert.equal(result.workspacePath, parts.targetWorkspace.path)
    assert.equal(result.events, 3)
    assert.equal(result.archived, true)

    const stored = await parts.persistence.stat(result.sessionId)
    assert.ok(stored, 'the clone is visible through persistence')
    assert.equal(stored.header.cwd, parts.targetWorkspace.path)
    assert.equal(stored.header.isSeeded, false)
    assert.equal(stored.header.agentPreset, 'standard')
    assert.deepEqual(
      parts.persistence.sessions.get(result.sessionId).events.map((item) => item.seq),
      [0, 1, 2],
    )

    assert.deepEqual(parts.targetWorkspace.sessionIds, [result.sessionId])
    assert.deepEqual(parts.registry.archived, [{ sessionId: 'session-live', options: { stopActivity: true } }])
  } finally {
    await parts.cleanup()
  }
})

test('a fork-derived chat stays seeded so its copied end-seed marker remains valid', async () => {
  const marker = { type: 'session/end-seed', seq: 3, time: 4, data: { inherited: true } }
  const parts = await harness({
    live: {
      header: { isSeeded: true },
      inheritedEventCount: 3,
      events: [event(0), event(1), event(2), marker],
    },
  })
  try {
    const result = await performMove(parts.ctx, {}, {
      sessionId: 'session-live',
      workspaceId: parts.targetWorkspace.id,
    })
    const record = parts.persistence.sessions.get(result.sessionId)
    assert.equal(record.header.isSeeded, true)
    assert.equal(record.inheritedEventCount, 3)
    assert.equal(record.events.at(-1).type, 'session/end-seed')
  } finally {
    await parts.cleanup()
  }
})

test('moving a cold chat reads its log through persistence without write ownership', async () => {
  const parts = await harness({ stored: { events: [event(0), event(1)] } })
  try {
    const opened = []
    const originalOpen = parts.persistence.open.bind(parts.persistence)
    parts.persistence.open = async (id, access) => {
      opened.push({ id, access })
      return originalOpen(id, access)
    }

    const result = await performMove(parts.ctx, { archiveSource: false }, {
      sessionId: 'session-cold',
      workspaceId: parts.targetWorkspace.id,
    })

    assert.deepEqual(opened, [{ id: 'session-cold', access: 'read' }])
    assert.equal(result.source.live, false)
    assert.equal(result.events, 2)
    assert.equal(result.archived, false)
    assert.equal(parts.registry.archived.length, 0)
  } finally {
    await parts.cleanup()
  }
})

test('an unregistered target directory is adopted as a new workspace', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    const fresh = join(parts.root, 'fresh-project')
    await mkdir(fresh)
    const result = await performMove(parts.ctx, {}, { sessionId: 'session-live', targetPath: fresh })
    assert.equal(result.workspacePath, await realpath(fresh))
    const workspace = await parts.registry.resolveByPath(fresh)
    assert.deepEqual(workspace.sessionIds, [result.sessionId])
  } finally {
    await parts.cleanup()
  }
})

test('a move inside the current workspace is refused', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    await assert.rejects(
      performMove(parts.ctx, {}, { sessionId: 'session-live', workspaceId: parts.sourceWorkspace.id }),
      (error) => error instanceof MoveError && error.code === 'same-workspace',
    )
    assert.equal(parts.persistence.sessions.size, 0, 'nothing was written')
  } finally {
    await parts.cleanup()
  }
})

test('subagent sessions and blank sessions are refused', async () => {
  const subagent = await harness({ live: { header: { origin: 'subagent' }, events: [event(0)] } })
  try {
    await assert.rejects(
      performMove(subagent.ctx, {}, { sessionId: 'session-live', workspaceId: subagent.targetWorkspace.id }),
      (error) => error instanceof MoveError && error.code === 'subagent-session',
    )
  } finally {
    await subagent.cleanup()
  }

  const blank = await harness({ live: { events: [] } })
  try {
    await assert.rejects(
      performMove(blank.ctx, {}, { sessionId: 'session-live', workspaceId: blank.targetWorkspace.id }),
      (error) => error instanceof MoveError && error.code === 'empty-session',
    )
  } finally {
    await blank.cleanup()
  }
})

test('unknown sessions, workspaces, and relative paths are refused with codes', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    const cases = [
      [{ sessionId: 'session-missing', workspaceId: parts.targetWorkspace.id }, 'session-not-found'],
      [{ sessionId: 'session-live', workspaceId: 'ws-missing' }, 'workspace-not-found'],
      [{ sessionId: 'session-live', targetPath: 'relative/dir' }, 'invalid-path'],
      [{ sessionId: 'session-live' }, 'invalid-request'],
      [{}, 'invalid-request'],
    ]
    for (const [input, code] of cases) {
      await assert.rejects(
        performMove(parts.ctx, {}, input),
        (error) => error instanceof MoveError && error.code === code,
        `expected ${code} for ${JSON.stringify(input)}`,
      )
    }
  } finally {
    await parts.cleanup()
  }
})

test('keepOriginal and archiveSource:false both leave the source visible', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    const kept = await performMove(parts.ctx, { archiveSource: true }, {
      sessionId: 'session-live',
      workspaceId: parts.targetWorkspace.id,
      keepOriginal: true,
    })
    assert.equal(kept.archived, false)

    const second = await performMove(parts.ctx, { archiveSource: false }, {
      sessionId: 'session-live',
      workspaceId: parts.targetWorkspace.id,
    })
    assert.equal(second.archived, false)
    assert.equal(parts.registry.archived.length, 0)
  } finally {
    await parts.cleanup()
  }
})

test('a refused archive does not fail the move', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    parts.registry.archiveError = new Error('session is running')
    const result = await performMove(parts.ctx, { archiveSource: true }, {
      sessionId: 'session-live',
      workspaceId: parts.targetWorkspace.id,
    })
    assert.equal(result.archived, false)
    assert.equal(result.archiveError, 'session is running')
    assert.ok(await parts.persistence.stat(result.sessionId))
  } finally {
    await parts.cleanup()
  }
})

test('a failed workspace attachment reports the created clone id', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    parts.targetWorkspace.attachSession = async () => {
      throw new Error('directory vanished')
    }
    await assert.rejects(
      performMove(parts.ctx, {}, { sessionId: 'session-live', workspaceId: parts.targetWorkspace.id }),
      (error) =>
        error instanceof MoveError &&
        error.code === 'attach-failed' &&
        error.message.includes('session-'),
    )
    assert.equal(parts.persistence.sessions.size, 1, 'the clone still exists')
  } finally {
    await parts.cleanup()
  }
})

test('the HTTP routes answer with JSON and map expected refusals', async () => {
  const parts = await harness({ live: { events: [event(0)] } })
  try {
    const routes = new Map()
    const ctx = {
      ...parts.ctx,
      connection: {
        fetch: {
          register: (route) => {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
      },
      effect: (factory) => factory(),
    }
    apply(ctx, { archiveSource: true })

    assert.deepEqual([...routes.keys()].sort(), [INFO_PATH, MOVE_PATH].sort())

    const info = await routes.get(INFO_PATH).fetch(new Request(`http://localhost${INFO_PATH}`))
    assert.equal(info.status, 200)
    assert.equal((await info.json()).archiveSource, true)

    const badBody = await routes
      .get(MOVE_PATH)
      .fetch(new Request(`http://localhost${MOVE_PATH}`, { method: 'POST', body: 'not json' }))
    assert.equal(badBody.status, 400)
    assert.equal((await badBody.json()).error.code, 'invalid-request')

    const okResponse = await routes.get(MOVE_PATH).fetch(
      new Request(`http://localhost${MOVE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-live', workspaceId: parts.targetWorkspace.id }),
      }),
    )
    assert.equal(okResponse.status, 200)
    const body = await okResponse.json()
    assert.equal(body.ok, true)
    assert.match(body.sessionId, /^session-/u)

    const refused = await routes.get(MOVE_PATH).fetch(
      new Request(`http://localhost${MOVE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-live', workspaceId: 'ws-missing' }),
      }),
    )
    assert.equal(refused.status, 404)
    assert.equal((await refused.json()).error.code, 'workspace-not-found')
  } finally {
    await parts.cleanup()
  }
})

test('a moved chat re-points its own delivery markers at the clone', async () => {
  const delivery = (seq, sessionId) => ({
    type: 'session-log-deepseek/delivery-accepted',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { sessionId, sessionFormatVersion: 4, throughSeq: seq - 1 },
  })
  const parts = await harness({ live: { events: [event(0), delivery(1, 'session-live'), event(2)] } })
  try {
    const sourceEvents = parts.live.get('session-live').snapshotEvents()
    const result = await performMove(parts.ctx, {}, {
      sessionId: 'session-live',
      workspaceId: parts.targetWorkspace.id,
    })

    const record = parts.persistence.sessions.get(result.sessionId)
    assert.equal(record.events[1].data.sessionId, result.sessionId)
    assert.equal(record.events[1].data.throughSeq, 0, 'the watermark coordinates are preserved')
    assert.deepEqual(record.events[0], sourceEvents[0], 'ordinary events are appended unchanged')
    assert.equal(sourceEvents[1].data.sessionId, 'session-live', 'the source snapshot is not mutated')
  } finally {
    await parts.cleanup()
  }
})

test('delivery markers inside an inherited prefix keep naming the ancestor', () => {
  const inherited = {
    type: 'session-log-deepseek/delivery-accepted',
    seq: 1,
    data: { sessionId: 'session-parent', sessionFormatVersion: 4, throughSeq: 0 },
  }
  const own = {
    type: 'session-log-deepseek/delivery-accepted',
    seq: 4,
    data: { sessionId: 'session-live', sessionFormatVersion: 4, throughSeq: 3 },
  }
  const events = [event(0), inherited, event(2), { type: 'session/end-seed', seq: 3, data: { inherited: true } }, own]

  const rewritten = reidentifyDeliveryMarkers(events, 'session-clone', 3)
  assert.equal(rewritten[1], inherited, 'the inherited marker object is reused as-is')
  assert.equal(rewritten[4].data.sessionId, 'session-clone')
  assert.equal(rewritten[4].data.throughSeq, 3)
  assert.equal(events[4].data.sessionId, 'session-live', 'the source event is not mutated')
})

test('buildHeader keeps the logical format, preserves the fork cut, and carries the preset', () => {
  const header = buildHeader(
    { version: 4, id: 'session-a', createdAt: 1, cwd: 'C:\\old', isSeeded: true, agentPreset: 'standard' },
    'session-b',
    'C:\\new',
    7,
  )
  assert.equal(header.version, 4)
  assert.equal(header.id, 'session-b')
  assert.equal(header.cwd, 'C:\\new')
  assert.equal(header.isSeeded, true)
  assert.equal(header.agentPreset, 'standard')
  assert.equal('parentSession' in header, false)

  const plain = buildHeader({ version: 4, id: 'session-a', createdAt: 1, isSeeded: false }, 'session-c', 'C:\\new')
  assert.equal(plain.isSeeded, false)
  assert.equal('agentPreset' in plain, false)
})
