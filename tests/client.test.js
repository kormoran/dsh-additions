import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

/**
 * Load the hand-authored browser bundle the way the client module system
 * does: execute the script, capture the registration, and materialize the
 * returned exports.
 * @param overrides - globals the bundle reads (`fetch`, `confirm`, `prompt`).
 * @returns the plugin exports.
 */
function loadBundle(overrides = {}) {
  let registration
  const window = {
    __ModuleLoader__: { load: (value) => (registration = value) },
    confirm: overrides.confirm ?? (() => true),
    prompt: overrides.prompt ?? (() => null),
  }
  const context = {
    window,
    fetch: overrides.fetch,
    console,
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), context, {
    filename: 'lib/client.js',
  })
  assert.ok(registration, 'the bundle registers itself')
  return { id: registration.id, exports: registration.factory() }
}

/**
 * @param workspaces - workspace views served to the menu.
 * @param archives - archived session ids.
 * @returns a client-context stand-in with recording services.
 */
function createClient(workspaces, options = {}) {
  const state = { contributions: [], notices: [], refreshes: 0, unregisters: 0 }
  const ctx = {
    effect: (factory) => factory(),
    contextMenus: {
      register: (contribution) => {
        state.contributions.push(contribution)
        return () => {
          state.unregisters += 1
        }
      },
      notify: (text, success) => state.notices.push({ text, success }),
    },
    workspaces: {
      list: { getSnapshot: () => ({ items: workspaces, phase: options.phase ?? 'ready' }) },
    },
    sessions: {
      refresh: async () => {
        state.refreshes += 1
      },
    },
    remote: options.remote ?? {},
  }
  return { ctx, state }
}

const session = { sessionId: 'session-source', displayTitle: 'La mia chat' }
const alpha = { workspaceId: 'ws-alpha', path: 'C:\\alpha', title: 'Alpha', sessionIds: ['session-source'] }
const beta = { workspaceId: 'ws-beta', path: 'C:\\beta', title: 'Beta', sessionIds: [] }

/** @returns a fetch stub answering the move endpoint and the host-info route. */
function okFetch(body, options = {}) {
  const stub = async (url, init) => {
    if (url === '/api/chatshifter.info') {
      stub.infoCalls = (stub.infoCalls ?? 0) + 1
      return Response.json({ ok: true, archiveSource: options.archiveSource ?? true })
    }
    stub.last = { url, init }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return stub
}

test('the bundle announces itself with the package id and injected services', () => {
  const { id, exports } = loadBundle()
  assert.equal(id, 'dsh-chatshifter')
  assert.deepEqual([...exports.inject], ['contextMenus', 'workspaces', 'sessions', 'remote'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(exports.name, 'dsh-chatshifter')
})

test('the session menu lists workspaces, marks the current one, and offers another folder', () => {
  const { exports } = loadBundle()
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  assert.equal(state.contributions.length, 1)
  assert.equal(state.contributions[0].target, 'session')
  assert.equal(state.contributions[0].order, 400)

  const actions = state.contributions[0].resolve(session)
  assert.equal(actions.length, 1)
  assert.equal(actions[0].label, 'Sposta nel workspace…')

  const children = actions[0].children
  assert.equal(children.length, 3)
  assert.equal(children[0].label, 'Alpha (attuale)')
  assert.equal(children[0].disabled, true)
  assert.equal(children[1].label, 'Beta')
  assert.equal(children[1].disabled, false)
  assert.equal(children[2].label, 'Altra cartella…')
})

test('a confirmed move posts the captured session and refreshes the list', async () => {
  const fetch = okFetch({
    ok: true,
    sessionId: 'session-clone',
    workspaceTitle: 'Beta',
    archived: true,
  })
  const prompts = []
  const { exports } = loadBundle({ confirm: (text) => (prompts.push(text), true), fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  const action = state.contributions[0].resolve(session)[0].children[1]
  await action.run()

  assert.equal(fetch.last.url, '/api/chatshifter.move')
  assert.equal(fetch.last.init.method, 'POST')
  assert.deepEqual(JSON.parse(fetch.last.init.body), { sessionId: 'session-source', workspaceId: 'ws-beta' })
  assert.equal(state.refreshes, 1)
  assert.match(prompts[0], /Cosa NON viaggia/u)
  assert.match(prompts[0], /«La mia chat»/u)
  assert.match(prompts[0], /«Beta»/u)

  const last = state.notices.at(-1)
  assert.equal(last.success, true)
  assert.match(last.text, /session-clone/u)
  assert.match(last.text, /archiviato/u)
})

test('a declined confirmation posts nothing', async () => {
  const fetch = okFetch({ ok: true })
  const { exports } = loadBundle({ confirm: () => false, fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  await state.contributions[0].resolve(session)[0].children[1].run()
  assert.equal(fetch.last, undefined)
  assert.equal(state.refreshes, 0)
})

test('the warning follows the host archive setting', async () => {
  const prompts = []
  const fetch = okFetch({ ok: true }, { archiveSource: false })
  const { exports } = loadBundle({ confirm: (text) => (prompts.push(text), false), fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 10))

  await state.contributions[0].resolve(session)[0].children[1].run()
  assert.match(prompts[0], /resta visibile/u)
})

test('a host refusal becomes a visible failure notice', async () => {
  const fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: { code: 'same-workspace', message: 'La chat è già qui.' } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })
  const { exports } = loadBundle({ confirm: () => true, fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  await state.contributions[0].resolve(session)[0].children[1].run()
  const last = state.notices.at(-1)
  assert.equal(last.success, false)
  assert.match(last.text, /La chat è già qui\./u)
})

test('another folder uses the picker and sends a target path', async () => {
  const fetch = okFetch({ ok: true, sessionId: 'session-clone', workspaceTitle: 'scelta', archived: false })
  const picked = []
  const remote = { directoryPicker: { pick: async () => ({ ok: true, value: 'C:\\picked folder' }) } }
  const { exports } = loadBundle({ confirm: (text) => (picked.push(text), true), fetch })
  const { ctx, state } = createClient([alpha, beta], { remote })
  exports.apply(ctx)

  const actions = state.contributions[0].resolve(session)
  await actions[0].children[2].run()

  assert.deepEqual(JSON.parse(fetch.last.init.body), {
    sessionId: 'session-source',
    targetPath: 'C:\\picked folder',
  })
  assert.match(picked[0], /C:\\picked folder/u)
  assert.match(state.notices.at(-1).text, /originale è rimasto/u)
})

test('the directory prompt is the fallback when no picker is composed', async () => {
  const fetch = okFetch({ ok: true, sessionId: 'session-clone', workspaceTitle: 'x', archived: true })
  const { exports } = loadBundle({ confirm: () => true, prompt: () => 'D:\\typed', fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  await state.contributions[0].resolve(session)[0].children[2].run()
  assert.equal(JSON.parse(fetch.last.init.body).targetPath, 'D:\\typed')
})

test('a workspace list still loading yields a disabled action', () => {
  const { exports } = loadBundle()
  const { ctx, state } = createClient([], { phase: 'pending' })
  exports.apply(ctx)
  const actions = state.contributions[0].resolve(session)
  assert.equal(actions[0].disabled, true)
  assert.equal(actions[0].children, undefined)
})
