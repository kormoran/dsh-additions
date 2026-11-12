# TODO — verso la 1.0.0

Backlog operativo per la 1.0.0 di `dsh-chatshifter`.

Punto di partenza: **0.2.0** (commit `8ea2573`, tag `v0.2.0`, 28/28 test,
tarball in `dist/`). Obiettivo: release stabile, sicura e distribuibile.
Aggiornato: **2026-11-12**; si riparte il **13/11**.

Strategia consigliata: chiudere i P0, pubblicare `1.0.0-rc.1`, fare il smoke
test in un profilo pulito, poi promuovere a `1.0.0` (o direttamente 1.0 se il
tempo basta).

## P0 — bloccanti (dati e compatibilità)

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
