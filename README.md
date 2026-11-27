# dsh-additions

Additional commands and functions for the DeepSeek Harness.

The plugin is a collection of functions added for my convenience as I used the harness;
hence the name `dsh-additions` because it's the place to add what you need—a
command, a panel, an action—without opening a new plugin each time.
For this reason, I left the version at 0.x.0 instead of publishing it as "1.0.0": since
it's a collection of functions, there will probably never be a "complete" version of
this plugin. This is even more true because dsh itself is still in version 0.2.2 at the moment, so everything is still in progress.

- **command** (`lib/quit.js`) — `/quit` stops the DSH process from composer,
with a sorted path and exit watchdog;
- **host** (`lib/index.js`) — reads the source session, writes a new copy
persisted under the destination workspace, saves it in the workspace, and
archives the original;
- **browser** (`lib/client.js`) — a "Move to workspace..." item in the
chat context menu, with a choice of destination, an explicit warning
about what is not being moved, and the outcome of the operation. The item and messages are
translated into all DSH languages ​​plus Italian.

> The browser half uses the current client API (`ctx.slots`): the item appears in the
> chat `⋯` menu and opens a dialog for choosing the destination. On DSH
> 0.2.0, which exposed `ctx.contextMenus`, this version does not load.

## Workspace Statistics

The plugin can measure a workspace: total size in bytes, number of
directories, number of files, lines of **code**, and lines of **documentation**
(summed separately, plus the total). Documentation counts as code: `.md`,
`.rst`, `.txt`, `.tex`, `.adoc`, `.org`, `.mdx`, `.wiki` are added to the second
count.

The route is authenticated and responds only to the peer owner:

```text
GET /api/additions.workspace-stats?workspaceId=<id>
GET /api/additions.workspace-stats?path=<absolute path>
→ { ok, workspaceTitle, cached,
path, sizeBytes, directories, files, codeFiles, docFiles,
codeLines, docLines, totalLines, truncated, exhausted, elapsedMs }
```

The scan is deliberately limited, because a workspace is an arbitrary directory
and a web request should never hang:

| Limit (`stats`) | Default | Effect |
|---|---|---|
| `timeLimitMs` | `10000` | After this time, the scan stops and marks `truncated` |
| `cacheTtlMs` | `15000` | a second request within this time reuses the result (`cached: true`) |
| `maxEntries` | `200000` | maximum directory + file visited |
| `maxBytesRead` | `67108864` | bytes read to count lines |

Generated or vendor-generated directories (`.git`, `node_modules`, `.venv`, `dist`,
`build`, `target`, cache) are not counted; symlinks are not followed
; binary files (NUL in the first bytes) count as bytes but not as lines;
a file larger than 4 MB is partially counted and the result says
`exhausted: "file"`.

### Right panel "Workspace"

How to open: **`+`** (new tab) in the right panel → *guide* tab →
**"Workspace"** capsule. This is important to know because the `+` doesn't list registered types: it opens
the guide, and the guide only shows types that declare `guide` entries in their
definition (`{ id, order, title, description, icon? }`). A type without `guide` is
registered but unreachable from the UI.

The tab lists workspaces with title, path, and creation date. "Details"
reads live statistics and displays size, directory, files, lines of
code, lines of documentation, and total; if the scan is partial, it indicates this, and the
Refresh/Back buttons allow you to recalculate or return to the list.

The tab is only recorded if the right panel is composed
(`ctx.inject(['sidebarRightTabs'])`): without that service, the rest of the
browser half continues to function.

## Commands

### `/rename` — renames the current chat

The native rename remains in the chat's `⋯` menu (the "Rename" item, with its
dialog); `/rename` is the keyboard variant, for when your hand is already on the
composer:

```text
/rename New title
/rename "A title with spaces"
```

The text after the command is the title (an outer pair of quotes is
removed). The command uses the same path as the native rename
(`SessionTitleService.rename`): it writes a `session/title` event with source
`user`, so the title is persistent, blocks automatic regeneration, and
travels with the log in a moved copy. Without an argument, it responds with the current title
and usage. If the title service is not composed, the command does not
appear and the rest of the plugin remains intact.

### `/quit` — Stop DSH

Type `/quit` in composer and send. The command responds, then after `delayMs`
it issues a `SIGINT` on the process: this is the same path as `Ctrl+C` in the launch terminal,
the one that unmounts plugins and shuts down the web server. If the unmount
blocks, a watchdog calls `process.exit(0)` after `graceMs`.

The purpose of this command is to kill the node.js process that runs dsh if
the harness was launched without a console window (like I do, so as not to have
yet another window in the way). Otherwise, the only way is to kill it from Task Manager.

| Config (`quit`) | Default | Meaning |
|---|---|---|
| `command` | `quit` | command name |
| `delayMs` | `500` | Wait before interrupt, for the result to reach the browser |
| `graceMs` | `5000` | Time allowed for ordered unmounting before forced exit |

The browser tab **doesn't** close itself: Chrome and Edge ignore
`window.close()` on tabs opened by the user (and `dsh web` opens the browser from the
system, not via `window.open`). Close the tab when the page reports a
disconnection: the server has actually stopped.

Two things to know:
1. `/quit` also interrupts a current shift, and the session log remains readable upon the next resume;
2. `/quit` with arguments is rejected (`/quit takes no argument.`) without turning anything off.

## Sounds

Two beeps (can be disabled), so you don't have to look at the screen and can do other things while the model is running:

| Signal | When | Default sound |
|---|---|---|
| `ding` | model **ends round** (`running: true → false`) | synthesized bell |
| `approval` | there is a pending **permission request** (`pendingInteraction.kind === 'approval'`) | «uh oh» |

The two events are read from `uiSession.sessionStatus`, the same status the
client uses for activity dots: no listeners enter the approval
waterfall, so the plugin cannot delay or block a decision.

The default sounds are generated by [scripts/make-sounds.mjs](scripts/make-sounds.mjs)
(16-bit mono, 22 kHz): no third-party samples, clean license, 85 KB total.

### Activating and selecting the two files

Two equivalent paths, because the plugin declares its own settings namespace
(`additions`) and therefore has a configuration page.

**From the plugin page** — the normal way: open **Plugin** in the sidebar,
choose `dsh-additions`, open the `additions` line, and press the
configuration button. You will find:

- the **"Enable notification sounds"** checkbox (it works immediately, without reloading);
- the **"End shift"** checkbox with the path to the `ding` file;
- the **"Request authorization"** checkbox with the path to the `approval` file;
- **Save** / **Cancel** for the two text boxes (the paths are sent
together, so a half-written path doesn't replace a working sound).

The values ​​thus selected end up in the profile patch (`~/.dsh/profiles/<name>/cordis.patch.yml`,
`additions` line) and are applied hot: they are *volatile* fields in the plugin's
schema, so neither the server nor the page need to be restarted.

**From the bundle configuration** — for those who prefer the file, or for a
generated profile:

```yaml
sounds:
enabled: true
volume: 0.7
ding: C:\sounds\bell.wav
approval: C:\sounds\uh-oh.mp3
```

| Field (`sounds`) | Default | Meaning |
|---|---|---|
| `enabled` | `true` | turns off both signals (from the page: the checkbox) |
| `volume` | `0.7` | gain applied by browser (`0`–`1`); from file only |
| `ding` | packed asset | alternative file for end of shift (from page: box) |
| `approval` | packed asset | alternative file for permission request (from page: box) |

Accepted formats: wav, mp3, ogg, m4a, flac, webm; the path must be
**absolute**.

The file is read **at each playback** (no host-side caching): replacing it
or changing the path takes effect from the next cue. If the specified path
is unreadable, the plugin plays the packed asset, and the route response
declares this in the `x-additions-sound-source` header — a typo won't
cause you to miss the warning.

Two caveats:

- Browsers block audio until there's a user gesture: the AudioContext
is created and resumed with the first click or keystroke, so the **first** cue after
the page opens may remain silent;
- The end-of-shift signal applies to **every** session (even those created by
subagents): if you launch multiple jobs at once, you'll hear more dings.


## Languages

The plugin speaks all DSH languages ​​plus Italian, both in the UI and in the
metadata presented on the Plugins page:

| `zh` | `en` | `ja` | `es` | `fr` | `de` | `ru` | `pt` | `it` |
|---|---|---|---|---|---|---|---|

- **UI**: The dictionaries are in `lib/client.js` under the `additions` namespace.
`zh` is the baseline: DSH types and sends each language against the Chinese key set
and also requires `en` as a fallback, so each dictionary must have
the same keys and placeholders (`{title}`, `{reason}`, etc.). The tests
`every key the bundle translates…` and `every locale is complete…` verify this.
- **Plugin metadata** (title and description on the Plugins page): One file
per language in `locale/<id>.json`, with `{ "meta": { "title", "description" } }`.
DSH reads `locale/en.json` and every language in the same folder;
English is the declared fallback. Files are exported as
`./locale/*.json` and included in the tarball.
- **Errors**: The host does not translate messages, it exposes a stable `code`; the client
maps **each** movement route and statistics code to a
localized phrase (`reason.*`). Unknown code falls back to the host's English
`message`. The `every refusal code the host can answer is
localized` test aligns the lists exported from `lib/move.js` and
`lib/workspace-stats.js` with the bundle map.
- **Platform limitation**: Command descriptions and results (`/quit`,
`/rename`) are host text and do not have a translation channel; DSH
localizes only the built-in commands client-side. They therefore remain in English in
every language, as with other external plugins.

Italian becomes selectable when a language pack registers the
`it` language: in the `web` profile, `dsh-locale-it` does this. The plugin only registers the
`it` dictionary, not the language definition, so it does not conflict
with the pack that owns it.

## Installation

Requirements: DSH with a web profile and Node.js ≥ 20. For Italian, you need a language
pack that registers `it` (`dsh-locale-it`).

From package (tarball or npm):

```powershell
dsh plugin --profile web add C:\path\dsh-additions-0.3.0.tgz
```

From GitHub repository, if the repository is accessible:

```powershell
dsh plugin --profile web add github:kormoran/dsh-additions
```

For development, with a link to checkout:

```powershell
dsh plugin --profile web add link:C:\path\dsh-additions
```

The installation channel decides how the profile is updated:

| Installation | What goes in the profile | To update the code |
|---|---|---|
| `add <file>.tgz` / `add dsh-additions` | copy the package to `node_modules` | re-do `npm pack` and reinstall the tarball |
| `add link:<path>` | symlink at checkout | the file changes immediately, but the entry must be restarted |

In both cases, a **new** entry enters the graph only when DSH is restarted: the
server reads the profile bundles once, at boot.

After installation, **reload the page**: the entry appears in the `⋯` menu of
every chat in the sidebar, between "Create fork" and "Copy session ID". After
modifying `lib/client.js`, the served bundle is reviewed for file metadata
: to reread it without restarting DSH, disable and re-enable the
`additions` entry from the Plugins page (the opened page receives it hot);
a simple browser reload is not enough, because the graph pointed to by boot is
the one read by the entry at its last startup.

## Configuration

The plugin declares a `Config` schema and with it its own settings namespace (`additions`): fields marked *volatile* appear in the plugin's
configuration page and are applied hot.

| Field | Default | Meaning |
|---|---|---|
| `archiveSource` | `true` | Archives (hides) the original after a successful move. `false` leaves both chats visible. |
| `quit` | See [Commands](#quit--stop-dsh) | `command`, `delayMs`, `graceMs` of the `/quit` command. |
| `stats` | See [Workspace Statistics](#workspace-statistics) | Scan limits (time, entries, bytes, cache). |
| `sounds` | See [Sounds](#sounds) | `enabled`, `volume`, `ding`, `approval`; `enabled`, `ding`, and `approval` are editable from the page. |

Only the three volatile `sounds` fields appear on the plugin page;
`volume` and the other blocks remain configurable from the profile patch. A
write from the page saves the **complete** configuration of the line in the
profile patch (the non-volatile fields remain current).

## Internal API

Routes authenticated by the connection carrier (Peer owner only):

- `GET /api/additions.preflight?sessionId=…` — `{ ok, movable, source? }` or
`{ ok, movable: false, code, message, details? }`; read-only, does not write
anything. The dialog queries it before offering destinations.
- `POST /api/additions.move` — `{ sessionId, workspaceId? | targetPath?, keepOriginal?, requestId? }`
→ `{ ok, sessionId, workspaceId, workspaceTitle, workspacePath, source, events, location, validated, archived, archiveError? }`
- `GET /api/additions.info` — version and configuration of the host half.

- `GET /api/additions.workspace-stats` — Workspace statistics (see above).
- `GET /api/additions.sound?which=ding|approval` — The signal's audio file,
with `x-additions-sound-source: default|custom`.

Errors respond `{ ok: false, error: { code, message, details? } }`:
`code` is the stable contract that the client translates, `message` is an English fallback
for API consumers, and `details` carries the placeholder values
(`sessionId`, `path`, `reason`, `activity`, …). Movement codes:

| `code` | HTTP | When |
|---|---|---|
| `missing-session`, `invalid-session-id`, `missing-target`, `relative-path`, `invalid-body` | 400 | Unusable request (id cannot contain path separators) |
| `session-not-found`, `workspace-not-found` | 404 | Non-existent chat or workspace |
| `subagent-session`, `empty-session`, `unsupported-format`, `same-workspace`, `source-busy`, `move-in-progress` | 409 | Rejection on merit, before writing |
| `invalid-path`, `workspace-create-failed` | 400 | The chosen folder cannot be made a workspace |
| `clone-invalid`, `attach-failed` | 500 | The copy failed validation or registration; the original is not archived |
| `internal` | 500 | Unexpected failure, in host log |

The client locates `source-busy`, `subagent-session`, `empty-session`,
`session-not-found`, and `move-in-progress`; for other codes, it displays the
host`s `message`.

## Known Limitations

- An empty source chat, a subagent subsession, or a chat that is
still working are rejected **before** writing; the dialog indicates this
before allowing the destination to be chosen.
- The copy is instantaneous and is not transactional with the workspace: if
registration fails, the copy is removed best-effort (only an absolute
path is affected), and the `attach-failed` error reports the id and reason.
- The chat identity changes: any links or automations that cite the original id
must be updated. The job owner remains the original one by contract (the copied history does not transfer execution), so the
jobs listed in the copy still belong to the original chat.
- **Title of fork-derived copies**: A session that was already a fork and didn't
yet have a `session/title` event remains untitled, because the
title service excludes seed sessions from automatic generation. The copy is not
alive when moved, so you can't ask the service to
generate it: use `/rename <title>` on the copy (or on the source before
moving it).
- **When archiving the open chat**, the client does not clear the selection as does
native archiving: the view remains until you navigate elsewhere. There is no
public API to close the current view.