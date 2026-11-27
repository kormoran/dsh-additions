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

- [ ] **`/quit` — comportamento con lavoro in corso**
  - [ ] Decidere se rifiutare quando un turno è aperto o job sono attivi, o
        documentare che li interrompe (oggi: li interrompe, il log resta
        rileggibile al resume).
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

- [ ] **Validare la copia prima di archiviare l'originale**
  - [ ] Dopo `writeClone`, riaprire la nuova sessione in sola lettura e leggere tutti gli eventi.
  - [ ] Confrontare lunghezza, seq dense, tipi, `isSeeded`/cut e marker `delivery-accepted` con la sorgente.
  - [ ] Se la verifica fallisce: non chiamare `archiveSession`, restituire un errore dedicato e fare cleanup della copia.
  - [ ] Test: copia con marker sbagliato, evento mancante, log illeggibile → l'originale non viene archiviato.

- [ ] **Chat in esecuzione / job attivi**
  - [ ] Decidere il comportamento: rifiutare (`source-busy`) oppure fermare la sorgente e aspettare la quiescenza prima dello snapshot.
  - [ ] Host: rilevare turno in corso e job attivi; non archiviare in caso di rifiuto.
  - [ ] Client: voce disabilitata con motivo localizzato.
  - [ ] Test: sorgente viva con turno aperto e con job registrato non concluso.

- [ ] **Fallimenti parziali, retry e idempotenza**
  - [ ] Se `attachSession` fallisce, cleanup best-effort della copia (o report esplicito di orfano).
  - [ ] Lock per sessione sorgente: due richieste concorrenti non devono creare due copie.
  - [ ] Idempotenza per `requestId` (stesso input → stessa copia) o risposta che indichi il duplicato.
  - [ ] Test: attach fallito, doppio click, retry dopo timeout.

- [ ] **Audit completo delle identità nel log copiato**
  - [ ] Decidere per `job/registered` e `job/settled` con `owner` della sorgente: riscrivere o esentare documentando.
  - [ ] Verificare `subagent/catalog` e ogni altro campo che contiene un id di sessione.
  - [ ] Test generico: nessun id della sorgente negli eventi della copia fuori dal prefisso ereditato (salvo esenzioni motivate).

- [ ] **Path, id e formati multipiattaforma**
  - [ ] `isSameDirectory`: confronto consapevole della piattaforma (case-sensitive su Linux) o identità del file.
  - [ ] `realpath`/`stat` per symlink e path non risolvibili.
  - [ ] Validare l'id sessione (niente separatori di path, formato atteso) prima di usarlo.
  - [ ] Sessioni v0–v3: testare il clone o rifiutare con errore chiaro; non scrivere header incoerenti.
  - [ ] Test su Windows, Linux e macOS.

- [ ] **Contratto di compatibilità DSH**
  - [ ] Dichiarare `engines.dsh` (es. `>=0.2.2-rc.1 <0.3.0`) e le eventuali peer dependency.
  - [ ] Elencare le API interne usate (`contextMenus`, `workspaces.list`, `sessions.refresh`, `workspaceRegistry`, `sessionPersistence`, `locale`).
  - [ ] Matrice testata: versione DSH corrente + una successiva; documentare cosa può rompersi.

- [ ] **Bug UX noti**
  - [ ] Archiviando la chat aperta, il client deve deselezionarla/chiudere la vista come fa Archive nativo.
  - [ ] Titolo garantito anche per le copie fork-derived senza `session/title` (fallback dal primo messaggio).
  - [ ] Voce disabilitata per chat vuote, subagenti e chat in esecuzione.

## P1 — qualità e test

- [ ] **Ambiente: store pnpm del profilo disallineato** (27/11). `node_modules`
      del profilo `web` è legato allo store pnpm `v10`, ma il `pnpm` in PATH è
      12.23 e vuole `v11`: ogni operazione di pacchetto fallisce con
      `ERR_PNPM_UNEXPECTED_STORE` (rimozione/installazione bundle comprese). Va
      eseguito `pnpm install` nel profilo per migrare, poi si può reinstallare il
      tarball e rinominare la dipendenza `dsh-chatshifter` → `dsh-additions`.
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
