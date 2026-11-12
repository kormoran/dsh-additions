import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

/** Dictionaries from the most recently loaded bundle, reused by the fake locale. */
let lastLocales

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
  const exports = registration.factory()
  lastLocales = exports.__locales
  return { id: registration.id, exports }
}

/**
 * Minimal locale service with the same lookup shape as DSH's: active locale,
 * then English, then the key itself; `{name}` placeholders are interpolated.
 * @param dictionaries - namespace dictionaries keyed by locale.
 * @param active - initially active locale.
 * @returns the service and a mutable `active` property.
 */
function createLocale(dictionaries, active = 'it') {
  const registered = new Map()
  const state = { active }
  return {
    get active() {
      return state.active
    },
    set active(value) {
      state.active = value
    },
    register(ns, localeOrDicts, dict) {
      const pairs = typeof localeOrDicts === 'string' ? [[localeOrDicts, dict]] : Object.entries(localeOrDicts)
      let map = registered.get(ns)
      if (map === undefined) {
        map = new Map()
        registered.set(ns, map)
      }
      for (const [locale, entries] of pairs) map.set(locale, entries)
      return () => {}
    },
    bind(ns) {
      return (key, params) => {
        let template
        for (const locale of [state.active, 'en']) {
          const value = registered.get(ns)?.get(locale)?.[key]
          if (value !== undefined) {
            template = value
            break
          }
        }
        if (template === undefined) template = key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) =>
          name in params ? String(params[name]) : match,
        )
      }
    },
    getLocale() {
      return { active: state.active, locales: [], revision: 0 }
    },
    getSnapshot() {
      return this.getLocale()
    },
    subscribe() {
      return () => {}
    },
  }
}

/**
 * @param workspaces - workspace views served to the menu.
 * @param options - locale, phase, and Remote overrides.
 * @returns a client-context stand-in with recording services.
 */
function createClient(workspaces, options = {}) {
  const state = { contributions: [], notices: [], refreshes: 0, unregisters: 0 }
  const locale = options.locale ?? createLocale(lastLocales, options.activeLocale ?? 'it')
  const ctx = {
    effect: (factory) => factory(),
    locale,
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
  return { ctx, state, locale }
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
  assert.deepEqual([...exports.inject], ['contextMenus', 'workspaces', 'sessions', 'remote', 'locale'])
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
  assert.match(last.text, /«La mia chat»/u)
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
    new Response(JSON.stringify({ ok: false, error: { code: 'same-workspace', message: 'The chat is already here.' } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })
  const { exports } = loadBundle({ confirm: () => true, fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  await state.contributions[0].resolve(session)[0].children[1].run()
  const last = state.notices.at(-1)
  assert.equal(last.success, false)
  assert.match(last.text, /La chat è già in questo workspace\./u)
})

test('an unknown host code falls back to the host message', async () => {
  const fetch = async () =>
    new Response(
      JSON.stringify({ ok: false, error: { code: 'future-code', message: 'Server says no.' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )
  const { exports } = loadBundle({ confirm: () => true, fetch })
  const { ctx, state } = createClient([alpha, beta])
  exports.apply(ctx)

  await state.contributions[0].resolve(session)[0].children[1].run()
  assert.match(state.notices.at(-1).text, /Server says no\./u)
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

test('the menu follows the active locale', () => {
  const { exports } = loadBundle()
  const { ctx, state, locale } = createClient([alpha, beta], { activeLocale: 'en' })
  exports.apply(ctx)

  const english = state.contributions[0].resolve(session)
  assert.equal(english[0].label, 'Move to workspace…')
  assert.equal(english[0].children[0].label, 'Alpha (current)')
  assert.equal(english[0].children[2].label, 'Other folder…')

  locale.active = 'ja'
  const japanese = state.contributions[0].resolve(session)
  assert.equal(japanese[0].label, 'ワークスペースへ移動…')
  assert.equal(japanese[0].children[0].label, 'Alpha（現在）')

  locale.active = 'it'
  assert.equal(state.contributions[0].resolve(session)[0].label, 'Sposta nel workspace…')
})

test('every key the bundle translates exists in the baseline', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const { exports } = loadBundle()
  const keys = new Set([...source.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]))
  assert.ok(keys.size > 20, `the bundle translates ${keys.size} literal keys`)
  for (const key of keys) {
    assert.ok(Object.hasOwn(exports.__locales.zh, key), `baseline has ${key}`)
  }
})

test('every locale is complete against the Chinese baseline', () => {
  const { exports } = loadBundle()
  const locales = exports.__locales
  assert.deepEqual(Object.keys(locales), ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'it'])

  const baseline = Object.keys(locales.zh)
  assert.ok(baseline.length > 30)
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
