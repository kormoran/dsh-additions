/**
 * dsh-chatshifter — browser half.
 *
 * Adds one structured Session context-menu action, "Sposta nel workspace…",
 * whose submenu lists every other registered workspace plus "Altra cartella…".
 * Choosing a destination shows an explicit warning about what does not travel,
 * then calls the host half's authenticated `/api/chatshifter.move` route,
 * refreshes the Host-authoritative Session list and reports the outcome.
 *
 * The bundle is authored by hand in the loader's factory form; it requires no
 * module, only injected Cordis services, so it needs no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chatshifter',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const MOVE_ENDPOINT = '/api/chatshifter.move'
    const INFO_ENDPOINT = '/api/chatshifter.info'
    /** Between Fork (300) and Copy session ID (450) in ui-workspace's menu. */
    const MENU_ORDER = 400
    const CURRENT_SUFFIX = ' (attuale)'
    /** Host setting read once at activation: whether the original is hidden. */
    let archiveSource = true

    const text = {
      action: 'Sposta nel workspace…',
      otherFolder: 'Altra cartella…',
      pathPrompt: 'Percorso assoluto della cartella di destinazione:',
      noSession: 'Sessione non valida.',
      progress: (title) => `Spostamento di «${title}» in corso…`,
      success: (title, id) => `«${title}» spostata. Nuova chat: ${id}`,
      successArchived: ' L’originale è stato nascosto (archiviato), non cancellato.',
      successKept: ' L’originale è rimasto dov’era.',
      archiveFailed: (reason) => ` L’originale non è stato archiviato: ${reason}`,
      failure: (reason) => `Spostamento non riuscito: ${reason}`,
    }

    /**
     * @param value - session title captured by the menu row.
     * @returns the title, or a neutral placeholder.
     */
    function titleOf(value) {
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'questa chat'
    }

    /**
     * Read the host half's configuration once so the warning matches what the
     * move will actually do. Failures keep the documented default.
     */
    async function loadHostInfo() {
      try {
        const response = await fetch(INFO_ENDPOINT, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) return
        const body = await response.json()
        if (body?.ok === true && typeof body.archiveSource === 'boolean') archiveSource = body.archiveSource
      } catch {
        // The default (archive the original) stays in effect.
      }
    }

    /**
     * Build the confirmation text: the operation, the destination, and the
     * explicit list of what does not move with the chat.
     * @param title - displayed source chat title.
     * @param destination - destination label (workspace title or path).
     * @returns the complete confirmation text.
     */
    function confirmation(title, destination) {
      return [
        `Spostare «${title}» nel workspace «${destination}»?`,
        '',
        'Cosa NON viaggia con la chat:',
        '• l’identità: nasce una nuova chat con la storia copiata dentro;',
        '• AGENTS.md, .dsh/skills e gli altri file di progetto: la copia legge quelli del nuovo workspace;',
        '• sotto-sessioni, subagenti e job in background: restano con la chat originale;',
        '• impostazioni e permessi locali della cartella.',
        '',
        archiveSource
          ? 'L’originale non viene cancellato: resta nel workspace di partenza, nascosto (archiviato).'
          : 'L’originale resta visibile: lo spostamento crea una copia con la storia.',
        '',
        'Continuare?',
      ].join('\n')
    }

    /**
     * Call the host half.
     * @param payload - move input.
     * @returns the parsed success body.
     * @throws when the host refuses or the carrier fails.
     */
    async function postMove(payload) {
      const response = await fetch(MOVE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      })

      const raw = await response.text()
      let body
      try {
        body = raw.length > 0 ? JSON.parse(raw) : {}
      } catch {
        throw new Error(`risposta non valida dal server (${response.status})`)
      }

      if (!response.ok || body?.ok !== true) {
        const reason = body?.error?.message ?? `richiesta rifiutata (${response.status})`
        throw new Error(reason)
      }
      return body
    }

    /**
     * Ask for an absolute directory: the Host directory picker when composed,
     * otherwise a manual path prompt.
     * @param ctx - client context.
     * @returns the chosen path, or null when the operator cancelled.
     */
    async function pickFolder(ctx) {
      const picker = ctx.remote?.directoryPicker
      if (picker !== undefined && typeof picker.pick === 'function') {
        try {
          const result = await picker.pick()
          if (result?.ok === true) return result.value ?? null
        } catch {
          // No native/browse picker composed: fall through to the manual prompt.
        }
      }
      const answer = window.prompt(text.pathPrompt)
      return answer === null || answer.trim().length === 0 ? null : answer.trim()
    }

    /**
     * Run one move after the operator confirmed it.
     * @param ctx - client context.
     * @param sessionId - source chat.
     * @param target - `{ workspaceId }` or `{ targetPath }`.
     * @param destinationLabel - destination name used in the copy.
     * @param title - source chat title.
     */
    async function runMove(ctx, sessionId, target, destinationLabel, title) {
      if (!window.confirm(confirmation(title, destinationLabel))) return

      ctx.contextMenus.notify(text.progress(title), false)
      try {
        const result = await postMove({ sessionId, ...target })
        await refreshSessionList(ctx)
        let message = text.success(result.workspaceTitle ?? destinationLabel, result.sessionId)
        message += result.archived ? text.successArchived : text.successKept
        if (result.archiveError !== undefined && result.archiveError !== null) {
          message += text.archiveFailed(result.archiveError)
        }
        ctx.contextMenus.notify(message, true)
      } catch (error) {
        ctx.contextMenus.notify(text.failure(error?.message ?? String(error)), false)
      }
    }

    /**
     * Refresh the Host-authoritative Session list so the new row appears
     * without a page reload. A refresh failure is not a move failure: the next
     * navigation refreshes the list anyway.
     * @param ctx - client context.
     */
    async function refreshSessionList(ctx) {
      try {
        await ctx.sessions.refresh()
      } catch {
        // Deliberately ignored: the move itself already succeeded.
      }
    }

    /**
     * Build the Session menu contribution for one captured row.
     * @param ctx - client context.
     * @param target - captured Session target.
     * @returns menu actions.
     */
    function buildActions(ctx, target) {
      const sessionId = target?.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) return []

      const title = titleOf(target.displayTitle)
      const snapshot = ctx.workspaces?.list?.getSnapshot?.()
      const workspaceList = Array.isArray(snapshot?.items) ? snapshot.items : []

      if (snapshot?.phase === 'pending' && workspaceList.length === 0) {
        return [{ id: 'chatshifter.move', label: text.action, disabled: true }]
      }

      const owning = new Set(
        workspaceList
          .filter((workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId))
          .map((workspace) => workspace.workspaceId),
      )

      const children = workspaceList.map((workspace) => {
        const current = owning.has(workspace.workspaceId)
        const label = `${workspace.title || workspace.path}${current ? CURRENT_SUFFIX : ''}`
        return {
          id: `chatshifter.move.to.${workspace.workspaceId}`,
          label,
          disabled: current,
          run: current
            ? undefined
            : () =>
                runMove(
                  ctx,
                  sessionId,
                  { workspaceId: workspace.workspaceId },
                  workspace.title || workspace.path,
                  title,
                ),
        }
      })

      children.push({
        id: 'chatshifter.move.other',
        label: text.otherFolder,
        separatorBefore: children.length > 0,
        run: async () => {
          const path = await pickFolder(ctx)
          if (path === null) return
          await runMove(ctx, sessionId, { targetPath: path }, path, title)
        },
      })

      return [{ id: 'chatshifter.move', label: text.action, children }]
    }

    /**
     * Activate the browser plugin.
     * @param ctx - client context.
     */
    function apply(ctx) {
      void loadHostInfo()
      ctx.effect(
        () =>
          ctx.contextMenus.register({
            id: 'chatshifter.move',
            target: 'session',
            order: MENU_ORDER,
            observe: () => [ctx.workspaces.list],
            resolve: (target) => buildActions(ctx, target),
          }),
        'chatshifter: move-to-workspace session menu',
      )
    }

    exports.name = 'dsh-chatshifter'
    exports.inject = ['contextMenus', 'workspaces', 'sessions', 'remote']
    exports.apply = apply
    return module.exports
  },
})
