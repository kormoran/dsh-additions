# PROJECT_STATE — dsh-chatshifter

Memoria permanente del progetto. Aggiornato: **2026-11-12**, sessione con cwd
`C:\Users\m.soricetti\Documents\GitHub\dsh-chatshifter`.

## Obiettivo

Un plugin per DeepSeek Harness che **sposti una chat in un altro workspace**,
portandosi dietro contesto e memorie — o, equivalentemente, assegni un nuovo
workspace a una chat esistente.

## Stato: plugin vero sviluppato, installato e attivo

`dsh-chatshifter` v0.1.1 è nel profilo `web` (bundle `link:` a questo repo) e la
sua riga host è `active`. Il vecchio probe `dsh-session-mover-probe` è stato
rimosso dal profilo (resta una junction orfana in
`~/.dsh/profiles/web/node_modules/`, non più referenziata da `package.json`).

Verificato:

```text
host  GET  /api/chatshifter.info → 200 {"ok":true,...,"archiveSource":true}   (cookie owner reale)
client bundle servito: /plugins/??dsh-chatshifter/client.js&rev=<rev> → 200 (contenuto del repo)
test:  23/23 unitari verdi
integrazione con backend JSONL reale: spostamento a freddo + a caldo (fork-derived) riusciti,
         copia riaperta con la stessa storia e lo stesso cut
marker di consegna: la copia di una chat con marker `delivery-accepted` reali si riapre
         (prima falliva con `current-generation delivery marker names the wrong Session`)
```

Verificato anche a video il 12/11: la chat spostata e riparata si apre con la
cronologia, e le chat si spostano davvero da un workspace all'altro.

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
   non possono aprire pipe). Usare `node --test --test-isolation=none tests/`.
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

## File del progetto

| Percorso | Ruolo |
|---|---|
| `lib/index.js` | host: lettura sorgente, clone persistito, attach, archive, rotte `/api/chatshifter.*` |
| `lib/client.js` | browser: bundle a mano, contributo menu sessione, conferma, esito |
| `cordis.patch.yml` | riga `insert` del bundle nel profilo (config `archiveSource`) |
| `package.json` | bundle + `dsh.client` + export `./client` |
| `tests/host.test.js` | 14 test host con persistenza/registry finti |
| `tests/client.test.js` | 9 test del bundle browser (vm, `window.__ModuleLoader__`) |
| `scripts/integration.mjs` | integrazione con `SessionStore` + backend JSONL reali: legge una sessione vera in sola lettura (preferendo una con watermark), sposta a freddo e a caldo, riapre la copia |
| `scripts/repro-delivery.mjs` | riproduce il guasto dei marker di consegna su una sessione reale (diagnostica) |
| `scripts/repair-delivery.mjs` | ripara una copia già corrotta ri-puntando i marker, con dry-run e `--apply` |
| `probe-report.json` | reperto storico del POC (non più usato) |
| `PROJECT_STATE.md` | questo file |

## Come riprendere

```powershell
# test (sempre con isolation none sotto sandbox DSH)
node --test --test-isolation=none tests/

# integrazione con il backend reale (percorso pacchetti opzionale)
node scripts/integration.mjs

# stato del profilo
dsh plugin --profile web why dsh-chatshifter
# oppure, dall'agente: plugin_manager list_plugins / list_bundles
```

Per aggiornare il plugin nel profilo live: il bundle è `link:`, quindi le
modifiche a `lib/index.js` richiedono il riavvio della voce (toggle dalla
pagina Plugin o riavvio DSH); per il client vedi la scoperta 6.

## Problemi aperti / prossimi passi

Il primo smoke test in GUI è passato (12/11): la voce compare nel menu, la
conferma sposta la chat, la riga compare nel workspace di destinazione e
l'originale viene archiviato. Restano, in ordine di utilità:

1. **Selezione della chat corrente** — archiviando l'originale lato host, il
   client non azzera la selezione come fa l'azione Archive nativa; la chat
   resta a video finché non si naviga. Valutare se chiudere la vista lato client.
2. **Chat fork-derived** — una copia di una sessione già forkata resta
   `isSeeded`: il provider di titolo automatico esclude le sessioni seed, quindi
   se la sorgente non aveva ancora un evento `session/title` la copia può
   restare senza titolo. Se fastidioso: generare un titolo al momento della
   copia (append di `session/title` con il primo messaggio) oppure riscrivere il
   log rimuovendo il marcatore (rinumerando le seq: rischioso).
3. **Doppio spostamento della stessa copia** — funziona, ma allunga la catena di
   marker; nessun problema noto.
4. **Pulizia** — la junction orfana `dsh-session-mover-probe` nel profilo può
   essere eliminata a mano; la cartella del probe nel vecchio workspace
   (`Documents\deepseek-harness\default-workspace\packages\`) non serve più.
5. **Distribuzione** — il repo è privato e installato via `link:`; per
   distribuirlo come bundle GitHub basta pushare e usare
   `plugin_manager install_bundle` con l'URL del repo (il `package.json` è già
   pronto: bundle patch + client).
