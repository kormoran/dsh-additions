import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'
import {
  RENAME_COMMAND,
  RENAME_DEFINITION_ID,
  RENAME_DESCRIPTION,
  RENAME_USAGE,
  readTitle,
  registerRenameCommand,
} from '../lib/rename.js'

/**
 * Host-context stand-in for the rename command.
 * @param options - `live: false` hides the session; `invalid` throws the
 * title service's invalid error; `renameError` throws a generic failure.
 * @returns the context, the registered definitions and the rename calls.
 */
function createRenameContext(options = {}) {
  const definitions = []
  const routes = []
  const renames = []
  const sessions = new Map([['session-x', { id: 'session-x' }]])
  const titles = new Map()
  const ctx = {
    effect: (factory) => factory(),
    inject: (names, factory) => (names.every((name) => ctx[name] !== undefined) ? factory(ctx) : undefined),
    commands: {
      register: (definition) => {
        definitions.push(definition)
        return () => {}
      },
    },
    connection: {
      fetch: {
        register: (route) => {
          routes.push(route.path)
          return () => {}
        },
      },
    },
    workspaceRegistry: { get: () => undefined },
    sessions: {
      get: (id) => (options.live === false ? undefined : sessions.get(id)),
    },
    sessionTitle: {
      get: (session) => titles.get(session.id),
      rename: (session, title) => {
        if (options.invalid === true) {
          const error = new Error('empty title')
          error.name = 'SessionTitleInvalidError'
          throw error
        }
        if (options.renameError !== undefined) throw options.renameError
        renames.push({ id: session.id, title })
        const snapshot = { title, source: { kind: 'user' } }
        titles.set(session.id, snapshot)
        return snapshot
      },
    },
    logger: { warn() {} },
  }
  return { ctx, definitions, routes, renames, titles }
}

/**
 * Invoke one registered command definition.
 * @param definition - command returned by the registry.
 * @param rawInput - text following the command name.
 * @returns the handler's result.
 */
function invoke(definition, rawInput) {
  return definition.handler({ agent: { id: 'session-x' }, rawInput, signal: new AbortController().signal })
}

test('readTitle trims the remainder and unwraps one matching quote pair', () => {
  assert.equal(readTitle('  Nuovo titolo  '), 'Nuovo titolo')
  assert.equal(readTitle('"Titolo con spazi"'), 'Titolo con spazi')
  assert.equal(readTitle("'single'"), 'single')
  assert.equal(readTitle('"unbalanced'), '"unbalanced')
  assert.equal(readTitle('say "hi"'), 'say "hi"')
  assert.equal(readTitle('""'), '')
  assert.equal(readTitle('   '), '')
  assert.equal(readTitle(undefined), '')
  assert.equal(readTitle(42), '')
})

test('the command registers with a stable identity, an input hint and a handler', () => {
  const harness = createRenameContext()
  registerRenameCommand(harness.ctx)
  assert.equal(harness.definitions.length, 1)
  const [definition] = harness.definitions
  assert.equal(definition.name, RENAME_COMMAND)
  assert.equal(definition.description, RENAME_DESCRIPTION)
  assert.equal(definition.definitionId, RENAME_DEFINITION_ID)
  assert.equal(definition.input.hint, 'New chat title')
  assert.equal(typeof definition.handler, 'function')
})

test('a rename renames the live session and reports the accepted title', () => {
  const harness = createRenameContext()
  registerRenameCommand(harness.ctx)
  const result = invoke(harness.definitions[0], '  Nuovo titolo  ')
  assert.deepEqual(harness.renames, [{ id: 'session-x', title: 'Nuovo titolo' }])
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Nuovo titolo/u)
})

test('a quoted title loses only its outer quotes', () => {
  const harness = createRenameContext()
  registerRenameCommand(harness.ctx)
  invoke(harness.definitions[0], '"  Spazi  interni  "')
  assert.deepEqual(harness.renames, [{ id: 'session-x', title: 'Spazi  interni' }])
})

test('a missing title reports the usage and writes nothing', () => {
  const harness = createRenameContext()
  registerRenameCommand(harness.ctx)
  const result = invoke(harness.definitions[0], '   ')
  assert.equal(result.kind, 'error')
  assert.equal(result.text, RENAME_USAGE)
  assert.deepEqual(harness.renames, [])

  harness.titles.set('session-x', { title: 'Titolo attuale' })
  const withCurrent = invoke(harness.definitions[0], '')
  assert.equal(withCurrent.kind, 'error')
  assert.match(withCurrent.text, /Titolo attuale/u)
  assert.match(withCurrent.text, /Usage: \/rename/u)
})

test('a chat that is not live is refused without writing', () => {
  const harness = createRenameContext({ live: false })
  registerRenameCommand(harness.ctx)
  const result = invoke(harness.definitions[0], 'Titolo')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /not live/u)
  assert.deepEqual(harness.renames, [])
})

test('an invalid title and a generic failure both become error results', () => {
  const invalid = createRenameContext({ invalid: true })
  registerRenameCommand(invalid.ctx)
  const invalidResult = invoke(invalid.definitions[0], 'x')
  assert.equal(invalidResult.kind, 'error')
  assert.match(invalidResult.text, /empty after normalization/u)

  const broken = createRenameContext({ renameError: new Error('boom') })
  registerRenameCommand(broken.ctx)
  const brokenResult = invoke(broken.definitions[0], 'x')
  assert.equal(brokenResult.kind, 'error')
  assert.match(brokenResult.text, /Rename failed: boom/u)
})

test('apply registers /rename beside /quit when the title service is composed', () => {
  const harness = createRenameContext()
  apply(harness.ctx, {})
  const names = harness.definitions.map((definition) => definition.name).sort()
  assert.deepEqual(names, ['quit', 'rename'])
  assert.equal(harness.routes.length, 4, 'the four authenticated routes stay registered')

  const rename = harness.definitions.find((definition) => definition.name === 'rename')
  const result = invoke(rename, 'Da apply')
  assert.equal(result.kind, 'success')
  assert.deepEqual(harness.renames, [{ id: 'session-x', title: 'Da apply' }])
})

test('without the title service the rest of the host half still loads', () => {
  const harness = createRenameContext()
  delete harness.ctx.sessionTitle
  apply(harness.ctx, {})
  assert.deepEqual(harness.definitions.map((definition) => definition.name), ['quit'])
  assert.equal(harness.routes.length, 4)
})
