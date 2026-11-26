# PROJECT_STATE — dsh-additions

Memoria permanente del progetto. Aggiornato: **2026-11-26**, versione **0.6.0**.
Pacchetto e repository GitHub si chiamano entrambi `dsh-additions` (il repository
è stato rinominato il 26/11; la cartella locale resta `I:\src\dsh-chatshifter`).
Il backlog per la 1.0.0 è in [TODO.md](TODO.md).

## Obiettivo

Comandi e pannelli per DeepSeek Harness, ospitati in un solo plugin: `/quit`
ferma il processo dal composer, lo spostamento di una chat in un altro workspace
resta la funzione storica nata come `dsh-chatshifter`, e le statistiche dei
workspace (dimensione, directory, file, righe di codice e di documentazione)
alimentano il pannello destro «Workspace».

## Stato: 0.6.0 installata — segnali sonori, pannello «Workspace», /quit

`dsh-additions` v0.6.0 è nel profilo `web` come **tarball** (`file:` a
`dist/dsh-additions-0.6.0.tgz`), la riga `additions` del loader compone
(`archiveSource`, `quit`, `stats`, `sounds`).

Verificato il 26/11:

```text
test:     60/60 unitari verdi (15 host, 19 bundle browser, 9 /quit, 9 statistiche, 8 suoni)
pacchetto: dist/dsh-additions-0.6.0.tgz — 12 file (include i due WAV), 111,7 kB,
           sha256 8CDAD98E…F1504CBB
profilo:   dsh-additions@0.6.0, copia reale con assets/ding.wav e assets/uh-oh.wav
bundle:    tab workspace-info + voce guida + watcher dei segnali in shell.overlay
API client: ctx.slots (menù in sidebar.workspaces.session.menu.item, dialog in
           shell.overlay); tab via ctx.inject(['sidebarRightTabs'])
suoni:     letti da uiSession.sessionStatus — running true→false = ding,
           pendingInteraction.kind 'approval' = uh oh; rotta /api/additions.sound
GUI (a video, DSH 0.2.1-rc.2): voce «Sposta nel workspace…» funzionante, chat
           spostata davvero; `+` → guida → «Workspace» → lista → «Dettagli»
```

I segnali sonori **non sono ancora provati a video**: richiedono il riavvio (o il
toggle) che ricarica il bundle 0.6.0.

Verificato a video il 25/11: il dialog di spostamento funziona end-to-end (la chat
cambia workspace e la copia si riapre con la storia) e il pannello destro mostra
lista e statistiche del workspace scelto. Resta non provato a video solo `/quit`
(l'interruzione del server, per ovvie ragioni di comodo).

## Stato storico: 0.4.0 (API client corrente e motore statistiche)

La 0.4.0 ha portato la metà browser da `ctx.contextMenus` a `ctx.slots` (voce di
spostamento con dialog) e ha aggiunto il motore delle statistiche
(`lib/workspace-stats.js`) con la rotta `GET /api/additions.workspace-stats`.
Tarball `dist/dsh-additions-0.4.0.tgz`, `A37E7DF6…`; 44 test.

## Stato storico: 0.3.0 (rinomina e /quit)

La 0.3.0 è stata la rinomina `dsh-chatshifter` → `dsh-commander` (abbandonato
perché il nome npm era occupato) → `dsh-additions`, più il comando `/quit`
(SIGINT dopo `delayMs` con watchdog `process.exit(0)` dopo `graceMs`). Tarball
`dist/dsh-additions-0.3.0.tgz`, 8 file, `F65EA301…`; 37 test verdi.

## Stato storico: 0.2.0 (dsh-chatshifter)

`dsh-chatshifter` v0.2.0 è nel profilo `web` come **tarball** (`file:` a
`dist/dsh-chatshifter-0.2.0.tgz`, non più `link:` al checkout) e la sua riga host
è `active`. Il profilo è pulito: rimossi la junction orfana
`dsh-session-mover-probe` e il link rotto `@local/dsh-locale-it`, e la vecchia
cartella del probe nel workspace non esiste più. Il pacchetto è pronto per la
distribuzione: tarball verificato in `dist/`. Commit `8ea2573`, tag `v0.2.0`;
la release **non è ancora pubblicata** (npm/GitHub: vedi [TODO.md](TODO.md)).

Verificato:

```text
host  GET  /api/chatshifter.info → 200 {"ok":true,...,"archiveSource":true}   (cookie owner reale)
client bundle servito: /plugins/??dsh-chatshifter/client.js&rev=<rev> → 200 (contenuto del pacchetto)
test:  28/28 unitari verdi
integrazione con backend JSONL reale: spostamento a freddo + a caldo (fork-derived) riusciti,
         copia riaperta con la stessa storia e lo stesso cut
marker di consegna: la copia di una chat con marker `delivery-accepted` reali si riapre
         (prima falliva con `current-generation delivery marker names the wrong Session`)
i18n: 9 lingue complete contro la baseline `zh` (test di completezza e segnaposto)
profilo: pulito (nessun link orfano in `~/.dsh/profiles/web/node_modules`)
pacchetto: dist/dsh-chatshifter-0.2.0.tgz — 7 file, 22,6 kB, sha256 A77C5F97…
release: commit 8ea2573, tag v0.2.0 (non pubblicata)
```

Verificato anche a video il 12/11: la chat spostata e riparata si apre con la
cronologia, le chat si spostano davvero da un workspace all'altro e la UI del
plugin segue la lingua scelta nelle impostazioni dell'harness.

## Aggiornamento del 24/11 — test su Node 24 e bundle da tarball

Due correzioni emerse usando il plugin su Node 24 / DSH 0.2.1-rc.2:

1. **Comando di test** — `npm test` e il README usavano
   `node --test --test-isolation=none tests/`. Su Node 24 l'argomento posizionale
   non accetta più una directory (`ERR_UNSUPPORTED_DIR_IMPORT`). Ora
   `package.json` usa `node --test --test-isolation=none "tests/*.test.js"`: il
   pattern è espanso da Node (≥ 22.8, da cui esiste `--test-isolation`), quindi
   il comando è identico in PowerShell, cmd e POSIX. Verificato: `npm test` →
   28/28.
2. **Bundle nel profilo** — il profilo `web` aveva `link:I:/src/dsh-chatshifter`,
   cioè un symlink al checkout, non un pacchetto. Ora è installato dal tarball
   (`file:I:/src/dsh-chatshifter/dist/dsh-chatshifter-0.2.0.tgz`): in
   `node_modules/dsh-chatshifter` c'è una copia reale dei 7 file pubblicati.
   Verificato: il modulo host importato dalla copia espone `name`/`inject` e
   `--dump-config` compone la riga `chatshifter` (`archiveSource: true`).
   Prezzo: aggiornare il codice richiede `npm pack` + reinstallazione, e la spec
   `file:` punta al tarball su disco.
3. Una voce nuova (o reinstallata) entra nel grafo solo al **riavvio** di
   `dsh web`: il server legge i bundle del profilo al boot, non a ogni richiesta.

## Cosa è finalizzato

| Milestone | Esito |
|---|---|
| **0.1.0** | Spostamento tra workspace: clonazione del log, attach, archiviazione reversibile, menu contestuale, conferma e report. |
| **0.1.1** | Marker `delivery-accepted` ri-puntati alla copia; copia rotta riparata; tool di riproduzione e riparazione; integrazione con watermark reali. |
| **0.2.0** | UI in 9 lingue (`zh`, `en`, `ja`, `es`, `fr`, `de`, `ru`, `pt`, `it`), `zh` baseline, errori host con `code`/`details`, menu che segue il locale. |
| **Profilo** | Rimossi i due link orfani e la vecchia cartella del probe; profilo `web` pulito, plugin live ancora attivo. |
| **Pacchetto** | `package.json` completo, LICENSE MIT, CHANGELOG, tarball verificato, import del modulo host riuscito, `npm pack` senza file interni. |
| **Verifiche** | 28/28 test unitari, integrazione JSONL reale, smoke test GUI, cambio lingua a video, riparazione di `session-fb1907a8…` con 1321 eventi. |

## Architettura scelta: clonazione del log

Lo spostamento **non** riscrive il log originale (niente cambio di `cwd` a
mano, niente lock di scrittura): crea una **nuova sessione persistita** sotto il
workspace di destinazione con gli stessi eventi e un nuovo id.

1. **Leggi la sorgente** — viva: `ctx.sessions.get(id)` + `snapshotEvents()`
   (la memoria è più fresca del disco); fredda: `ctx.sessionPersistence.open(id,'read')`
   (funziona anche mentre un altro handle possiede la scrittura).
2. **Risolvi la destinazione** — `workspaceRegistry.get(workspaceId)` oppure
   `resolveByPath(path)`/`create(path)` per una cartella scelta.
3. **Scrivi la copia** — `sessionPersistence.create(header, { inheritedEventCount })`
   → `append(events)` → `flush()` (materializza) → `close()`.
   Header: stessa `version`, nuovo `session-<uuid>`, `cwd = workspace.path`,
   `isSeeded`/cut copiati dalla sorgente, `agentPreset` copiato se presente.
4. **Registra** — `Workspace.attachSession(newId)` (valida `realpath(cwd) === workspace.path`).
5. **Nascondi l'originale** — `workspaceRegistry.archiveSession(sourceId, { stopActivity: true })`,
   reversibile con «Ripristina». Config `archiveSource: false` (o `keepOriginal` per
   chiamata) lascia entrambe visibili.

Interfaccia: `POST /api/chatshifter.move` (rotta esatta dietro il fence di
autenticazione della connessione, solo Peer owner) e `GET /api/chatshifter.info`.
Client: contributo `ctx.contextMenus.register({ target: 'session' })` con
sottomento «Sposta nel workspace…», avviso esplicito via `window.confirm`,
`ctx.sessions.refresh()` dopo il successo.

## Scoperte verificate (non ipotesi)

1. **Il primitivo giusto è `ctx.sessionPersistence`, non `ctx.sessions.create`**
   `create(header, {inheritedEventCount})` + `append` + `flush` materializza un
   log sotto `<root>/--<cwd normalizzato>--/<id>/session.v<N>.jsonl.zstd`.
   `ctx.sessions.create` da solo non persiste nulla (confermava il POC).
2. **Regola di formato: un log con marcatore `session/end-seed` deve restare `isSeeded`**
   `dsh-session-format-v3-to-v4` rifiuta in lettura un header unseeded che
   contiene il marcatore (`format v4 unseeded Session contains an inherited end-seed marker`).
   Quindi la copia deve propagare `isSeeded` e `inheritedEventCount` della
   sorgente; un header unseeded con marcatore produce una chat "spostata" ma
   illeggibile. È il bug più insidioso incontrato (l'integrazione col backend
   reale lo ha preso; i test con mock no).
3. **`attachSession` rilegge l'header dalla persistenza** (cache per id, poi
   `listStoredHeaders`) e pretende `realpath(header.cwd) === workspace.path` e
   directory esistente. Usare `workspace.path` (canonico) come `cwd` della copia.
4. **Le rotte esatte si registrano con `ctx.connection.fetch.register({path,
   methods, requestBody:'buffered', fetch})`**, dentro `ctx.effect` per la
   durata del plugin; sono autenticate dal carrier e rispondono solo al Peer
   owner.
5. **Un bundle browser si scrive a mano senza build**
   `window.__ModuleLoader__.load({ id, factory })`; la factory è CJS
   (`require`, `module.exports`) e il modulo esporta `apply`/`inject` per Cordis.
   I moduli di piattaforma disponibili: `react`, `react/jsx-runtime`, `react-dom`,
   `react-dom/client`, `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`,
   `@deepseek-ai/dsh-client-store`, `dsh-client-ui-slots`, `-primitives`,
   `-dockkit`. Servono `package.json` `dsh.client = { platform: 'web' }` e
   l'export `"./client"`.
6. **Il bundle è servito revisionato**: `/plugins/??<id>/client.js&rev=<rev>`,
   con `rev` = sha1 a 12 hex di `plugin-artifact` su `String(mtimeMs)`,
   `String(ctimeMs)`, `String(size)` (float, non troncati). Una `rev` vecchia dà
   404. La revisione si rilegge solo al riavvio della voce Loader: dopo aver
   modificato `lib/client.js` serve disabilitare/riabilitare la voce (o
   riavviare DSH); il solo reload della pagina no.
7. **Servizi client utili e stabili**: `ctx.contextMenus` (contributi
   strutturati con `children` = sottomento), `ctx.workspaces.list.getSnapshot()`
   (`{ items: WorkspaceView[], phase }`), `ctx.sessions.refresh()`,
   `ctx.remote.directoryPicker.pick()`. Non serve importare pacchetti.
8. **Ordine del menu sessione** (ui-workspace): pin 100, rename 200, fork 300,
   id 450 (con separatore), archive 600. La nostra voce è a 400.
9. **`node --test` sotto sandbox DSH fallisce** (`spawn EPERM`: i child process
   non possono aprire pipe). Usare `npm test`, cioè
   `node --test --test-isolation=none "tests/*.test.js"`. Il pattern è espanso
   da Node (≥ 22.8, dove esiste `--test-isolation`), non dalla shell; passare la
   cartella (`tests/`) funzionava fino a Node 22 ma su Node 24 dà
   `ERR_UNSUPPORTED_DIR_IMPORT`, perché l'argomento posizionale non accetta più
   directory.
10. **`mtimeMs`/`ctimeMs` / `size` del file client**: la revisione cambia anche
    solo toccando il file; nessun hash del contenuto.
11. **I marker `session-log-deepseek/delivery-accepted` appartengono alla sessione**
    Il formato rifiuta in lettura un marker della generazione corrente il cui
    `data.sessionId` non è l'id dell'header: `current-generation delivery marker
    names the wrong Session`. La copia deve quindi ri-puntare alla nuova identità
    i marker con `seq >= inheritedEventCount`; quelli dentro il prefisso ereditato
    di un fork restano intestati all'antenato (eccezione prevista dal formato).
    Il primo spostamento reale creava una copia illeggibile: 170 marker su 1321
    eventi nominavano ancora la sorgente. Il watermark `throughSeq` non cambia.
12. **Il locale client: `zh` è la baseline, `en` è obbligatorio**
    `ctx.locale.register(ns, {zh, en, ja, es, fr, de, ru, pt})` (o la forma
    per-lingua `register(ns, 'it', dict)`) registra dizionari piatti chiave →
    testo con segnaposto `{name}`; il lookup segue catena di fallback, poi
    `common`, poi mostra la chiave. Le chiavi sono identificatori stabili (non
    testo cinese: verificato nei bundle installati), ma il key set di riferimento
    è il dizionario cinese: le lingue spedite sono tipizzate contro `zh` e
    devono essere complete. `en` è richiesto e funge da fallback.
    `it` non è built-in: il dizionario si può registrare sempre, ma la lingua
    diventa selezionabile solo se un language pack chiama `addLanguage({id:'it'})`
    (`dsh-locale-it` nel profilo `web`); il plugin non deve rivendicarla per non
    collidere con il pack. `t(key, params)` interpola i segnaposto.
13. **`MenuItemButton` parla `onSelect`, non `onClick`** (verificato il 25/11
    sulle righe di `dsh-client-ui-workspace`: `onSelect: () => {
    setMenuOpen(false); … }`). Una riga di menu agganciata a `onClick` viene
    renderizzata normalmente, con `t` e le props iniettate al loro posto, ma il
    gestore non viene **mai** invocato: nessun errore in console, il menu resta
    aperto, il click sembra morto. È il bug della 0.4.0/0.5.0, corretto in 0.5.1
    con due test di regressione che fissano il contratto del primitivo. Nota:
    `Button` usa invece `onClick`; `Modal` usa `open`/`onClose`/`children`.
14. **Una tab del pannello destro esiste solo se dichiara una voce `guide`**
    Il `+` del dock apre la tab *guida* (`GUIDE_KIND`), e la guida elenca i
    `definition.guide` di ogni tipo registrato: un tipo senza voci `guide` è
    registrato ma **irraggiungibile** dalla UI, e va aperto da `openTab(kind)`
    (come fa `ui-schedule` dal suo header). La definition è
    `{ id, kind, priority, title, guide: [{ id, order, title, description, icon? }] }`,
    con `icon` opzionale (la guida ripiega su `CubeGlyph`). Il corpo si registra
    nello slot `sidebar.right.pane.tab` con `key = definition.id` (non `kind`), e
    il chip in `sidebar.right.pane.tab.title` con la stessa `key`.

## Correzione del 12/11 — marker di consegna

Il primo test in GUI ha spostato davvero una chat (sorgente
`session-72962ad1…`, da `dsh-chatshifter` a `default-workspace`) e la GUI non è
riuscita a caricarne la cronologia:

```text
stored session "session-fb1907a8…" is corrupt: …
SessionFormatError: current-generation delivery marker names the wrong Session
```

Causa: il clone copiava gli eventi alla lettera, compresi i 170 watermark
`session-log-deepseek/delivery-accepted` che nominavano la sorgente. Il formato
v4 accetta un marker "straniero" solo dentro il prefisso ereditato di un fork
(`seq < inheritedEventCount`); in una sessione non-seeded ogni marker deve
nominare l'header.

Correzione (v0.1.1):

- `reidentifyDeliveryMarkers(events, sessionId, inheritedEventCount)` in
  `lib/index.js`: copia il marker solo quando cambia, azzera `data.sessionId`
  alla nuova identità e lascia intatti gli eventi normali e il prefisso ereditato;
- `writeClone` appende il risultato invece degli eventi grezzi;
- test: 2 nuovi casi (marker proprio ri-puntato senza mutare la sorgente; marker
  ereditato che resta all'antenato) e l'integrazione ora sceglie una sessione
  reale **con** watermark e verifica che la copia li possieda;
- `scripts/repair-delivery.mjs <sessionId> [--apply]`: ripara in place una copia
  già corrotta, riscrivendo il log con il backend JSONL ufficiale (dry-run di
  default). La copia rotta `session-fb1907a8…` è stata riparata con questo
  strumento: 1321 eventi, 170 marker ri-puntati, riaperti con un contesto
  fresco. Nel profilo live la voce host è stata disabilitata e riabilitata per
  ricaricare il codice 0.1.1.

Riproduzione: `scripts/repro-delivery.mjs` sposta una sessione reale con marker e
riapre la copia; prima della correzione fallisce con lo stesso `SessionFormatError`.

## Cosa viaggia e cosa no

| Viaggia | Non viaggia |
|---|---|
| storia completa, allegati (riferimenti per hash) | identità: nuovo id `session-<uuid>` |
| titolo (`session/title` è nel log) | `AGENTS.md`, `.dsh/skills`, file di progetto |
| preset agente registrato | sotto-sessioni, subagenti, job in background |
| marcatura fork (`isSeeded` + cut) | permessi/impostazioni locali della cartella |

## Internazionalizzazione (v0.2.0)

- namespace `chatshifter`, dizionari dentro `lib/client.js`, 9 lingue: `zh`,
  `en`, `ja`, `es`, `fr`, `de`, `ru`, `pt`, `it`.
- `zh` è la baseline e `en` il fallback, come nel locale di DSH; il test
  `every locale is complete against the Chinese baseline` verifica chiavi,
  segnaposto e assenza di ZWSP/BOM.
- I messaggi host non sono più in italiano: ogni rifiuto espone `code` stabile,
  `message` inglese e `details` con i valori dei segnaposto. Il client traduce
  il codice; un codice sconosciuto ricade sul `message`.
- La voce di menu e i testi seguono il locale attivo; il menu si ricostruisce
  grazie a `observe` su `ctx.locale`.
- `it` diventa selezionabile solo se un language pack registra la lingua
  (`dsh-locale-it` nel profilo `web`): il plugin registra solo il dizionario per
  non collidere con il pack.
- Verificato a video il 12/11: cambiando lingua dall'harness, menu, conferma ed
  esito del plugin seguono il locale attivo.

## Distribuzione (v0.2.0)

- `package.json` completo: autore, repository/homepage/bugs, `engines.node >=20`,
  `publishConfig.access: public`, `files` whitelist, export `./cordis.patch.yml`
  e `dsh.client.inject` del locale.
- `LICENSE` MIT e `CHANGELOG.md` (0.1.0 → 0.1.1 → 0.2.0).
- `dist/dsh-additions-0.3.0.tgz`: 8 file (lib/index.js, lib/client.js,
  lib/quit.js, cordis.patch.yml, README, LICENSE, CHANGELOG, package.json),
  26,6 kB, SHA-256
  `F65EA301AB5F97E1E48EA9D557729B3B3B87FFE3F71BA9B94D033B8398E3D337`.
- `dist/dsh-chatshifter-0.2.0.tgz`: il tarball storico del nome precedente
  (22,6 kB, `A77C5F97…`), non più installato nel profilo.
- Il nome npm `dsh-commander` è **occupato** da un plugin di un altro autore
  (`yusi5587`, versioni 0.1.0–0.1.4, pubblicate ad agosto): per questo il progetto
  è passato a `dsh-additions`, che risulta **libero** (404 sul registry,
  verificato il 24/11). Attenzione solo all'accostamento con `dsh-toy` (nome
  riservato su npm e plugin `c3ll256/dsh-toy` con ~80 stelle): non usare
  `dsh-toys`. `dsh-chatshifter` risultava pure libero. Il repo GitHub è privato,
  quindi l'installazione `github:` richiede credenziali o la pubblicazione del
  repo.
- Canali pronti ma **non pubblicati**: tarball (`dsh plugin add <file>.tgz`),
  npm (`npm publish`), GitHub (`dsh plugin add github:kormoran/dsh-additions`).
  Il repository è stato rinominato in `dsh-additions` il 26/11 (redirect attivo
  dal vecchio nome); il remote locale è già `github.com/kormoran/dsh-additions`.
  La scelta del canale e la pubblicazione sono in [TODO.md](TODO.md).

## File del progetto

| Percorso | Ruolo |
|---|---|
| `lib/index.js` | host: comando `/quit` registrato, lettura sorgente, clone persistito, attach, archive, rotte `/api/additions.*` (move, info, workspace-stats, sound) |
| `lib/quit.js` | host: `/quit`, scheduler dello spegnimento (interrupt + watchdog), config `quit` |
| `lib/sounds.js` | host: risoluzione dei due cue (asset impacchettati o percorso configurato), tipi MIME e rotta `SOUND_PATH` |
| `lib/workspace-stats.js` | host: scansione di un workspace (byte, directory, file, righe codice/doc), limiti e rotta `STATS_PATH` |
| `assets/ding.wav`, `assets/uh-oh.wav` | i due suoni predefiniti, sintetizzati (16-bit mono 22 kHz) |
| `lib/client.js` | browser: bundle a mano su `ctx.slots` — voce «Sposta nel workspace…», dialog, tab «Workspace», watcher dei segnali sonori (namespace `additions`) |
| `cordis.patch.yml` | riga `insert` del bundle nel profilo (config `archiveSource`, `quit`, `stats`, `sounds`) |
| `package.json` | bundle + `dsh.client` + export `./client` |
| `tests/host.test.js` | 15 test host con persistenza/registry finti |
| `tests/quit.test.js` | 9 test del comando: config, ordine interrupt/watchdog, idempotenza, annullamento, argomenti rifiutati |
| `tests/sounds.test.js` | 7 test dei segnali: config, validità dei WAV (header), file sostituito, fallback, rotta e info |
| `tests/stats.test.js` | 9 test delle statistiche: fixture su disco, CRLF/binari, budget, risoluzione target, rotta e cache |
| `tests/client.test.js` | 19 test del bundle browser (vm, `window.__ModuleLoader__`): registrazioni slot, controller, transizioni dei segnali, player audio, dizionari |
| `scripts/make-sounds.mjs` | rigenera i due WAV (sintesi a partiali, nessun campione di terzi) |
| `scripts/integration.mjs` | integrazione con `SessionStore` + backend JSONL reali: legge una sessione vera in sola lettura (preferendo una con watermark), sposta a freddo e a caldo, riapre la copia |
| `scripts/repro-delivery.mjs` | riproduce il guasto dei marker di consegna su una sessione reale (diagnostica) |
| `scripts/repair-delivery.mjs` | ripara una copia già corrotta ri-puntando i marker, con dry-run e `--apply` |
| `LICENSE` | licenza MIT |
| `CHANGELOG.md` | cronologia 0.1.0 → 0.1.1 → 0.2.0 → 0.3.0 → 0.4.0 → 0.5.0 |
| `dist/dsh-additions-<version>.tgz` | tarball generato da `npm pack`, non versionato |
| `probe-report.json` | reperto storico del POC (non più usato) |
| `TODO.md` | backlog operativo per la 1.0.0 |
| `PROJECT_STATE.md` | questo file |

## Come riprendere

```powershell
# test (sempre con isolation none sotto sandbox DSH)
npm test

# integrazione con il backend reale (percorso pacchetti opzionale)
node scripts/integration.mjs

# packaging per la distribuzione
npm test
npm pack --pack-destination dist

# stato del profilo
dsh plugin --profile web why dsh-additions
# oppure, dall'agente: plugin_manager list_plugins / list_bundles
```

Per aggiornare il plugin nel profilo live: una voce **nuova** entra nel grafo
solo al riavvio di DSH (il server legge i bundle del profilo al boot). Il tipo
di installazione decide il resto: con il tarball serve rifare `npm pack` e
reinstallare; con `link:` il codice del checkout è già nel profilo, ma la voce
va comunque riavviata (toggle dalla pagina Plugin o riavvio DSH); per il client
vedi la scoperta 6.

Si riparte da [TODO.md](TODO.md), dai P0.

## Prossimi passi

La 0.5.3 è installata e le superfici sono state verificate a video il 25/11. In
ordine:

1. **`/quit` a video**: è l'unica cosa non ancora provata (interrompe il server,
   va fatto quando la sessione non serve);
2. **pubblicare**: decidere il canale — npm con il nome `dsh-additions` (libero)
   e/o il repository GitHub, oggi privato; poi lo smoke test in un profilo pulito;
3. riprendere il backlog P0 di [TODO.md](TODO.md): validazione della copia prima
   dell'archiviazione, gestione delle chat in esecuzione, idempotenza.
