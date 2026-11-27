import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  STATS_PATH,
  countLines,
  normalizeStatsConfig,
  resolveStatsTarget,
  scanWorkspace,
} from '../lib/workspace-stats.js'

/**
 * Build the fixture tree every scan test shares:
 *
 * ```
 * root/
 *   src/main.js        2 lines (LF, trailing newline)
 *   src/util.py        3 lines (no trailing newline)
 *   docs/README.md     2 lines
 *   docs/notes.txt     2 lines (CRLF)
 *   assets/logo.png    binary, bytes only
 *   node_modules/...   excluded
 *   empty/             one directory, no files
 * ```
 *
 * @returns the fixture root and its cleanup.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'additions-stats-'))
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'docs'))
  await mkdir(join(root, 'assets'))
  await mkdir(join(root, 'empty'))
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true })
  await writeFile(join(root, 'src', 'main.js'), 'const a = 1\nconst b = 2\n')
  await writeFile(join(root, 'src', 'util.py'), 'x = 1\ny = 2\nz = 3')
  await writeFile(join(root, 'docs', 'README.md'), '# Title\nbody\n')
  await writeFile(join(root, 'docs', 'notes.txt'), 'one\r\ntwo\r\n')
  await writeFile(join(root, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), 'export const x = 1\n'.repeat(100))
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('a scan counts directories, files, bytes, code lines and doc lines', async () => {
  const tree = await fixture()
  try {
    const result = await scanWorkspace(tree.root)
    assert.equal(result.path, tree.root)
    assert.equal(result.directories, 4, 'src, docs, assets, empty (node_modules is skipped before counting)')
    assert.equal(result.files, 5, 'the five counted files, node_modules excluded')
    assert.equal(result.codeFiles, 2)
    assert.equal(result.docFiles, 2)
    assert.equal(result.codeLines, 5, 'main.js 2 + util.py 3')
    assert.equal(result.docLines, 4, 'README 2 + notes 2')
    assert.equal(result.totalLines, 9)
    assert.equal(result.truncated, false)
    assert.equal(result.exhausted, null)
    assert.equal(typeof result.elapsedMs, 'number')
    assert.ok(result.sizeBytes > 0)
  } finally {
    await tree.cleanup()
  }
})

test('generated and vendored directories are skipped entirely', async () => {
  const tree = await fixture()
  try {
    const result = await scanWorkspace(tree.root)
    assert.equal(result.files, 5, 'node_modules/dep/index.js is not counted')
    assert.equal(result.codeLines, 5, 'its 100 lines are not counted')
  } finally {
    await tree.cleanup()
  }
})

test('the line counter handles CRLF, missing trailing newlines and binaries', async () => {
  const tree = await fixture()
  try {
    const crlf = await countLines(join(tree.root, 'docs', 'notes.txt'), 4096)
    assert.equal(crlf.lines, 2)
    assert.equal(crlf.binary, false)

    const noTrailing = await countLines(join(tree.root, 'src', 'util.py'), 4096)
    assert.equal(noTrailing.lines, 3)

    const binary = await countLines(join(tree.root, 'assets', 'logo.png'), 4096)
    assert.equal(binary.binary, true)
    assert.equal(binary.lines, 0)
    assert.ok(binary.bytes > 0)
  } finally {
    await tree.cleanup()
  }
})

test('a per-file byte budget marks the file truncated', async () => {
  const tree = await fixture()
  try {
    const partial = await countLines(join(tree.root, 'src', 'main.js'), 5)
    assert.equal(partial.truncated, true)
    assert.ok(partial.bytes <= 5)
  } finally {
    await tree.cleanup()
  }
})

test('the read budget stops the walk and reports it', async () => {
  const tree = await fixture()
  try {
    const result = await scanWorkspace(tree.root, { maxBytesRead: 10 })
    assert.equal(result.truncated, true)
    assert.equal(result.exhausted, 'bytes')
  } finally {
    await tree.cleanup()
  }
})

test('the entry budget stops the walk and reports it', async () => {
  const tree = await fixture()
  try {
    const result = await scanWorkspace(tree.root, { maxEntries: 2 })
    assert.equal(result.truncated, true)
    assert.equal(result.exhausted, 'entries')
    assert.ok(result.directories + result.files <= 3)
  } finally {
    await tree.cleanup()
  }
})

test('the stats config keeps usable limits and clamps the rest', () => {
  assert.deepEqual(normalizeStatsConfig(undefined), {
    timeLimitMs: 10000,
    cacheTtlMs: 15000,
    maxEntries: 200000,
    maxBytesRead: 64 * 1024 * 1024,
  })
  assert.deepEqual(normalizeStatsConfig({ timeLimitMs: -1, cacheTtlMs: 'x', maxEntries: 5, maxBytesRead: 1e12 }), {
    timeLimitMs: 10000,
    cacheTtlMs: 15000,
    maxEntries: 5,
    maxBytesRead: 1024 * 1024 * 1024,
  })
})

test('the target resolver names a workspace or a canonical path', async () => {
  const tree = await fixture()
  try {
    const deps = {
      workspaceRegistry: {
        get: (workspaceId) =>
          workspaceId === 'ws-fixture' ? { path: tree.root, title: 'Fixture' } : undefined,
      },
      realpath: (path) => Promise.resolve(path),
    }

    assert.deepEqual(await resolveStatsTarget({ workspaceId: 'ws-fixture' }, deps), {
      path: tree.root,
      title: 'Fixture',
    })
    assert.deepEqual(await resolveStatsTarget({ path: tree.root }, deps), {
      path: tree.root,
      title: tree.root,
    })

    await assert.rejects(resolveStatsTarget({ workspaceId: 'nope' }, deps), (error) => error.code === 'workspace-not-found')
    await assert.rejects(resolveStatsTarget({}, deps), (error) => error.code === 'missing-target')
    await assert.rejects(resolveStatsTarget({ path: 'relative/dir' }, deps), (error) => error.code === 'relative-path')
  } finally {
    await tree.cleanup()
  }
})

test('the route answers JSON, caches the scan, and maps refusals', async () => {
  const tree = await fixture()
  try {
    const { apply } = await import('../lib/index.js')
    const routes = new Map()
    const ctx = {
      effect: (factory) => factory(),
      inject: (names, factory) => (names.every((name) => ctx[name] !== undefined) ? factory(ctx) : undefined),
      commands: { register: () => () => {} },
      workspaceRegistry: {
        get: (workspaceId) => (workspaceId === 'ws-fixture' ? { path: tree.root, title: 'Fixture' } : undefined),
      },
      connection: {
        fetch: {
          register: (route) => {
            routes.set(route.path, route)
            return () => {}
          },
        },
      },
    }
    apply(ctx, {})

    const route = routes.get(STATS_PATH)
    assert.ok(route, 'the statistics route is registered')

    const first = await route.fetch(
      new Request(`http://localhost${STATS_PATH}?workspaceId=ws-fixture`),
    )
    assert.equal(first.status, 200)
    const body = await first.json()
    assert.equal(body.ok, true)
    assert.equal(body.workspaceTitle, 'Fixture')
    assert.equal(body.cached, false)
    assert.equal(body.codeLines, 5)
    assert.equal(body.docLines, 4)
    assert.equal(body.totalLines, 9)

    const second = await route.fetch(
      new Request(`http://localhost${STATS_PATH}?workspaceId=ws-fixture`),
    )
    assert.equal((await second.json()).cached, true, 'the second read comes from the cache')

    const missing = await route.fetch(new Request(`http://localhost${STATS_PATH}`))
    assert.equal(missing.status, 400)
    assert.equal((await missing.json()).error.code, 'missing-target')

    const unknown = await route.fetch(
      new Request(`http://localhost${STATS_PATH}?workspaceId=ws-gone`),
    )
    assert.equal(unknown.status, 404)
    assert.equal((await unknown.json()).error.code, 'workspace-not-found')

    const relative = await route.fetch(
      new Request(`http://localhost${STATS_PATH}?path=relative%2Fdir`),
    )
    assert.equal(relative.status, 400)
    assert.equal((await relative.json()).error.code, 'relative-path')
  } finally {
    await tree.cleanup()
  }
})
