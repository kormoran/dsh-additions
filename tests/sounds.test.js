import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Config, apply } from '../lib/index.js'
import {
  DEFAULT_VOLUME,
  SOUND_PATH,
  normalizeSoundsConfig,
  readLive,
  readSound,
} from '../lib/sounds.js'

/** Shared volatile-reference protocol used by DSH's config runtime. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * One live config reference, as schemastery produces it.
 * @param read - reader returning the current value.
 * @returns a frozen-protocol stand-in.
 */
function volatileRef(read) {
  return { [VOLATILE_WRITE]: () => {}, get: read }
}

/** @returns the parsed WAV header fields of a byte buffer. */
function wavHeader(bytes) {
  return {
    riff: bytes.subarray(0, 4).toString('ascii'),
    wave: bytes.subarray(8, 12).toString('ascii'),
    format: bytes.readUInt16LE(20),
    channels: bytes.readUInt16LE(22),
    rate: bytes.readUInt32LE(24),
    declaredLength: bytes.readUInt32LE(4),
  }
}

test('the sounds config defaults, clamps and normalizes paths', () => {
  assert.deepEqual(normalizeSoundsConfig(undefined), {
    enabled: true,
    volume: DEFAULT_VOLUME,
    ding: null,
    approval: null,
  })
  assert.deepEqual(normalizeSoundsConfig({ enabled: false, volume: 4, ding: 'relative.wav', approval: '   ' }), {
    enabled: false,
    volume: 1,
    ding: null,
    approval: null,
  })
  const absolute = process.platform === 'win32' ? 'C:\\sounds\\bell.wav' : '/sounds/bell.wav'
  assert.deepEqual(normalizeSoundsConfig({ volume: -1, ding: absolute }), {
    enabled: true,
    volume: 0,
    ding: absolute,
    approval: null,
  })
})

test('the packaged cues are valid PCM WAV files', async () => {
  for (const which of ['ding', 'approval']) {
    const sound = await readSound(which, normalizeSoundsConfig(undefined))
    assert.equal(sound.source, 'default')
    assert.equal(sound.contentType, 'audio/wav')
    assert.ok(sound.bytes.byteLength > 10000, `${which} has real audio`)
    const header = wavHeader(sound.bytes)
    assert.equal(header.riff, 'RIFF')
    assert.equal(header.wave, 'WAVE')
    assert.equal(header.format, 1, 'PCM')
    assert.equal(header.channels, 1)
    assert.ok(header.rate > 8000)
    assert.equal(header.declaredLength, sound.bytes.byteLength - 8)
  }
})

test('a configured file replaces the packaged cue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'additions-sounds-'))
  try {
    const custom = join(directory, 'custom.wav')
    await writeFile(custom, Buffer.from('RIFFcustom-bytes'))
    const sound = await readSound('ding', normalizeSoundsConfig({ ding: custom }))
    assert.equal(sound.source, 'custom')
    assert.equal(sound.name, custom)
    assert.equal(sound.bytes.toString(), 'RIFFcustom-bytes')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a configured file that cannot be read falls back to the packaged cue', async () => {
  const missing = join(tmpdir(), 'additions-does-not-exist', 'nope.wav')
  const sound = await readSound('approval', normalizeSoundsConfig({ approval: missing }))
  assert.equal(sound.source, 'default')
  assert.ok(sound.bytes.byteLength > 0)
})

test('an unknown cue is refused with a stable code', async () => {
  await assert.rejects(
    readSound('explosion', normalizeSoundsConfig(undefined)),
    (error) => error.code === 'unknown-sound' && error.status === 400,
  )
})

test('volatile config references are read at use time', () => {
  let enabled = true
  let ding = ''
  let volume = 0.4
  const sounds = {
    enabled: volatileRef(() => enabled),
    volume: volatileRef(() => volume),
    ding: volatileRef(() => ding),
    approval: volatileRef(() => ''),
  }
  assert.equal(readLive(sounds.enabled), true)
  assert.deepEqual(normalizeSoundsConfig(sounds), { enabled: true, volume: 0.4, ding: null, approval: null })

  enabled = false
  ding = process.platform === 'win32' ? 'C:\\sounds\\bell.wav' : '/sounds/bell.wav'
  volume = 0.9
  assert.deepEqual(normalizeSoundsConfig(sounds), { enabled: false, volume: 0.9, ding, approval: null })
  assert.equal(readLive('plain'), 'plain', 'ordinary values pass through')
  assert.equal(readLive(undefined), undefined)
})

test('the settings schema makes exactly the cue fields live', { skip: Config === undefined ? 'schemastery is not installed (run npm install)' : false }, () => {
  const collect = (node, path = []) => {
    const paths = node?.meta?.volatile === true ? [path.join('.')] : []
    for (const [key, child] of Object.entries(node?.dict ?? {})) paths.push(...collect(child, [...path, key]))
    return paths
  }
  assert.deepEqual(collect(Config).sort(), ['sounds.approval', 'sounds.ding', 'sounds.enabled'])

  const result = Config['~standard'].validate({})
  assert.equal('issues' in result, false)
  const parsed = result.value
  assert.equal(parsed.archiveSource, true)
  assert.equal(parsed.quit.delayMs, 500)
  assert.equal(parsed.quit.graceMs, 5000)
  assert.equal(parsed.stats.timeLimitMs, 10000)
  assert.equal(parsed.sounds.volume, DEFAULT_VOLUME)
  assert.equal(readLive(parsed.sounds.enabled), true)
  assert.equal(readLive(parsed.sounds.ding), '')
  assert.equal(readLive(parsed.sounds.approval), '')

  const refused = Config['~standard'].validate({ sounds: { enabled: 'yes' } })
  assert.ok('issues' in refused, 'a non-boolean switch is refused')
})

test('the sound route streams audio and maps an unknown cue to a JSON refusal', async () => {
  const routes = new Map()
  const ctx = {
    effect: (factory) => factory(),
    inject: (names, factory) => (names.every((name) => ctx[name] !== undefined) ? factory(ctx) : undefined),
    commands: { register: () => () => {} },
    workspaceRegistry: { get: () => undefined },
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

  const route = routes.get(SOUND_PATH)
  assert.ok(route, 'the sound route is registered')

  const ding = await route.fetch(new Request(`http://localhost${SOUND_PATH}?which=ding`))
  assert.equal(ding.status, 200)
  assert.equal(ding.headers.get('content-type'), 'audio/wav')
  assert.equal(ding.headers.get('x-additions-sound-source'), 'default')
  assert.equal(ding.headers.get('cache-control'), 'no-store')
  const bytes = new Uint8Array(await ding.arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF')

  const approval = await route.fetch(new Request(`http://localhost${SOUND_PATH}?which=approval`))
  assert.equal(approval.status, 200)
  assert.ok((await approval.arrayBuffer()).byteLength > 0)

  const refused = await route.fetch(new Request(`http://localhost${SOUND_PATH}?which=nope`))
  assert.equal(refused.status, 400)
  assert.equal((await refused.json()).error.code, 'unknown-sound')
})

test('the sound route reads the live settings value on every request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'additions-live-'))
  try {
    const first = join(directory, 'first.wav')
    const second = join(directory, 'second.wav')
    await writeFile(first, 'RIFFfirst')
    await writeFile(second, 'RIFFsecond')
    let current = first
    const routes = new Map()
    const ctx = {
      effect: (factory) => factory(),
      inject: (names, factory) => (names.every((name) => ctx[name] !== undefined) ? factory(ctx) : undefined),
      commands: { register: () => () => {} },
      workspaceRegistry: { get: () => undefined },
      connection: {
        fetch: {
          register: (route) => {
            routes.set(route.path, route)
            return () => {}
          },
        },
      },
    }
    apply(ctx, { sounds: { ding: volatileRef(() => current) } })
    const route = routes.get(SOUND_PATH)
    const fetchCue = () => route.fetch(new Request(`http://localhost${SOUND_PATH}?which=ding`))

    let response = await fetchCue()
    assert.equal(response.headers.get('x-additions-sound-source'), 'custom')
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'RIFFfirst')

    current = second
    response = await fetchCue()
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'RIFFsecond')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the info route publishes the sounds config', async () => {
  const routes = new Map()
  const ctx = {
    effect: (factory) => factory(),
    inject: (names, factory) => (names.every((name) => ctx[name] !== undefined) ? factory(ctx) : undefined),
    commands: { register: () => () => {} },
    workspaceRegistry: { get: () => undefined },
    connection: {
      fetch: {
        register: (route) => {
          routes.set(route.path, route)
          return () => {}
        },
      },
    },
  }
  apply(ctx, { sounds: { volume: 0.25 } })

  const info = await routes.get('/api/additions.info').fetch(new Request('http://localhost/api/additions.info'))
  const body = await info.json()
  assert.equal(body.sounds.enabled, true)
  assert.equal(body.sounds.volume, 0.25)
  assert.equal(body.sounds.ding, null)
})
