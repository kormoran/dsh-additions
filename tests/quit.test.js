import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DELAY_MS,
  DEFAULT_GRACE_MS,
  QUIT_COMMAND,
  QUIT_DEFINITION_ID,
  QUIT_DESCRIPTION,
  createShutdown,
  normalizeQuitConfig,
  registerQuitCommand,
} from '../lib/quit.js'

/**
 * Deterministic clock: schedules land on a queue that `run(ms)` advances, so
 * the tests observe the exact ordering of the interrupt and the watchdog.
 * @returns the schedule/clear seams plus the queue driver.
 */
function fakeClock() {
  let now = 0
  const queue = []
  return {
    queue,
    schedule: (callback, ms) => {
      const timer = { callback, at: now + ms, cleared: false, fired: false }
      queue.push(timer)
      return timer
    },
    clear: (timer) => {
      timer.cleared = true
    },
    run: (ms) => {
      now += ms
      for (const timer of [...queue].sort((left, right) => left.at - right.at)) {
        if (timer.cleared || timer.fired || timer.at > now) continue
        timer.fired = true
        timer.callback()
      }
    },
  }
}

/**
 * Stand-in for the host process: records signals and exits, and can refuse the
 * signal the way an unlistened event emitter does.
 * @param options - `listeners: 0` makes `emit` report nobody handled the signal.
 * @returns the fake process.
 */
function fakeProcess(options = {}) {
  const listeners = options.listeners ?? 1
  return {
    emitted: [],
    exitCode: undefined,
    emit(signal) {
      this.emitted.push(signal)
      if (options.throwOnEmit === true) throw new Error('emit exploded')
      return listeners > 0
    },
    exit(code) {
      this.exitCode = code
    },
  }
}

test('the quit config defaults to /quit with a delay and a watchdog', () => {
  assert.deepEqual(normalizeQuitConfig(undefined), {
    command: QUIT_COMMAND,
    delayMs: DEFAULT_DELAY_MS,
    graceMs: DEFAULT_GRACE_MS,
  })
})

test('the quit config accepts sane overrides and rejects unusable ones', () => {
  assert.deepEqual(normalizeQuitConfig({ command: 'stop', delayMs: 0, graceMs: 10 }), {
    command: 'stop',
    delayMs: 0,
    graceMs: 10,
  })
  assert.deepEqual(normalizeQuitConfig({ command: 'Quit!', delayMs: -5, graceMs: 1e12 }), {
    command: QUIT_COMMAND,
    delayMs: 0,
    graceMs: 120000,
  })
  assert.deepEqual(normalizeQuitConfig({ command: '', delayMs: Number.NaN, graceMs: '3000' }), {
    command: QUIT_COMMAND,
    delayMs: DEFAULT_DELAY_MS,
    graceMs: DEFAULT_GRACE_MS,
  })
})

test('the shutdown interrupts first and forces the exit only when needed', () => {
  const clock = fakeClock()
  const proc = fakeProcess()
  const shutdown = createShutdown({
    process: proc,
    schedule: clock.schedule,
    clear: clock.clear,
    delayMs: 500,
    graceMs: 5000,
  })

  assert.equal(shutdown.start(), true, 'the first request wins')
  assert.equal(shutdown.start(), false, 'a second request is a no-op')
  assert.equal(proc.emitted.length, 0, 'nothing happens synchronously')

  clock.run(499)
  assert.deepEqual(proc.emitted, [], 'the interrupt waits for the delay')
  clock.run(1)
  assert.deepEqual(proc.emitted, ['SIGINT'], 'the launcher interrupt path is used')
  assert.equal(proc.exitCode, undefined, 'the graceful path is given room')

  clock.run(5000)
  assert.equal(proc.exitCode, 0, 'the watchdog closes the remaining gap')
})

test('an unhandled signal still ends in the forced exit', () => {
  const clock = fakeClock()
  const proc = fakeProcess({ listeners: 0 })
  const logs = []
  createShutdown({
    process: proc,
    schedule: clock.schedule,
    clear: clock.clear,
    delayMs: 10,
    graceMs: 20,
    log: (message) => logs.push(message),
  }).start()

  clock.run(10)
  assert.deepEqual(proc.emitted, ['SIGINT'])
  assert.match(logs.join('\n'), /no SIGINT listener/u)
  clock.run(20)
  assert.equal(proc.exitCode, 0)
})

test('a throwing emit is reported and does not cancel the watchdog', () => {
  const clock = fakeClock()
  const proc = fakeProcess({ throwOnEmit: true })
  const logs = []
  createShutdown({
    process: proc,
    schedule: clock.schedule,
    clear: clock.clear,
    delayMs: 10,
    graceMs: 20,
    log: (message) => logs.push(message),
  }).start()

  clock.run(10)
  assert.match(logs.join('\n'), /SIGINT delivery failed: emit exploded/u)
  clock.run(20)
  assert.equal(proc.exitCode, 0)
})

test('cancel drops a pending shutdown and re-arms the request', () => {
  const clock = fakeClock()
  const proc = fakeProcess()
  const shutdown = createShutdown({
    process: proc,
    schedule: clock.schedule,
    clear: clock.clear,
    delayMs: 10,
    graceMs: 20,
  })

  shutdown.start()
  assert.equal(shutdown.cancel(), true)
  clock.run(1000)
  assert.deepEqual(proc.emitted, [])
  assert.equal(proc.exitCode, undefined)
  assert.equal(shutdown.requested, false)
  assert.equal(shutdown.start(), true, 'a cancelled shutdown can be requested again')
})

test('registering /quit wires the registry, the delay and the idempotence', () => {
  const registered = []
  const logs = []
  const ctx = {
    commands: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
    effect: (factory) => factory(),
    logger: { info: (message) => logs.push(message) },
  }
  const clock = fakeClock()
  const proc = fakeProcess()

  const shutdown = registerQuitCommand(
    ctx,
    { delayMs: 10, graceMs: 20 },
    { process: proc, schedule: clock.schedule, clear: clock.clear },
  )

  assert.equal(registered.length, 1, 'one command is registered')
  const [definition] = registered
  assert.equal(definition.name, QUIT_COMMAND)
  assert.equal(definition.description, QUIT_DESCRIPTION)
  assert.equal(definition.definitionId, QUIT_DEFINITION_ID)

  const result = definition.handler({ rawInput: '   ' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Stopping DSH in 10 ms/u)
  assert.match(result.text, /close this tab/u)

  clock.run(10)
  assert.deepEqual(proc.emitted, ['SIGINT'])

  const again = definition.handler({ rawInput: '' })
  assert.equal(again.kind, 'success')
  assert.match(again.text, /already shutting down/u)
  assert.equal(shutdown.requested, true)
  assert.match(logs.join('\n'), /shutdown requested from \/quit/u)
})

test('extra input is refused without scheduling anything', () => {
  const registered = []
  const ctx = {
    commands: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
    effect: (factory) => factory(),
  }
  const clock = fakeClock()
  const proc = fakeProcess()
  registerQuitCommand(ctx, {}, { process: proc, schedule: clock.schedule, clear: clock.clear })

  const refused = registered[0].handler({ rawInput: ' now' })
  assert.equal(refused.kind, 'error')
  assert.equal(refused.text, '/quit takes no argument.')

  clock.run(60_000)
  assert.deepEqual(proc.emitted, [])
  assert.equal(proc.exitCode, undefined)
})

test('a custom command name is used in the refusal text', () => {
  const registered = []
  const ctx = {
    commands: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
    effect: (factory) => factory(),
  }
  registerQuitCommand(
    ctx,
    { command: 'stop' },
    { process: fakeProcess(), schedule: fakeClock().schedule, clear: () => {} },
  )
  assert.equal(registered[0].name, 'stop')
  assert.equal(registered[0].handler({ rawInput: 'x' }).text, '/stop takes no argument.')
})
