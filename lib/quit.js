/**
 * `/quit` — stop this DSH process from the chat.
 *
 * DSH ships no in-app shutdown control: the launcher only registers the
 * `SIGINT`/`SIGTERM` handlers that dispose every plugin and close the web
 * server, which is what `Ctrl+C` in the launching terminal triggers. This
 * module exposes exactly that path as a slash command, so the person at the
 * keyboard does not have to find the right window again.
 *
 * Two rules shape the implementation:
 *
 * 1. never shut down synchronously inside the handler — the command result has
 *    to reach the browser first, so the interrupt is scheduled;
 * 2. never rely on the graceful path alone — a watchdog forces
 *    `process.exit(0)` if disposal stalls, because "stop the server" must not
 *    degrade into "the server is stuck".
 *
 * @module dsh-additions/quit
 */

/** Slash-command name registered by default. */
export const QUIT_COMMAND = 'quit'
/** Discovery copy the command palette shows. */
export const QUIT_DESCRIPTION = 'Stop this DSH process'
/** Stable, plugin-namespaced definition identity for adapters. */
export const QUIT_DEFINITION_ID = 'dsh-additions:quit'
/** Wait before the interrupt: the command result must reach the browser first. */
export const DEFAULT_DELAY_MS = 500
/** Backstop after the interrupt: force the exit if the graceful path stalls. */
export const DEFAULT_GRACE_MS = 5000
/** Upper bound for either delay, so a typo cannot park the shutdown for hours. */
const MAX_DELAY_MS = 120000
/** The registry accepts lowercase letters, digits, `_` and `-` after the slash. */
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u

/**
 * Normalize the `quit` bundle config.
 *
 * @param config - raw config (`{ command?, delayMs?, graceMs? }`).
 * @returns the effective settings, defaults included.
 */
export function normalizeQuitConfig(config) {
  const requested = config ?? {}
  const command =
    typeof requested.command === 'string' && COMMAND_NAME_PATTERN.test(requested.command)
      ? requested.command
      : QUIT_COMMAND
  return {
    command,
    delayMs: readDelay(requested.delayMs, DEFAULT_DELAY_MS),
    graceMs: readDelay(requested.graceMs, DEFAULT_GRACE_MS),
  }
}

/**
 * Build the one-shot shutdown scheduler.
 *
 * `start()` is idempotent: a second `/quit` while the first is pending neither
 * doubles the timers nor changes the delays. The timers are unref'd where the
 * runtime supports it, so a pending shutdown never keeps the process alive by
 * itself.
 *
 * @param options - seams for tests: `process`, `schedule`, `clear`, `delayMs`, `graceMs`.
 * @returns `{ start, cancel, requested }`.
 */
export function createShutdown(options = {}) {
  const proc = options.process ?? globalThis.process
  const schedule = options.schedule ?? scheduleTimeout
  const clear = options.clear ?? clearTimeout
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS
  const log = options.log ?? (() => {})
  const timers = []
  let requested = false

  const start = () => {
    if (requested) return false
    requested = true
    timers.push(schedule(() => signalShutdown(proc, log), delayMs, { unref: false }))
    if (graceMs > 0) {
      timers.push(schedule(() => forceExit(proc, log), delayMs + graceMs, { unref: true }))
    }
    return true
  }

  const cancel = () => {
    for (const timer of timers.splice(0)) cancelTimer(timer, clear)
    requested = false
    return timers.length === 0
  }

  return {
    start,
    cancel,
    get requested() {
      return requested
    },
  }
}

/**
 * Register `/quit` on the host command registry.
 *
 * @param ctx - host context carrying `commands` (and optionally `logger`).
 * @param config - raw `quit` config.
 * @param overrides - seams forwarded to {@link createShutdown} (tests only).
 * @returns the shutdown scheduler, so callers can cancel a pending request.
 */
export function registerQuitCommand(ctx, config, overrides = {}) {
  const settings = normalizeQuitConfig(config)
  const shutdown = createShutdown({
    delayMs: settings.delayMs,
    graceMs: settings.graceMs,
    log: (message) => logInfo(ctx, message),
    ...overrides,
  })

  ctx.effect(
    () =>
      ctx.commands.register({
        definitionId: QUIT_DEFINITION_ID,
        name: settings.command,
        description: QUIT_DESCRIPTION,
        handler: (invocation) => {
          const extra = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
          if (extra.length > 0) {
            return { kind: 'error', text: `/${settings.command} takes no argument.` }
          }
          const first = shutdown.start()
          logInfo(ctx, first ? 'shutdown requested from /quit' : 'shutdown already pending')
          return {
            kind: 'success',
            text: first
              ? `Stopping DSH in ${settings.delayMs} ms. The page will disconnect: close this tab when it does.`
              : 'DSH is already shutting down.',
          }
        },
      }),
    'additions: /quit command',
  )

  return shutdown
}

/**
 * Emit the launcher's interrupt path.
 *
 * @param proc - the process-like object to signal.
 * @param log - sink for a failed emit.
 * @returns whether a listener accepted the signal.
 */
function signalShutdown(proc, log) {
  try {
    const accepted = typeof proc.emit === 'function' ? proc.emit('SIGINT') : false
    if (accepted === false) log('no SIGINT listener: relying on the watchdog')
    return accepted !== false
  } catch (error) {
    log(`SIGINT delivery failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Last resort when disposal stalls.
 *
 * @param proc - the process-like object to exit.
 * @param log - sink for a failed exit.
 */
function forceExit(proc, log) {
  try {
    if (typeof proc.exit === 'function') proc.exit(0)
  } catch (error) {
    log(`forced exit failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Default scheduler: a real timer, unref'd unless it holds the shutdown open.
 *
 * @param callback - timer body.
 * @param ms - delay.
 * @param options - `{ unref }`: whether the timer must not keep the loop alive.
 * @returns the timer handle.
 */
function scheduleTimeout(callback, ms, options = {}) {
  const timer = setTimeout(callback, ms)
  if (options.unref !== false && typeof timer?.unref === 'function') timer.unref()
  return timer
}

/**
 * @param timer - handle returned by the scheduler.
 * @param clear - the matching cancel function.
 */
function cancelTimer(timer, clear) {
  if (timer !== undefined) clear(timer)
}

/**
 * @param value - candidate delay.
 * @param fallback - value used when the candidate is unusable.
 * @returns a finite whole number of milliseconds within `[0, MAX_DELAY_MS]`.
 */
function readDelay(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(0, Math.trunc(value)), MAX_DELAY_MS)
}

/**
 * Log through the host logger when it is available.
 *
 * @param ctx - host context.
 * @param message - diagnostic line.
 */
function logInfo(ctx, message) {
  const logger = ctx?.logger
  try {
    if (logger !== undefined && typeof logger.info === 'function') logger.info(`[additions] ${message}`)
    else if (logger !== undefined && typeof logger.debug === 'function') logger.debug(`[additions] ${message}`)
  } catch {
    // Diagnostics must never veto a shutdown.
  }
}
