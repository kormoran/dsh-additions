# TODO — verso la 1.0.0

Backlog operativo per la 1.0.0 di `dsh-additions` (ex `dsh-chatshifter`).

Punto di partenza: **0.2.0** (commit `8ea2573`, tag `v0.2.0`, 28/28 test,
tarball in `dist/`). Obiettivo: release stabile, sicura e distribuibile.
Aggiornato: **2026-11-12**; si riparte il **13/11**.

Strategia consigliata: chiudere i P0, pubblicare `1.0.0-rc.1`, fare il smoke
test in un profilo pulito, poi promuovere a `1.0.0` (o direttamente 1.0 se il
tempo basta).

## P0 — bloccanti (dati e compatibilità)

- [x] **Metà browser sull'API client corrente**
  - [x] DSH 0.2.1-rc.2 non espone `ctx.contextMenus`: la voce di spostamento è
        ora registrata in `sidebar.workspaces.session.menu.item` con
        `ctx.slots.inject`/`ctx.slots.register` e il flusso è un dialog in
        `shell.overlay` (0.4.0, 11 test del bundle).
  - [x] **Pannello destro «Workspace»**: tab registrata su
        `ctx.sidebarRightTabs.register({id, kind, priority, title, guide})` con
        corpo in `sidebar.right.pane.tab` e chip in `sidebar.right.pane.tab.title`;
        consuma `GET /api/additions.workspace-stats` (0.5.0–0.5.2).
  - [x] Verifica a video (25/11, DSH 0.2.1-rc.2): voce «Sposta nel workspace…»
        funzionante, chat spostata davvero, `+` → guida → capsula «Workspace» →
        lista → «Dettagli» con le statistiche. Due trappole trovate e corrette:
        `MenuItemButton` vuole `onSelect` (0.5.1) e una tab senza voce `guide` è
        invisibile (0.5.2).
  - [ ] `/quit` ancora non provato a video (interrompe il server, va fatto
        quando non serve la sessione).

- [ ] **Segnali sonori (0.6.0 → 0.7.0)**
  - [ ] Verifica a video: `ding` alla fine di un turno e «uh oh» su una richiesta
        di permesso; controllare che il primo segnale dopo il caricamento della
        pagina possa restare muto (autoplay) e che dal secondo in poi suoni.
  - [x] Sostituzione dei file: percorsi configurabili (`sounds.ding`,
        `sounds.approval`), lettura a ogni riproduzione, fallback all'asset con
        header `x-additions-sound-source`. Verificato via RPC autenticata il
        27/11 (scrittura `settings/mutate` → rotta con il nuovo file → unset).
  - [ ] **Pagina di configurazione (0.7.0)**: namespace `additions` con casella
        «attiva i suoni» e due caselle di testo, registrata in
        `plugins.row.config`. Logica coperta da 26 test del bundle e schema
        verificato via `settings/describe`; manca la prova a video
        (apertura dalla pagina Plugins, Salva, cambio file a pagina aperta).
  - [ ] Valutare `sounds.onlyActive: true` (oggi suona anche per i subagenti, che
        possono moltiplicare i ding durante workflow) e un breve debounce tra due
        ding ravvicinati.

- [ ] **`/rename` (0.8.0)**
  - [x] Comando registrato (`commands/list` lo elenca con `dsh-additions:rename`),
        parsing del titolo e percorso di sola lettura (`/rename` senza argomento)
        verificati via RPC autenticata.
  - [ ] Prova a video del rename effettivo: `/rename Nuovo titolo` deve cambiare
        la riga in sidebar e il titolo deve restare dopo un riavvio.
  - [ ] Valutare se aggiungere anche un comando per *leggere* il titolo corrente
        (oggi lo mostra solo l'uso senza argomento).

- [ ] **`/quit` — comportamento con lavoro in corso**
  - [x] Scelta: **interrompe** (deciso 27/11). Il comando deve funzionare sempre;
        il log resta rileggibile al resume e il README lo documenta.
  - [ ] Verifica a video del comando dopo il riavvio di `dsh web`.

- [x] **Rinomina del repository**
  - [x] Repository GitHub rinominato `kormoran/dsh-chatshifter` →
        `kormoran/dsh-additions` (26/11), remote locale aggiornato e
        `package.json`/README allineati in 0.5.3. La cartella locale resta
        `I:\src\dsh-chatshifter` (ci puntano il workspace DSH e la spec `file:`
        del profilo).
  - [x] Nome npm: `dsh-additions` è libero (404 sul registry, 24/11); scartati
        `dsh-commander` (occupato da `yusi5587`) e `dsh-toys` (troppo vicino a
        `dsh-toy`, plugin esistente).

- [x] **Validare la copia prima di archiviare l'originale** (0.9.0)
  - [x] Dopo `writeClone`, riaprire la nuova sessione in sola lettura e leggere tutti gli eventi.
  - [x] Confrontare lunghezza, seq dense, tipi, timestamp, `isSeeded`/cut e marker `delivery-accepted` con la copia scritta.
  - [x] Se la verifica fallisce: `clone-invalid`, nessuna `archiveSession`, cleanup best-effort (solo percorsi assoluti).
  - [x] Test: evento mancante → la copia non viene registrata né l'originale archiviato; integrazione reale su 1.322 eventi.

- [x] **Chat in esecuzione / job attivi** (0.9.0)
  - [x] Scelta: **rifiutare** (`source-busy`, 409) senza toccare nulla.
  - [x] Host: waterfall `workspace/session-activity` (turno, subagenti, job, promemoria) prima della copia.
  - [x] Client: preflight `GET /api/additions.preflight` all'apertura del dialog, motivo localizzato; la riga di menu resta sempre visibile (motivo mostrato nel dialog).
  - [x] Test: sorgente con turno e con job registrato; preflight per subagente/vuota/inesistente.

- [x] **Fallimenti parziali, retry e idempotenza** (0.9.0)
  - [x] `attachSession` fallito: cleanup best-effort della copia + `attach-failed` con id e motivo.
  - [x] Lock per sessione sorgente (`move-in-progress`).
  - [x] Idempotenza per `requestId` (stesso id → stessa copia; i fallimenti si possono ritentare).
  - [x] Test: attach fallito, doppia richiesta concorrente, replay del requestId.

- [x] **Audit completo delle identità nel log copiato** (0.9.0)
  - [x] `job/registered`/`job/settled`: **esentati** — il contratto del formato dice che la storia copiata non trasferisce l'esecuzione; `owner` resta la sorgente.
  - [x] `subagent/catalog`: nomina le sessioni figlie, esentato; il resto del log è testo o riferimenti altrui.
  - [x] Test con delivery marker, job, catalog e testo che cita l'id: solo il marker viene ri-puntato. Audit su log reali: solo delivery (`sessionId`) e job (`owner`).

- [ ] **Path, id e formati multipiattaforma** (0.9.0, parziale)
  - [x] Confronto directory consapevole della piattaforma (`pathsEqual`: case-insensitive su Windows/macOS).
  - [x] `realpath`/`stat` già usati per symlink e path non risolvibili (canonicalizzazione con fallback).
  - [x] Id sessione validato (niente spazi, caratteri di controllo o separatori di percorso).
  - [x] Header senza versione di formato valida → `unsupported-format`; i log v0–v3 sono tradotti in memoria dal backend e la copia nasce nella versione logica corrente.
  - [ ] Test su Windows, Linux e macOS (serve CI).

- [x] **Contratto di compatibilità DSH** (0.9.0)
  - [x] `engines.dsh` = `>=0.2.2-rc.1 <0.3.0-0`.
  - [x] API host/client elencate nel README (sezione «Compatibilità»).
  - [x] Matrice testata: DSH 0.2.2-rc.1 su Windows; una versione successiva resta da provare.

- [ ] **Bug UX noti**
  - [ ] Archiviando la chat aperta, il client deve deselezionarla/chiudere la vista come fa Archive nativo: non esiste un'API pubblica per la selezione corrente, documentato nei limiti.
  - [ ] Titolo garantito anche per le copie fork-derived senza `session/title`: documentato con la workaround `/rename` (il servizio titoli esclude le sessioni seed e la copia non è viva).
  - [x] Chat non spostabili: motivo localizzato nel dialog tramite preflight (la riga di menu non può essere disabilitata senza una chiamata al host al render).

## P1 — qualità e test

- [x] **Ambiente: store pnpm del profilo disallineato** (27/11, risolto).
      Causa: due pnpm in PATH — il profilo era installato con la 10.34.9
      (store `v10`), ma `%LOCALAPPDATA%\pnpm\bin` (12.23, store `v11`) veniva
      prima della copia npm-global 10.34.9. Ogni add/remove falliva con
      `ERR_PNPM_UNEXPECTED_STORE`. Rimedio applicato: `pnpm install` nel
      profilo (lockfile v9 e versioni invariati), verifica con
      `--frozen-lockfile` e con una `remove` reale su una copia.
  - [x] **Pulizia macchina**: `npm rm -g pnpm` eseguito dall'utente il 27/11;
        resta un solo pnpm (12.23.0, store v11).
  - [x] **Profilo allineato**: alias `dsh-chatshifter` rimosso e bundle
        reinstallato come `dsh-additions@0.7.0` dal tarball
        `file:…/dist/dsh-additions-0.7.0.tgz`; riga `additions` active,
        namespace `additions` servito, bundle client servito dalla copia
        installata.
  - [ ] Nota per il futuro: a ogni major di pnpm (store `vN` → `vN+1`) serve un
        `pnpm install` nel profilo, altrimenti `plugin_manager add/remove` si
        blocca di nuovo.

- [ ] **CI** su `windows-latest`, `ubuntu-latest`, `macos-latest`; Node 20 e 22.
- [ ] Test ermetici (fixture, non sessioni reali dell'utente) + integrazione JSONL con root temporanea.
- [ ] Test aggiuntivi: allegati/immagini, chat molto lunga (≥10k eventi), doppio spostamento, route non autorizzata (401/403), cambio lingua.
- [ ] Installazione da tarball in un **profilo DSH pulito** e verifica della voce in GUI; test di upgrade e uninstall.
- [ ] Controllo del contenuto di `npm pack` in CI (niente test/script/file interni).
- [ ] README in inglese (o bilingue) con limiti, snapshot, file condivisi, allegati, subagenti, compatibilità.
- [ ] Revisione madrelingua delle 9 traduzioni e gestione dei plurali per le stringhe con conteggi.

## P1 — release

- [ ] Scegliere il canale: `npm publish` (nome libero) e/o repo GitHub pubblico. Il repo oggi è privato.
- [ ] Pubblicare `1.0.0-rc.1`, aggiornare CHANGELOG e note di rilascio.
- [ ] Installare l'artefatto pubblicato in un profilo pulito e rifare lo smoke test completo.
- [ ] Smoke test finale: spostamento chat ferma, rifiuto chat in esecuzione, copia fork-derived, errore localizzato, cambio lingua.
- [ ] Push di `main` e del tag; allegare il tarball alla release GitHub.
- [ ] Promuovere a `1.0.0` dopo il periodo di prova.

## Decisioni da prendere domani

1. Chat in esecuzione: **rifiutare** o **quiescere**? (Consiglio: rifiutare per la 1.0, quiescere in 1.x.)
2. Job owner e subagent catalog: **riscrivere** gli id o **esentare** con motivazione?
3. Canale di release: **npm**, **GitHub pubblico**, o entrambi?
4. Release: **1.0.0-rc.1** subito o **1.0.0** diretto?
5. Range DSH supportato: solo `0.2.x` o anche la prossima?

## Criterio di uscita

- [ ] Nessun caso noto di perdita/incoerenza dati.
- [ ] Copia validata prima dell'archiviazione e cleanup sui fallimenti.
- [ ] Chat in esecuzione gestita con un comportamento documentato.
- [ ] Audit identità verde.
- [ ] Test verdi su tre OS e Node 20/22.
- [ ] Installazione da artefatto pubblicato in un profilo pulito.
- [ ] README, CHANGELOG, compatibilità e tag allineati.

## Fuori scope per la 1.0

- Merge o fork di conversazioni (il plugin sposta, non fonde).
- Isolamento dei file del workspace (worktree/git): resta una scelta dell'utente.
- Nuove lingue oltre le nove attuali.
- Migrazione automatica di log di formati non supportati.
