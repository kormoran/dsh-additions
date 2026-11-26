import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

/**
 * Deterministic stand-in for `@deepseek-ai/dsh-client-store`'s snapshot store:
 * the controller only reads and replaces snapshots.
 * @param initial - starting value.
 * @returns a store with getSnapshot/set/update/subscribe.
 */
function createSnapshotStore(initial) {
  let value = initial
  return {
    getSnapshot: () => value,
    set: (next) => {
      value = next
    },
    update: (mutator) => {
      mutator(value)
    },
    subscribe: () => () => {},
  }
}

/**
 * Load the hand-authored browser bundle the way the client module system does:
 * execute the script, capture the registration, and materialize the exports
 * with platform-module stubs.
 * @returns the plugin exports and the registration id.
 */
function loadBundle() {
  let registration
  const window = { __ModuleLoader__: { load: (value) => (registration = value) } }
  const context = {
    window,
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    Intl,
    fetch: async () => ({ ok: false, status: 0, json: async () => null }),
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), context, {
    filename: 'lib/client.js',
  })
  assert.ok(registration, 'the bundle registers itself')
  const modules = {
    react: {
      useState: () => [undefined, () => {}],
      useMemo: (factory) => factory(),
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
    },
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
      Fragment: 'Fragment',
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Modal: 'Modal',
      Button: 'Button',
      MenuItemButton: 'MenuItemButton',
    },
    '@deepseek-ai/dsh-client-store': { createSnapshotStore },
  }
  const exports = registration.factory((name) => {
    const stub = modules[name]
    if (stub === undefined) throw new Error(`unexpected platform module ${name}`)
    return stub
  })
  return { id: registration.id, exports }
}

/**
 * Client-context stand-in: records slot registrations and locale dictionaries.
 * @returns the context plus the recorded entries.
 */
function createClient() {
  const registrations = []
  const locales = []
  const panelTypes = []
  const ctx = {
    effect: (factory) => factory(),
    inject: (names, factory) => factory(ctx),
    locale: {
      register: (namespace, dictionaries) => {
        locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind: () => (key, params) => {
        if (params === undefined) return key
        return `${key}:${JSON.stringify(params)}`
      },
    },
    slots: {
      inject: (name, factory) => factory(),
      register: (definition, component) => {
        registrations.push({ definition, component })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        panelTypes.push(definition)
        return () => {}
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({ items: [], phase: 'ready' }),
        subscribe: () => () => {},
      },
    },
    sessions: { refresh: async () => {} },
    remote: { directoryPicker: { pick: async () => null } },
  }
  return { ctx, registrations, locales, panelTypes }
}

/** @returns a fetch stub resolving one JSON payload with a status. */
function jsonFetch(payload, status = 200) {
  const stub = async (url, init) => {
    stub.last = { url, init }
    return { ok: status >= 200 && status < 300, status, json: async () => payload }
  }
  return stub
}

test('the bundle announces itself with the package id and the slot-based API', () => {
  const { id, exports } = loadBundle()
  assert.equal(id, 'dsh-additions')
  assert.equal(exports.name, 'dsh-additions')
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'workspaces', 'sessions', 'remote'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(exports.inject.includes('contextMenus'), false, 'the retired API is not requested')
})

test('apply registers the Session menu row, the dialog and the workspace panel', () => {
  const { exports } = loadBundle()
  const client = createClient()
  exports.apply(client.ctx)

  assert.equal(client.locales.length, 1)
  assert.equal(client.locales[0].namespace, 'additions')

  assert.equal(client.registrations.length, 5)
  const menu = client.registrations.find((entry) => entry.definition.id === 'additions.move')
  const dialog = client.registrations.find((entry) => entry.definition.id === 'additions.move-dialog')
  const panel = client.registrations.find((entry) => entry.definition.key === 'additions.workspace-panel')
  const panelTitle = client.registrations.find((entry) => entry.definition.name === 'sidebar.right.pane.tab.title')
  const watcher = client.registrations.find((entry) => entry.definition.id === 'additions.sound-watcher')
  assert.ok(watcher, 'the sound watcher is registered')
  assert.equal(watcher.definition.name, 'shell.overlay')
  assert.equal(typeof watcher.definition.inject().player.play, 'function')
  assert.ok(menu, 'the menu row is registered')
  assert.equal(menu.definition.name, 'sidebar.workspaces.session.menu.item')
  assert.equal(menu.definition.order, 350)
  assert.equal(menu.definition.locale, 'additions')
  assert.equal(typeof menu.component, 'function')

  assert.ok(dialog, 'the dialog is registered')
  assert.equal(dialog.definition.name, 'shell.overlay')
  assert.equal(dialog.definition.locale, 'additions')
  assert.equal(typeof dialog.component, 'function')

  assert.ok(panel, 'the panel body is registered')
  assert.equal(panel.definition.name, 'sidebar.right.pane.tab')
  assert.equal(typeof panel.definition.inject().loadStats, 'function')
  assert.ok(panel.definition.inject().hooks.workspaces, 'the workspace store reaches the panel')

  assert.ok(panelTitle, 'the panel chip title is registered')
  assert.equal(panelTitle.definition.key, 'additions.workspace-panel')

  assert.equal(client.panelTypes.length, 1)
  assert.equal(client.panelTypes[0].kind, 'workspace-info')
  assert.equal(client.panelTypes[0].priority, 'builtin')
  assert.equal(client.panelTypes[0].title(), 'type.label')

  const guide = client.panelTypes[0].guide
  assert.ok(Array.isArray(guide) && guide.length === 1, 'the add-control lists the panel through a guide entry')
  assert.equal(guide[0].id, 'workspaces')
  assert.equal(typeof guide[0].title, 'function')
  assert.equal(typeof guide[0].description, 'function')
  assert.equal(guide[0].title(), 'guide.title')
  assert.equal(guide[0].description(), 'guide.description')

  const menuProps = menu.definition.inject()
  assert.equal(typeof menuProps.open, 'function')
  const dialogProps = dialog.definition.inject()
  assert.equal(typeof dialogProps.moveTo, 'function')
  assert.equal(typeof dialogProps.close, 'function')
  assert.equal(typeof dialogProps.pickFolder, 'function')
})

test('the controller opens on a session and closes without a move', () => {
  const { exports } = loadBundle()
  const controller = exports.__controller({ fetcher: jsonFetch({ ok: true }), refresh: () => {} })

  assert.equal(controller.store.getSnapshot().open, false)
  assert.equal(controller.open('session-source', 'La mia chat'), true)
  const opened = controller.store.getSnapshot()
  assert.equal(opened.open, true)
  assert.equal(opened.sessionId, 'session-source')
  assert.equal(opened.title, 'La mia chat')
  assert.equal(opened.phase, 'pick')
  assert.equal(opened.workspaceTitle, null)
  assert.equal(opened.error, null)

  controller.close()
  assert.equal(controller.store.getSnapshot().open, false)
})

test('a chat without an id cannot open the dialog', () => {
  const { exports } = loadBundle()
  const controller = exports.__controller({ fetcher: jsonFetch({ ok: true }), refresh: () => {} })
  assert.equal(controller.open('', 'x'), false)
  assert.equal(controller.open(undefined, 'x'), false)
  assert.equal(controller.store.getSnapshot().open, false)
})

test('moving to a workspace posts the captured chat and refreshes', async () => {
  const { exports } = loadBundle()
  let refreshes = 0
  const fetcher = jsonFetch({ ok: true, sessionId: 'session-clone', workspaceTitle: 'Beta', archived: true })
  const controller = exports.__controller({
    fetcher,
    refresh: async () => {
      refreshes += 1
    },
  })
  controller.open('session-source', 'La mia chat')

  const phase = await controller.moveTo({ workspaceId: 'ws-beta', label: 'Beta' })
  assert.equal(phase, 'done')
  assert.equal(fetcher.last.url, '/api/additions.move')
  assert.equal(fetcher.last.init.method, 'POST')
  assert.deepEqual(JSON.parse(fetcher.last.init.body), {
    sessionId: 'session-source',
    workspaceId: 'ws-beta',
  })
  assert.equal(refreshes, 1)

  const state = controller.store.getSnapshot()
  assert.equal(state.phase, 'done')
  assert.equal(state.workspaceTitle, 'Beta')
  assert.equal(state.error, null)
})

test('moving to a chosen folder posts a target path', async () => {
  const { exports } = loadBundle()
  const fetcher = jsonFetch({ ok: true, sessionId: 'session-clone', workspaceTitle: 'scelta' })
  const controller = exports.__controller({ fetcher, refresh: () => {} })
  controller.open('session-source', 'Chat')

  await controller.moveTo({ targetPath: 'C:\\picked folder', label: 'C:\\picked folder' })
  assert.deepEqual(JSON.parse(fetcher.last.init.body), {
    sessionId: 'session-source',
    targetPath: 'C:\\picked folder',
  })
  assert.equal(controller.store.getSnapshot().workspaceTitle, 'scelta')
})

test('a host refusal becomes the dialog error state', async () => {
  const { exports } = loadBundle()
  const fetcher = jsonFetch(
    { ok: false, error: { code: 'same-workspace', message: 'The chat is already in this workspace.' } },
    409,
  )
  const controller = exports.__controller({ fetcher, refresh: () => {} })
  controller.open('session-source', 'Chat')

  const phase = await controller.moveTo({ workspaceId: 'ws-alpha' })
  assert.equal(phase, 'error')
  const state = controller.store.getSnapshot()
  assert.equal(state.phase, 'error')
  assert.equal(state.error, 'The chat is already in this workspace.')
})

test('an unreadable error body still reports the HTTP status', async () => {
  const { exports } = loadBundle()
  const controller = exports.__controller({
    fetcher: async () => ({ ok: false, status: 502, json: async () => null }),
    refresh: () => {},
  })
  controller.open('session-source', 'Chat')

  await controller.moveTo({ workspaceId: 'ws-beta' })
  assert.match(controller.store.getSnapshot().error, /HTTP 502/u)
})

test('a move without a destination or session is a no-op', async () => {
  const { exports } = loadBundle()
  const fetcher = jsonFetch({ ok: true })
  const controller = exports.__controller({ fetcher, refresh: () => {} })

  assert.equal(await controller.moveTo({ workspaceId: 'ws-beta' }), undefined)
  controller.open('session-source', 'Chat')
  assert.equal(await controller.moveTo(undefined), undefined)
  assert.equal(fetcher.last, undefined)
  assert.equal(controller.store.getSnapshot().phase, 'pick')
})

test('the menu row reports through onSelect, not onClick', () => {
  const { exports } = loadBundle()
  const calls = []
  const element = exports.__components.MoveMenuRow({
    sessionId: 'session-source',
    displayTitle: 'La mia chat',
    t: (key) => key,
    open: (...args) => calls.push(['open', ...args]),
    closeMenu: () => calls.push(['close']),
  })

  assert.equal(element.type, 'MenuItemButton')
  assert.equal(element.props.children, 'action')
  assert.equal(typeof element.props.onSelect, 'function', 'MenuItemButton speaks onSelect')
  assert.equal(element.props.onClick, undefined, 'a row wired to onClick is silently dead')

  element.props.onSelect()
  assert.deepEqual(calls, [['close'], ['open', 'session-source', 'La mia chat']])
})

test('the wrapper dismisses the menu through the injected hook', () => {
  const { exports } = loadBundle()
  const closed = []
  const opened = []
  const wrapper = exports.__components.MoveMenuItem({
    sessionId: 'session-source',
    displayTitle: 'Chat',
    t: (key) => key,
    open: (...args) => opened.push(args),
    useMenuOpenState: () => [true, (value) => closed.push(value)],
  })

  assert.equal(typeof wrapper.type, 'function', 'the wrapper renders the hook-aware component')
  const row = wrapper.type(wrapper.props)
  assert.equal(typeof row.type, 'function', 'the hook-aware component renders the row component')
  const primitive = row.type(row.props)
  assert.equal(primitive.type, 'MenuItemButton')
  primitive.props.onSelect()
  assert.deepEqual(closed, [false])
  assert.deepEqual(opened, [['session-source', 'Chat']])
})

test('byte counts and dates are formatted for the panel', () => {
  const { exports } = loadBundle()
  const { formatBytes, formatCount, formatCreated } = exports.__stats
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024 * 3.5), '3.5 MB')
  assert.equal(formatBytes(-1), '—')
  assert.equal(formatBytes(undefined), '—')
  assert.ok(formatCount(1234567).length > 0)
  assert.equal(formatCreated('not a date'), 'not a date')
})

test('the panel loader calls the statistics route and surfaces host errors', async () => {
  const { exports } = loadBundle()
  const ok = jsonFetch({
    ok: true,
    sizeBytes: 2048,
    directories: 3,
    files: 7,
    codeLines: 10,
    docLines: 4,
    totalLines: 14,
    truncated: false,
  })
  const payload = await exports.__stats.load('ws-alpha', ok)
  assert.equal(payload.sizeBytes, 2048)
  assert.equal(payload.totalLines, 14)
  assert.equal(ok.last.url, '/api/additions.workspace-stats?workspaceId=ws-alpha')
  assert.equal(ok.last.init.method, 'GET')

  const failing = jsonFetch(
    { ok: false, error: { code: 'workspace-not-found', message: 'Unknown workspace.' } },
    404,
  )
  await assert.rejects(exports.__stats.load('ws-gone', failing), /Unknown workspace\./u)
})

test('status transitions become the two cues', () => {
  const { exports } = loadBundle()
  const { diffSessionStatus } = exports.__sounds
  const before = new Map([
    ['s1', { running: true }],
    ['s2', { running: true, pendingInteraction: { kind: 'approval' } }],
    ['s3', { running: false }],
  ])
  const after = new Map([
    ['s1', { running: false }],
    ['s2', { running: true, pendingInteraction: { kind: 'approval' } }],
    ['s3', { running: false, pendingInteraction: { kind: 'approval' } }],
    ['s4', { running: false }],
  ])

  assert.deepEqual(JSON.parse(JSON.stringify(diffSessionStatus(before, after))), [
    { sessionId: 's1', signal: 'ding' },
    { sessionId: 's3', signal: 'approval' },
  ])
})

test('the first snapshot, unknown sessions and other interactions stay silent', () => {
  const { exports } = loadBundle()
  const { diffSessionStatus } = exports.__sounds
  assert.deepEqual(JSON.parse(JSON.stringify(diffSessionStatus(undefined, new Map([['s1', { running: false }]])))), [])
  assert.deepEqual(JSON.parse(JSON.stringify(diffSessionStatus(new Map(), new Map([['s1', { running: false }]])))), [])
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        diffSessionStatus(
          new Map([['s1', { running: true, pendingInteraction: { kind: 'question' } }]]),
          new Map([['s1', { running: true, pendingInteraction: { kind: 'approval' } }]]),
        ),
      ),
    ),
    [],
    'a permission that was already pending is not announced twice',
  )
})

/**
 * @returns a stand-in Web Audio context recording decodes and starts.
 */
function fakeAudio() {
  const calls = { starts: 0, decoded: 0 }
  return {
    calls,
    context: {
      state: 'running',
      destination: {},
      decodeAudioData: async () => {
        calls.decoded += 1
        return { id: calls.decoded }
      },
      createBufferSource: () => ({
        connect: () => {},
        start: () => {
          calls.starts += 1
        },
        buffer: null,
      }),
      createGain: () => ({ gain: {}, connect: () => {} }),
      resume: async () => {},
    },
  }
}

test('a cue fetches once and plays through the audio graph', async () => {
  const { exports } = loadBundle()
  const { createSoundPlayer } = exports.__sounds
  const audio = fakeAudio()
  let fetches = 0
  const player = createSoundPlayer({
    createAudioContext: () => audio.context,
    fetcher: async () => {
      fetches += 1
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
    },
    log: () => {},
  })

  assert.equal(await player.play('ding'), true)
  assert.equal(await player.play('ding'), true)
  assert.equal(fetches, 1, 'the decoded buffer is cached')
  assert.equal(audio.calls.decoded, 1)
  assert.equal(audio.calls.starts, 2)
})

test('a disabled player and a broken fetch stay silent', async () => {
  const { exports } = loadBundle()
  const { createSoundPlayer } = exports.__sounds
  const logs = []
  let fetches = 0
  const disabled = createSoundPlayer({
    enabled: false,
    fetcher: async () => {
      fetches += 1
      throw new Error('must not be called')
    },
    log: () => {},
  })
  assert.equal(await disabled.play('ding'), false)
  assert.equal(fetches, 0)

  const audio = fakeAudio()
  const broken = createSoundPlayer({
    createAudioContext: () => audio.context,
    fetcher: async () => ({ ok: false, status: 404 }),
    log: (message) => logs.push(message),
  })
  assert.equal(await broken.play('approval'), false)
  assert.match(logs.join('\n'), /approval cue failed: HTTP 404/u)
})

test('configure follows the host sound settings', () => {
  const { exports } = loadBundle()
  const player = exports.__sounds.createSoundPlayer({ log: () => {} })
  assert.equal(player.enabled, true)
  player.configure({ enabled: false, volume: 2 })
  assert.equal(player.enabled, false)
  assert.equal(player.volume, 1)
  player.configure({ enabled: true, volume: -3 })
  assert.equal(player.volume, 0)
})

test('every key the bundle translates exists in the Chinese baseline', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const { exports } = loadBundle()
  const keys = new Set([...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]))
  assert.ok(keys.size >= 8, `the bundle translates ${keys.size} literal keys`)
  for (const key of keys) {
    assert.ok(Object.hasOwn(exports.__locales.zh, key), `baseline has ${key}`)
    for (const locale of Object.values(exports.__locales)) {
      assert.ok(Object.hasOwn(locale, key), `every locale has ${key}`)
    }
  }
})

test('every locale is complete against the Chinese baseline', () => {
  const { exports } = loadBundle()
  const locales = exports.__locales
  assert.deepEqual(Object.keys(locales), ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'it'])

  const baseline = Object.keys(locales.zh)
  assert.ok(baseline.length >= 10)
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

  for (const [locale, dictionary] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(dictionary), baseline, `${locale} key set`)
    for (const key of baseline) {
      const value = dictionary[key]
      assert.equal(typeof value, 'string', `${locale}.${key} is a string`)
      assert.ok(value.trim().length > 0, `${locale}.${key} is not empty`)
      assert.deepEqual(placeholders(value), placeholders(locales.zh[key]), `${locale}.${key} placeholders`)
      assert.ok(!value.includes('\u200b') && !value.includes('\ufeff'), `${locale}.${key} has no invisible markers`)
    }
  }
})
