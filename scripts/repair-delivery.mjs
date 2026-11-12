/**
 * Repair a stored session whose copied delivery-accepted markers still name
 * the source Session: re-point them at the log's own header id and rewrite the
 * artifact through the shipped JSONL backend, then optionally replace the
 * original file in place.
 *
 * Usage:
 *   node scripts/repair-delivery.mjs <sessionId> [--apply]
 *
 * Without --apply the repaired log is written under a temporary root and
 * verified, but the real session file is left untouched.
 */

import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const sessionId = process.argv[2]
const apply = process.argv.includes('--apply')
if (sessionId === undefined) throw new Error('usage: node scripts/repair-delivery.mjs <sessionId> [--apply]')

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

const DELIVERY = 'session-log-deepseek/delivery-accepted'
const realRoot = join(homedir(), '.dsh', 'sessions')

const context = new Context()
await context.plugin(SessionStore)
await context.plugin(JsonlPersistence, { root: realRoot })

const snapshot = await context.sessionPersistence.stat(sessionId)
if (snapshot === undefined) throw new Error(`session ${sessionId} not found`)
const rawPath = snapshot.location?.path
if (rawPath === undefined) throw new Error(`session ${sessionId} has no materialized raw log`)
console.log(`raw log: ${rawPath}`)

const text = zstdDecompressSync(await readFile(rawPath)).toString('utf8')
const lines = text.split('\n').filter((line) => line.length > 0)
const storedHeader = JSON.parse(lines[0])
assert.equal(storedHeader.id, sessionId, 'the log header names the requested session')
const { type: _physicalType, ...header } = storedHeader
const events = lines.slice(1).map((line) => JSON.parse(line))
console.log(`header: seeded=${header.isSeeded} cwd=${header.cwd} events=${events.length}`)

let rewritten = 0
const fixed = events.map((event) => {
  if (event.type !== DELIVERY) return event
  if (event.data.sessionId === sessionId) return event
  rewritten += 1
  return { ...event, data: { ...event.data, sessionId } }
})
console.log(`markers re-pointed: ${rewritten}`)
if (rewritten === 0) {
  console.log('nothing to repair')
  process.exit(0)
}

const workRoot = await mkdtemp(join(tmpdir(), 'chatshifter-repair-'))
const writer = new Context()
await writer.plugin(SessionStore)
await writer.plugin(JsonlPersistence, { root: join(workRoot, 'root') })

const handle = await writer.sessionPersistence.create(header)
await handle.append(fixed)
await handle.flush()
await handle.close()

const stored = await writer.sessionPersistence.stat(sessionId)
if (stored?.location?.path === undefined) throw new Error('repaired log was not materialized')

// Verify through a fresh reader before touching the real file.
const verify = new Context()
await verify.plugin(SessionStore)
await verify.plugin(JsonlPersistence, { root: join(workRoot, 'root') })
const verified = await verify.sessionPersistence.open(sessionId, 'read')
const reopened = (await verified.read(0)).events
await verified.close()
assert.equal(reopened.length, events.length)
assert.ok(reopened.every((event) => event.type !== DELIVERY || event.data.sessionId === sessionId))
console.log(`repaired log verified: ${reopened.length} events, ${rewritten} markers now name ${sessionId}`)

if (apply) {
  const staged = `${rawPath}.repair`
  await copyFile(stored.location.path, staged)
  await rename(staged, rawPath)
  console.log(`replaced in place: ${rawPath}`)

  // A fresh context has no cached corruption status: this is the real proof.
  const check = new Context()
  await check.plugin(SessionStore)
  await check.plugin(JsonlPersistence, { root: realRoot })
  const reopenedHandle = await check.sessionPersistence.open(sessionId, 'read')
  const inPlace = (await reopenedHandle.read(0)).events
  await reopenedHandle.close()
  assert.equal(inPlace.length, events.length)
  assert.ok(inPlace.every((event) => event.type !== DELIVERY || event.data.sessionId === sessionId))
  console.log(`in-place verification ok: ${inPlace.length} events readable`)
} else {
  console.log(`dry run; repaired artifact left at ${stored.location.path}`)
}

await rm(workRoot, { recursive: true, force: true })
