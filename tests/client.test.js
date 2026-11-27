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
 * Minimal hook runtime for rendering a function component more than once:
 * state slots survive re-renders, effects are not executed.
 * @returns the React stand-in and a cursor reset for each render.
 */
function createHookRuntime() {
  const slots = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      const state = slots[index]
      const set = (next) => {
        state.value = typeof next === 'function' ? next(state.value) : next
      }
      return [state.value, set]
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
  }
  return {
    react,
    begin() {
      cursor = 0
    },
    reset() {
      slots.length = 0
      cursor = 0
    },
  }
}

/**
 * Load the hand-authored browser bundle the way the client module system does:
 * execute the script, capture the registration, and materialize the exports
 * with platform-module stubs.
 * @param options - optional `react` stand-in (a hook runtime).
 * @returns the plugin exports and the registration id.
 */
function loadBundle(options = {}) {
  let registration
  const window = { __ModuleLoader__: { load: (value) => (registration = value) } }
  const context = {
    window,
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    Intl,
    fetch: options.fetch ?? (async () => ({ ok: false, status: 0, json: async () => null })),
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), context, {
    filename: 'lib/client.js',
  })
  assert.ok(registration, 'the bundle registers itself')
  const modules = {
    react:
      options.react ??
      {
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
      Switch: 'Switch',
      Input: 'Input',
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
 * In-memory settings form mirror: one accepted section plus recorded writes.
 * @param options - starting `value`, `status`, `writable`, and whether the
 * namespace is served.
 * @returns the form and the `configForms` service stand-in.
 */
function createConfigForms(options = {}) {
  const listeners = new Set()
  const form = {
    revision: 1,
    writes: [],
    snapshot: {
      status: options.status ?? 'ready',
      value: options.value ?? { sounds: { enabled: true, ding: '', approval: '' } },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: options.writable ?? true,
    },
    getSnapshot() {
      return this.snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async mutate(ops) {
      this.writes.push(ops)
      return options.acceptWrites !== false
    },
    publish(value) {
      this.snapshot = { ...this.snapshot, value, revision: this.snapshot.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
  }
  const served = options.served !== false
  return {
    form,
    service: {
      get: () => form,
      describe: () => ({ getSnapshot: () => ({ namespaces: [] }), subscribe: () => () => {} }),
      whileServed: (namespaces, register) => (served ? register(new Set(namespaces)) : () => {}),
    },
  }
}

/**
 * Client-context stand-in: records slot registrations and locale dictionaries.
 * @param options - optional settings form/service stand-ins.
 * @returns the context plus the recorded entries.
 */
function createClient(options = {}) {
  const registrations = []
  const locales = []
  const panelTypes = []
  const configForms = options.configForms === null ? undefined : (options.configForms ?? createConfigForms(options))
  const ctx = {
    effect: (factory) => factory(),
    inject: (names, factory) => (names.every((name) => ctx[name] !== undefined) ? factory(ctx) : undefined),
    configForms: configForms?.service,
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
  return { ctx, registrations, locales, panelTypes, configForms }
}

/** @returns a fetch stub resolving one JSON payload with a status. */
function jsonFetch(payload, status = 200) {
  const stub = async (url, init) => {
    stub.last = { url, init }
    stub.calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, json: async () => payload }
  }
  stub.calls = []
  return stub
}

test('the bundle announces itself with the package id and the slot-based API', () => {
  const { id, exports } = loadBundle()
  assert.equal(id, 'dsh-additions')
  assert.equal(exports.name, 'dsh-additions')
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'workspaces', 'sessions', 'remote'])
  assert.equal(exports.inject.includes('configForms'), false, 'the settings service is optional')
  assert.equal(typeof exports.apply, 'function')
  assert.equal(exports.inject.includes('contextMenus'), false, 'the retired API is not requested')
})

test('apply registers the Session menu row, the dialog and the workspace panel', () => {
  const { exports } = loadBundle()
  const client = createClient()
  exports.apply(client.ctx)

  assert.equal(client.locales.length, 1)
  assert.equal(client.locales[0].namespace, 'additions')

  assert.equal(client.registrations.length, 7)
  const menu = client.registrations.find((entry) => entry.definition.id === 'additions.move')
  const dialog = client.registrations.find((entry) => entry.definition.id === 'additions.move-dialog')
  const panel = client.registrations.find((entry) => entry.definition.key === 'additions.workspace-panel')
  const panelTitle = client.registrations.find((entry) => entry.definition.name === 'sidebar.right.pane.tab.title')
  const watcher = client.registrations.find((entry) => entry.definition.id === 'additions.sound-watcher')
  const settingsPages = client.registrations.filter((entry) => entry.definition.name === 'plugins.row.config')
  assert.equal(settingsPages.length, 2, 'one page per bundle-name spelling')
  assert.deepEqual(
    settingsPages.map((entry) => entry.definition.key).sort(),
    ['dsh-additions#additions', 'dsh-chatshifter#additions'],
  )
  for (const entry of settingsPages) {
    assert.equal(entry.definition.locale, 'additions')
    assert.equal(typeof entry.definition.inject().saveSounds, 'function')
  }
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

test('the controller opens on a session and closes without a move', async () => {
  const { exports } = loadBundle()
  const controller = exports.__controller({ fetcher: jsonFetch({ ok: true }), refresh: () => {} })

  assert.equal(controller.store.getSnapshot().open, false)
  assert.equal(controller.open('session-source', 'La mia chat'), true)
  const opened = controller.store.getSnapshot()
  assert.equal(opened.open, true)
  assert.equal(opened.sessionId, 'session-source')
  assert.equal(opened.title, 'La mia chat')
  assert.equal(opened.phase, 'checking', 'the preflight runs before the picker')
  assert.equal(opened.workspaceTitle, null)
  assert.equal(opened.error, null)

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(controller.store.getSnapshot().phase, 'pick')

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

test('the preflight blocks a working chat and reports the reason', async () => {
  const { exports } = loadBundle()
  const fetcher = async (url) => {
    fetcher.last = { url }
    if (url.startsWith('/api/additions.preflight')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          movable: false,
          code: 'source-busy',
          message: 'This chat is running: finish or stop its work before moving it.',
        }),
      }
    }
    return { ok: true, json: async () => ({ ok: true, sessionId: 'session-clone' }) }
  }
  const controller = exports.__controller({ fetcher, refresh: () => {} })
  controller.open('session-source', 'Chat')
  await new Promise((resolve) => setTimeout(resolve, 5))

  const state = controller.store.getSnapshot()
  assert.equal(state.phase, 'blocked')
  assert.equal(state.blocked.code, 'source-busy')
  assert.equal(fetcher.last.url, '/api/additions.preflight?sessionId=session-source')
})

test('a failed preflight falls through to the picker', async () => {
  const { exports } = loadBundle()
  let calls = 0
  const controller = exports.__controller({
    fetcher: async () => {
      calls += 1
      throw new Error('offline')
    },
    refresh: () => {},
  })
  controller.open('session-source', 'Chat')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(controller.store.getSnapshot().phase, 'pick')
  assert.equal(calls, 1)
})

test('the dialog localizes known refusal codes and falls back to the host text', () => {
  const { exports } = loadBundle()
  const { reasonText } = exports.__move
  const t = (key) => `t:${key}`
  assert.equal(reasonText(t, { code: 'source-busy', message: 'busy' }), 't:reason.busy')
  assert.equal(reasonText(t, { code: 'move-in-progress', message: 'x' }), 't:reason.inProgress')
  assert.equal(reasonText(t, { code: 'same-workspace', message: 'English text' }), 'English text')
  assert.equal(reasonText(t, undefined), '')
})

test('the dialog renders the localized blocked state', () => {
  const { exports } = loadBundle()
  const state = {
    open: true,
    sessionId: 'session-source',
    title: 'Chat',
    phase: 'blocked',
    workspaceTitle: null,
    error: null,
    errorCode: null,
    blocked: { code: 'empty-session', message: 'The chat is empty.' },
  }
  const element = exports.__components.MoveDialog({
    t: (key, params) => (params === undefined ? key : `${key}:${params.reason}`),
    useMoveState: (selector) => selector(state),
    useWorkspaces: (selector) => selector({ items: [] }),
    moveTo: () => {},
    close: () => {},
    pickFolder: async () => null,
  })
  const body = element.props.children
  assert.equal(body.type, 'p')
  assert.match(body.props.children, /blocked:.*reason\.empty/u)
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
  const body = JSON.parse(fetcher.last.init.body)
  assert.equal(body.sessionId, 'session-source')
  assert.equal(body.workspaceId, 'ws-beta')
  assert.equal(typeof body.requestId, 'string')
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
  const body = JSON.parse(fetcher.last.init.body)
  assert.equal(body.sessionId, 'session-source')
  assert.equal(body.targetPath, 'C:\\picked folder')
  assert.equal(typeof body.requestId, 'string')
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
  assert.equal(fetcher.calls.filter((call) => call.url === '/api/additions.move').length, 0)
  await new Promise((resolve) => setTimeout(resolve, 5))
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

/**
 * Strip the vm realm from a value so deep equality compares plain data.
 * @param value - value produced inside the bundle's context.
 * @returns a structured clone of it.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('repointing a cue drops its decoded buffer and refetches it', async () => {
  const { exports } = loadBundle()
  const audio = fakeAudio()
  const urls = []
  const player = exports.__sounds.createSoundPlayer({
    createAudioContext: () => audio.context,
    fetcher: async (url) => {
      urls.push(url)
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
    },
    log: () => {},
  })

  await player.play('ding')
  await player.play('ding')
  assert.equal(urls.length, 1, 'the decoded buffer is reused while the path stands')

  player.configure({ ding: 'C:\\bell.wav' })
  assert.deepEqual(plain(player.variants), { ding: 'C:\\bell.wav', approval: '' })
  await player.play('ding')
  assert.equal(urls.length, 2, 'a new path forces a fresh fetch')
  assert.match(urls[1], /which=ding&v=C%3A%5Cbell\.wav/u)

  player.configure({ approval: 'C:\\uh.mp3' })
  await player.play('ding')
  assert.equal(urls.length, 2, 'an unrelated cue change keeps the ding buffer')
})

/**
 * Walk a jsx-runtime stub tree and collect elements matching a predicate.
 * @param node - element, array, or primitive.
 * @param predicate - element filter.
 * @returns the matching elements.
 */
function findAll(node, predicate) {
  const found = []
  const visit = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (predicate(value)) found.push(value)
    if (value.props !== undefined) visit(value.props.children)
  }
  visit(node)
  return found
}

/**
 * Render the settings page with a stateful hook runtime, against the recorded
 * `plugins.row.config` registration.
 * @param options - settings-form options plus an optional `view`.
 * @returns the current tree, a re-render, the form, and the client.
 */
function renderSettingsPage(options = {}) {
  const runtime = createHookRuntime()
  const { exports } = loadBundle({ react: runtime.react })
  const client = createClient(options)
  exports.apply(client.ctx)
  const registration = client.registrations.find((entry) => entry.definition.name === 'plugins.row.config')
  assert.ok(registration, 'the settings page is registered')
  const form = client.configForms.form
  const props = {
    view: options.view ?? 'page',
    t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    useSoundForm: (selector) => selector(form.getSnapshot()),
    saveSounds: (ops) => form.mutate(ops),
  }
  const render = () => {
    runtime.begin()
    return registration.component(props)
  }
  return { tree: render(), render, form, registration, client }
}

test('the settings page summarizes the notification switch', () => {
  assert.equal(renderSettingsPage({ view: 'summary' }).tree, 'settings.summaryOn')
  assert.equal(
    renderSettingsPage({
      view: 'summary',
      value: { sounds: { enabled: false, ding: '', approval: '' } },
    }).tree,
    'settings.summaryOff',
  )
})

test('the settings page renders the switch and the two cue paths', () => {
  const page = renderSettingsPage()
  const switches = findAll(page.tree, (node) => node.type === 'Switch')
  const inputs = findAll(page.tree, (node) => node.type === 'Input')
  assert.equal(switches.length, 1)
  assert.equal(switches[0].props.checked, true)
  assert.equal(inputs.length, 2)
  assert.equal(inputs[0].props.value, '')
  assert.equal(inputs[0].props['aria-label'], 'settings.ding')
  assert.equal(inputs[1].props['aria-label'], 'settings.approval')
  const save = findAll(page.tree, (node) => node.type === 'Button' && node.props.variant === 'primary')[0]
  assert.equal(save.props.disabled, true, 'nothing is staged yet')
})

test('the switch writes immediately and a refused write is reported', async () => {
  const page = renderSettingsPage({ acceptWrites: false })
  const toggle = findAll(page.tree, (node) => node.type === 'Switch')[0]
  toggle.props.onChange(false)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(plain(page.form.writes.at(-1)), [{ op: 'set', path: ['sounds', 'enabled'], value: false }])
  const refusal = findAll(page.render(), (node) => node.props?.children === 'settings.refused')
  assert.equal(refusal.length, 1)
})

test('Save submits both cue paths trimmed and enables only while dirty', async () => {
  const page = renderSettingsPage()
  const edit = (index, value) => {
    const inputs = findAll(page.render(), (node) => node.type === 'Input')
    inputs[index].props.onChange({ target: { value } })
  }

  edit(0, '  C:\\a.wav  ')
  edit(1, 'C:\\b.mp3')
  const save = findAll(page.render(), (node) => node.type === 'Button' && node.props.variant === 'primary')[0]
  assert.equal(save.props.disabled, false)

  save.props.onClick()
  await Promise.resolve()
  assert.deepEqual(plain(page.form.writes.at(-1)), [
    { op: 'set', path: ['sounds', 'ding'], value: 'C:\\a.wav' },
    { op: 'set', path: ['sounds', 'approval'], value: 'C:\\b.mp3' },
  ])
})

test('the settings page is registered only while the host serves the namespace', () => {
  const { exports } = loadBundle()
  const client = createClient({ served: false })
  exports.apply(client.ctx)
  assert.equal(client.registrations.filter((entry) => entry.definition.name === 'plugins.row.config').length, 0)
})

test('without the settings service the rest of the plugin stays and /info configures the cues', async () => {
  const { exports } = loadBundle({
    fetch: async () => ({ ok: true, json: async () => ({ sounds: { enabled: false, volume: 0.5 } }) }),
  })
  const client = createClient({ configForms: null })
  exports.apply(client.ctx)

  assert.equal(client.registrations.filter((entry) => entry.definition.name === 'plugins.row.config').length, 0)
  assert.equal(client.registrations.length, 5)
  await new Promise((resolve) => setTimeout(resolve, 5))
  const watcher = client.registrations.find((entry) => entry.definition.id === 'additions.sound-watcher')
  const player = watcher.definition.inject().player
  assert.equal(player.enabled, false)
  assert.equal(player.volume, 0.5)
})

test('the sound player follows accepted settings changes without a reload', () => {
  const { exports } = loadBundle()
  const client = createClient({
    value: { sounds: { enabled: false, ding: 'C:\\x.wav', approval: '' } },
  })
  exports.apply(client.ctx)
  const watcher = client.registrations.find((entry) => entry.definition.id === 'additions.sound-watcher')
  const player = watcher.definition.inject().player
  assert.equal(player.enabled, false)
  assert.deepEqual(plain(player.variants), { ding: 'C:\\x.wav', approval: '' })

  client.configForms.form.publish({ sounds: { enabled: true, ding: 'C:\\y.wav', approval: 'C:\\z.mp3' } })
  assert.equal(player.enabled, true)
  assert.deepEqual(plain(player.variants), { ding: 'C:\\y.wav', approval: 'C:\\z.mp3' })
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
