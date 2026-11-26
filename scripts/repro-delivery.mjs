/**
 * One-off reproduction: move a real chat that carries delivery-accepted
 * markers, then open the clone through the shipped backend.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const packages = join(
  process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
  'npm',
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'node_modules',
  '@deepseek-ai',
)

const load = (relative) => import(pathToFileURL(join(packages, relative)).href)
const { Context } = await load('cordis/lib/index.js')
const { default: SessionStore } = await load('dsh-session/lib/index.js')
const JsonlPersistence = await load('dsh-session-persistence-jsonl/lib/index.js')

const realRoot = join(homedir(), '.dsh', 'sessions')
const workRoot = await mkdtemp(join(tmpdir(), 'additions-repro-'))
const targetDir = join(workRoot, 'target')
await mkdir(targetDir, { recursive: true })

const reader = new Context()
await reader.plugin(SessionStore)
await reader.plugin(JsonlPersistence, { root: realRoot })

const writer = new Context()
await writer.plugin(SessionStore)
await writer.plugin(JsonlPersistence, { root: join(workRoot, 'root') })

const persistence = {
  create: (header, options) => writer.sessionPersistence.create(header, options),
  open: (id, access) => (access === 'read' ? reader.sessionPersistence.open(id, access) : writer.sessionPersistence.open(id, access)),
  async stat(id) {
    return (await writer.sessionPersistence.stat(id)) ?? (await reader.sessionPersistence.stat(id))
  },
  async list() {
    return [...(await writer.sessionPersistence.list()), ...(await reader.sessionPersistence.list())]
  },
}

const workspace = {
  id: 'ws-target',
  path: targetDir,
  title: 'target',
  sessionIds: [],
  async attachSession(id) {
    this.sessionIds.push(id)
  },
  async status() {
    return 'ok'
  },
}

const registry = {
  get: () => workspace,
  list: () => [workspace],
  async resolveByPath() {
    return workspace
  },
  async create() {
    return workspace
  },
  async archiveSession() {},
}

// Pick the smallest real session that carries its own delivery markers.
let picked
for (const snapshot of (await reader.sessionPersistence.list()).filter((item) => item.formatStatus === 'current').sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))) {
  const handle = await reader.sessionPersistence.open(snapshot.header.id, 'read')
  const { events } = await handle.read(0)
  await handle.close()
  if (events.some((event) => event.type === 'session-log-deepseek/delivery-accepted' && event.data?.sessionId === snapshot.header.id)) {
    picked = { snapshot, events }
    break
  }
}

if (picked === undefined) throw new Error('no real session with delivery markers')
console.log(`source: ${picked.snapshot.header.id} (${picked.events.length} events)`)

const { performMove } = await import('../lib/index.js')
const ctx = { sessions: writer.sessions, sessionPersistence: persistence, workspaceRegistry: registry, logger: { warn() {} } }

const result = await performMove(ctx, { archiveSource: false }, {
  sessionId: picked.snapshot.header.id,
  targetPath: targetDir,
})
console.log(`clone: ${result.sessionId}`)

const stored = await writer.sessionPersistence.stat(result.sessionId)
console.log(`materialized: ${stored?.location?.path}`)

try {
  const handle = await writer.sessionPersistence.open(result.sessionId, 'read')
  const { events } = await handle.read(0)
  await handle.close()
  console.log(`clone reopened with ${events.length} events`)
} catch (error) {
  console.log(`REOPEN FAILED: ${error.message}`)
}

await rm(workRoot, { recursive: true, force: true })
