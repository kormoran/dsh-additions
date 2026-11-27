# TODO

Backlog operativo per `dsh-additions`.


## P0 — bloccanti (dati e compatibilità)

- [x] **Metà browser sull'API client corrente**
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
  - [x] Scelta: **interrompe** (deciso 27/11). Il comando deve funzionare sempre;
        il log resta rileggibile al resume e il README lo documenta.
  - [ ] Verifica a video del comando dopo il riavvio di `dsh web`.


- [ ] **Path, id e formati multipiattaforma** (0.9.0, parziale)
  - [ ] Test su Windows, Linux e macOS (serve CI).


- [ ] **Bug UX noti**
  - [ ] Archiviando la chat aperta, il client deve deselezionarla/chiudere la vista come fa Archive nativo: non esiste un'API pubblica per la selezione corrente, documentato nei limiti.
  - [ ] Titolo garantito anche per le copie fork-derived senza `session/title`: documentato con la workaround `/rename` (il servizio titoli esclude le sessioni seed e la copia non è viva).
  - [x] Chat non spostabili: motivo localizzato nel dialog tramite preflight (la riga di menu non può essere disabilitata senza una chiamata al host al render).

## P1 — qualità e test

- [x] **Localizzazione completa (0.10.0)**: metadati del plugin in
      `locale/<id>.json` per zh, en, ja, es, fr, de, ru, pt e it (titolo e
      descrizione), ogni codice d'errore delle rotte mappato su una frase
      localizzata, correzioni pt, test di contratto su metadati e copertura.
- [ ] **Ambiente: store pnpm del profilo disallineato** (27/11, risolto).
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
