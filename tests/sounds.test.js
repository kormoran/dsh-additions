import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import {
  DEFAULT_VOLUME,
  SOUND_PATH,
  normalizeSoundsConfig,
  readSound,
} from '../lib/sounds.js'

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

test('the route streams audio and maps an unknown cue to a JSON refusal', async () => {
  const routes = new Map()
  const ctx = {
    effect: (factory) => factory(),
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

test('the info route publishes the sounds config', async () => {
  const routes = new Map()
  const ctx = {
    effect: (factory) => factory(),
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
