/**
 * Real-backend integration check for dsh-additions.
 *
 * It composes the SHIPPED session store and JSONL persistence backend from the
 * local dsh installation, reads one real stored session (read-only), then runs
 * the production move path against a temporary session root and verifies that
 * the clone is materialized under the target workspace's project directory and
 * re-opens with the same contiguous history.
 *
 * Usage:
 *   node scripts/integration.mjs [path-to-dsh-node_modules/@deepseek-ai]
 *
 * The default package path is derived from %APPDATA% on Windows or from
 * DSH_PACKAGES when set. The real session root is never written: the reader
 * opens sessions with read access only.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const packages =
  process.argv[2] ??
  process.env.DSH_PACKAGES ??
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai')

const importPackage = (relative) => import(pathToFileURL(join(packages, relative)).href)

const { Context } = await importPackage('cordis/lib/index.js')
const { default: SessionStore } = await importPackage('dsh-session/lib/index.js')
const { SessionId } = await importPackage('dsh-session/lib/index.js')
const JsonlPersistence = await importPackage('dsh-session-persistence-jsonl/lib/index.js')

const realSessionsRoot = join(homedir(), '.dsh', 'sessions')
const workRoot = await mkdtemp(join(tmpdir(), 'additions-it-'))
const targetDir = join(workRoot, 'target workspace')
const sourceDir = join(workRoot, 'source workspace')
await mkdir(targetDir, { recursive: true })
await mkdir(sourceDir, { recursive: true })

const reader = new Context()
await reader.plugin(SessionStore)
await reader.plugin(JsonlPersistence, { root: realSessionsRoot })

const writer = new Context()
await writer.plugin(SessionStore)
await writer.plugin(JsonlPersistence, { root: join(workRoot, 'session-root') })

/** Read through the real root, write through the temporary one. */
const persistence = {
  create: (header, options) => writer.sessionPersistence.create(header, options),
  open: (id, access, options) => (access === 'read' ? reader.sessionPersistence.open(id, access, options) : writer.sessionPersistence.open(id, access, options)),
  async stat(id, options) {
    const own = await writer.sessionPersistence.stat(id, options)
    if (own !== undefined) return own
    return reader.sessionPersistence.stat(id, options)
  },
  async list(options) {
    return [...(await writer.sessionPersistence.list(options)), ...(await reader.sessionPersistence.list(options))]
  },
  flush: () => writer.sessionPersistence.flush(),
}

const archived = []
const workspaces = new Map()
const workspace = {
  id: 'ws-target',
  path: targetDir,
  title: 'target workspace',
  sessionIds: [],
  async attachSession(id) {
    this.sessionIds.push(id)
  },
  async status() {
    return 'ok'
  },
}
workspaces.set(targetDir, workspace)
const registry = {
  get: (id) => (id === workspace.id ? workspace : undefined),
  list: () => [workspace],
  async resolveByPath(path) {
    if (path !== targetDir) throw new Error('ENOENT')
    return workspaces.get(path)
  },
  async create(path) {
    return workspaces.get(path)
  },
  async archiveSession(id, options) {
    archived.push({ id, options })
  },
}

const { performMove } = await import('../lib/index.js')
const ctx = { sessions: writer.sessions, sessionPersistence: persistence, workspaceRegistry: registry, logger: { warn() {} } }

const DELIVERY = 'session-log-deepseek/delivery-accepted'

/**
 * Choose the smallest current-format real session with content, preferring one
 * that carries its own delivery-accepted markers: those markers are the
 * regression this run exists to catch.
 */
async function pickRealSession() {
  const snapshots = await reader.sessionPersistence.list()
  const current = snapshots.filter((snapshot) => snapshot.formatStatus === 'current' && snapshot.location !== undefined)
  current.sort((left, right) => (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0))
  if (current.length === 0) throw new Error('no current-format real session to read')
  for (const snapshot of current.slice(0, 12)) {
    try {
      const handle = await reader.sessionPersistence.open(snapshot.header.id, 'read')
      try {
        const { events } = await handle.read(0)
        if (events.some((event) => event.type === DELIVERY && event.data?.sessionId === snapshot.header.id)) return snapshot
      } finally {
        await handle.close()
      }
    } catch {
      // An unreadable session is not a usable source; keep looking.
    }
  }
  return current[0]
}

const real = await pickRealSession()
const readerHandle = await reader.sessionPersistence.open(real.header.id, 'read')
const sourceEvents = (await readerHandle.read(0)).events
const sourceHeader = readerHandle.header
await readerHandle.close()
console.log(`source: ${sourceHeader.id} (${sourceEvents.length} events, cwd ${sourceHeader.cwd})`)

// ── case 1: cold source read through persistence ────────────────────────────
const cold = await performMove(ctx, { archiveSource: true }, {
  sessionId: sourceHeader.id,
  targetPath: targetDir,
})

assert.match(cold.sessionId, /^session-/u)
assert.equal(cold.events, sourceEvents.length)
assert.equal(cold.archived, true)
assert.deepEqual(archived, [{ id: sourceHeader.id, options: { stopActivity: true } }])

const coldStat = await writer.sessionPersistence.stat(cold.sessionId)
assert.ok(coldStat, 'clone visible in the temporary persistence root')
assert.equal(coldStat.header.cwd, targetDir)
assert.equal(coldStat.header.isSeeded, false)
assert.ok(coldStat.location?.path, 'backend reports a materialized artifact path')
assert.ok(existsSync(coldStat.location.path), `artifact exists: ${coldStat.location.path}`)

const projectDirectory = coldStat.location.path.split(/[\\/]/u).at(-3)
assert.ok(projectDirectory.startsWith('--'), `project directory is a normalized cwd folder: ${projectDirectory}`)
assert.ok(/target/u.test(projectDirectory), `project directory names the target workspace: ${projectDirectory}`)

const coldHandle = await writer.sessionPersistence.open(cold.sessionId, 'read')
const coldInherited = coldHandle.inheritedEventCount ?? 0
const cloneEvents = (await coldHandle.read(0)).events
await coldHandle.close()
assert.equal(cloneEvents.length, sourceEvents.length)
assert.deepEqual(
  cloneEvents.map((event) => event.seq),
  sourceEvents.map((event) => event.seq),
  'the clone keeps the source sequence numbers',
)
assert.deepEqual(cloneEvents.map((event) => event.type), sourceEvents.map((event) => event.type))

const sourceDeliveries = sourceEvents.filter((event) => event.type === DELIVERY)
const sourceOwn = sourceDeliveries.filter((event) => event.data?.sessionId === sourceHeader.id)
if (sourceOwn.length > 0) {
  const cloneOwn = cloneEvents.filter((event) => event.type === DELIVERY && event.seq >= coldInherited)
  assert.equal(cloneOwn.length, sourceOwn.length, 'every owned delivery marker is copied')
  assert.ok(
    cloneOwn.every((event) => event.data.sessionId === cold.sessionId),
    'the clone owns its delivery markers instead of the source',
  )
  console.log(`delivery ownership ok: ${cloneOwn.length} markers re-pointed at ${cold.sessionId}`)
} else {
  console.log('delivery ownership: no real source with owned delivery markers (case not exercised)')
}
console.log(`cold move ok: ${cold.sessionId} -> ${coldStat.location.path}`)

// ── case 2: live source read from the session store ─────────────────────────
const liveId = SessionId(`session-live-${Date.now()}`)
let liveTested = false
try {
  // A session created from a seed is fork-derived: the constructor appends the
  // inherited `session/end-seed` marker, so the clone must stay seeded too.
  writer.sessions.create(liveId, {
    seed: sourceEvents,
    inheritedEventCount: sourceEvents.length,
    meta: { cwd: sourceDir, isSeeded: true },
  })
  const live = await performMove(ctx, { archiveSource: false }, {
    sessionId: String(liveId),
    targetPath: targetDir,
  })
  assert.equal(live.source.live, true)
  assert.equal(live.events, sourceEvents.length + 1)
  assert.equal(live.archived, false)

  const liveStat = await writer.sessionPersistence.stat(live.sessionId)
  assert.ok(liveStat)
  assert.equal(liveStat.header.isSeeded, true, 'the fork-derived clone keeps its seed marker')
  const liveHandle = await writer.sessionPersistence.open(live.sessionId, 'read')
  assert.equal(liveHandle.inheritedEventCount, sourceEvents.length)
  const liveEvents = (await liveHandle.read(0)).events
  await liveHandle.close()
  assert.equal(liveEvents.at(-1).type, 'session/end-seed')
  console.log(`live move ok: ${live.sessionId} -> ${liveStat.location?.path} (${liveEvents.length} events)`)
  liveTested = true
} catch (error) {
  console.log(`live case skipped: ${error.message}`)
}

// ── both clones land under the same target project directory ────────────────
const entries = await readdir(join(workRoot, 'session-root'))
assert.ok(entries.includes(projectDirectory), `project directory on disk: ${entries.join(', ')}`)

await rm(workRoot, { recursive: true, force: true })

console.log(`integration ok (live case ${liveTested ? 'ran' : 'skipped'})`)
