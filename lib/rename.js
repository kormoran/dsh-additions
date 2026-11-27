/**
 * `/rename` — retitle the current chat from the composer.
 *
 * DSH already ships a rename dialog in the Session menu; this command is the
 * keyboard-first sibling for the same operation, for the moments when the hand
 * is already on the composer. It reuses the title service's own path
 * (`SessionTitleService.rename`), so the accepted title is a normal
 * `session/title` event with the `user` source: it is durable, it pins the
 * title against automatic regeneration, and it follows the log into a moved
 * copy exactly like any other title revision.
 *
 * Nothing is written by this module: the command registry logs `command/run`
 * and `command/done` around the handler, and the title service appends the
 * title event.
 *
 * @module dsh-additions/rename
 */

/** Slash-command name. */
export const RENAME_COMMAND = 'rename'
/** Discovery copy the command palette shows. */
export const RENAME_DESCRIPTION = 'Rename the current chat'
/** Stable, plugin-namespaced definition identity for adapters. */
export const RENAME_DEFINITION_ID = 'dsh-additions:rename'
/** Shown when the invocation names no title. */
export const RENAME_USAGE = 'Usage: /rename <new title>'

/**
 * Read the requested title from a command invocation's raw input.
 *
 * A title is free text, so the whole remainder of the line is the title; one
 * matching pair of surrounding single or double quotes is removed, which is the
 * natural way to type a title with leading or trailing spaces.
 *
 * @param rawInput - text following the command name, separator included.
 * @returns the trimmed title, or an empty string when none was supplied.
 */
export function readTitle(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : ''
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' || first === "'") && last === first) return text.slice(1, -1).trim()
  }
  return text
}

/**
 * Register `/rename` on the host command registry.
 *
 * The handler renames the session of the agent whose composer dispatched the
 * command: `invocation.agent.id` is that session's identity, and only a live
 * session can receive a title revision.
 *
 * @param ctx - host context carrying `commands`, `sessions` and `sessionTitle`.
 * @returns the disposer registered with the plugin's effects.
 */
export function registerRenameCommand(ctx) {
  const handler = (invocation) => {
    const title = readTitle(invocation?.rawInput)
    const sessionId = invocation?.agent?.id
    const session = sessionId === undefined ? undefined : ctx.sessions.get(sessionId)

    if (title.length === 0) {
      const current = session === undefined ? undefined : ctx.sessionTitle.get(session)
      return {
        kind: 'error',
        text: current === undefined ? RENAME_USAGE : `Current title: “${current.title}”. ${RENAME_USAGE}`,
      }
    }
    if (session === undefined) {
      return { kind: 'error', text: 'This chat is not live: it cannot be renamed.' }
    }

    try {
      const snapshot = ctx.sessionTitle.rename(session, title)
      return { kind: 'success', text: `Renamed to “${snapshot.title}”.` }
    } catch (error) {
      if (error?.name === 'SessionTitleInvalidError') {
        return { kind: 'error', text: 'The title is empty after normalization.' }
      }
      const reason = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: `Rename failed: ${reason}` }
    }
  }

  return ctx.effect(
    () =>
      ctx.commands.register({
        definitionId: RENAME_DEFINITION_ID,
        name: RENAME_COMMAND,
        description: RENAME_DESCRIPTION,
        input: { hint: 'New chat title' },
        handler,
      }),
    'additions: /rename command',
  )
}
