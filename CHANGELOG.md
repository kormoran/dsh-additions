# Changelog

## 0.10.0 — 2026-11-27

- **Metadati del plugin localizzati** nelle otto lingue di DSH più l'italiano:
  `locale/<id>.json` con `meta.title` e `meta.description` (l'inglese è il
  fallback dichiarato), export `./locale/*.json` e file inclusi nel tarball. La
  pagina Plugins mostra così titolo e descrizione nella lingua attiva invece del
  nome tecnico e della descrizione inglese.
- **Errori completamente localizzati**: il client mappa **ogni** codice delle
  rotte di spostamento/preflight e delle statistiche su una frase localizzata
  (`reason.*`): si aggiungono `same-workspace`, `workspace-not-found`,
  `missing-target`/`relative-path`/`invalid-path`/`workspace-create-failed`,
  `unsupported-format`, `clone-invalid`, `attach-failed`, `invalid-body`,
  `internal`, `path-not-found` e `not-a-directory`. Anche il pannello
  «Workspace» traduce gli errori della scansione.
- Elenchi esportati `MOVE_ERROR_CODES` (`lib/move.js`) e `STATS_ERROR_CODES`
  (`lib/workspace-stats.js`) con un test di contratto: ogni codice ha una
  chiave `reason.*` presente in tutte e nove le lingue.
- Correzione di traduzione: il portoghese usa «Espaços de trabalho» per i
  workspace.
- 96 test (inclusi i nuovi controlli su metadati e copertura delle traduzioni).

## 0.9.0 — 2026-11-27

P0 del backlog: sicurezza dei dati e comportamento con lavoro in corso.

- **La copia viene validata prima di archiviare l'originale.** Dopo la
  scrittura il plugin riapre la copia in sola lettura e verifica id, `cwd`,
  `isSeeded` e cut, lunghezza, sequenze dense da zero, tipi, timestamp e marker
  di consegna intestati alla copia. Se qualcosa non torna: `clone-invalid`, la
  copia non viene registrata né l'originale archiviato, e il file viene rimosso
  quando il percorso è assoluto. `scripts/integration.mjs` esercita la
  validazione su un log reale da 1.322 eventi con 170 watermark.
- **Le chat in esecuzione vengono rifiutate** (`source-busy`, 409) prima di
  scrivere: turno aperto, subagenti discendenti, job posseduti o promemoria
  attivi, letti dalla waterfall `workspace/session-activity` — la stessa che
  governa l'archiviazione del registry.
- **Preflight** `GET /api/additions.preflight?sessionId=…`: sola lettura, il
  dialog la interroga all'apertura e mostra il motivo localizzato (chat in
  esecuzione, vuota, subagente, inesistente) invece di far scegliere una
  destinazione che poi fallirebbe.
- **Un motore di spostamento per plugin**: richieste concorrenti sulla stessa
  chat sono serializzate (`move-in-progress`) e un `requestId` ripetuto risponde
  la stessa copia senza scriverne una seconda (le richieste fallite si possono
  ritentare).
- **Audit delle identità**: solo i marker di consegna della copia vengono
  ri-puntati; `job/*.owner` resta l'originale (contratto del formato: la storia
  copiata non trasferisce l'esecuzione) e `subagent/catalog` continua a nominare
  le sessioni figlie. Test dedicato con tutte e tre le forme.
- **Cross-platform**: il confronto delle directory segue il filesystem
  (case-sensitive fuori da Windows/macOS), gli id con separatori di percorso
  sono rifiutati, un header senza versione di formato valida è rifiutato.
- **Contratto di compatibilità**: `engines.dsh` (`>=0.2.2-rc.1 <0.3.0-0`) e
  l'elenco delle API host/client usate nel README.
- Il motore vive in `lib/move.js` con test dedicati; `lib/index.js` resta le
  rotte e le altre superfici. 93 test unitari.

## 0.8.0 — 2026-11-27

- **`/rename <titolo>`**: rinomina la chat corrente dal composer. Riusa il
  percorso del rename nativo (`SessionTitleService.rename` → evento
  `session/title` con sorgente `user`), quindi il titolo è durevole, blocca la
  rigenerazione automatica e segue il log in una copia spostata. Il testo dopo
  il comando è il titolo; una coppia di virgolette esterna viene tolta. Senza
  argomento risponde con il titolo attuale e l'uso.
- Il comando si registra in modo opzionale (`ctx.inject(['sessionTitle'])`):
  in una composizione senza il servizio dei titoli non compare, e il resto del
  plugin (move, statistiche, suoni, `/quit`) resta intatto.
- 9 test nuovi (`tests/rename.test.js`): parsing del titolo, registrazione,
  rinomina, virgolette, uso, chat non viva, titolo invalido, errore generico e
  wiring di `apply` con e senza il servizio. Totale: 80 test.

## 0.7.0 — 2026-11-27

- **Il plugin ha un suo namespace di impostazioni** (`additions`): `lib/index.js`
  esporta ora un `Config` schemastery, e `sounds.enabled`, `sounds.ding` e
  `sounds.approval` sono campi `.volatile()`. `settings.describe()` serve quindi
  la namespace `additions` con esattamente quei tre campi, e le scritture si
  applicano a caldo (nessun riavvio).
- **Pagina di configurazione nella pagina Plugins**: metà browser registrata in
  `plugins.row.config` (chiavi `dsh-additions#additions` e, per il profilo con
  l'alias storico, `dsh-chatshifter#additions`) con
  - la casella «Attiva i suoni di notifica» (scrive subito),
  - le due caselle di testo per i file di fine turno e di richiesta
    autorizzazione (Salva/Annulla, inviate insieme),
  - lo stato del salvataggio e i messaggi di rifiuto.
- La pagina segue il namespace servito (`ctx.configForms.whileServed`): su un
  host senza la namespace non compare, e il resto del plugin resta intatto
  (`configForms` è iniettato in modo opzionale).
- Il player segue le impostazioni accettate senza reload: la cache dei buffer è
  per cue **e percorso**, quindi cambiare file si sente dal segnale successivo
  anche a pagina aperta.
- **Nuova dipendenza**: `@deepseek-ai/schemastery` (`~3.19.0`), la libreria di
  schema che DSH usa per la configurazione. Se manca, il modulo si carica lo
  stesso (`Config` indefinito → niente namespace, nessuna validazione) e lo
  segnala nel log del host.
- `VERSION` della metà host allineata al pacchetto (0.7.0).
- 23 test nuovi o aggiornati: schema (`volatileForm`-equivalente e proiezione),
  riferimenti volatili nelle rotte, player per percorso, pagina (switch, caselle,
  Salva, rifiuto, namespace non servito) e locale completa in 9 lingue.
- Verificato sul profilo live: `settings/describe` serve `additions` con i tre
  campi; una scrittura `settings/mutate` ha aggiornato la configurazione a caldo
  (`/api/additions.info` e la rotta del suono hanno visto il nuovo percorso) e
  l'`unset` ha ripristinato il default lasciando il patch del profilo pulito.

## 0.6.0 — 2026-11-26

- **Segnali sonori** (`lib/sounds.js` + watcher nel bundle browser): un `ding`
  quando il modello finisce il turno e un «uh oh» quando una richiesta di
  permesso è in attesa. I due eventi si ricavano da `uiSession.sessionStatus`
  (`running: true → false`, `pendingInteraction.kind === 'approval'`), quindi
  nessun listener entra nel waterfall delle approvazioni.
- I suoni predefiniti sono **sintetizzati** (nessun campione di terzi):
  `assets/ding.wav` (campana) e `assets/uh-oh.wav` (due sillabe discendenti),
  generati da `scripts/make-sounds.mjs`, 16-bit mono 22 kHz.
- **File sostituibili**: `sounds.ding` / `sounds.approval` accettano un percorso
  assoluto a un file audio (wav/mp3/ogg/m4a/flac/webm); un file illeggibile
  ricade sul suono impacchettato e la risposta lo segnala con l'header
  `x-additions-sound-source`. `sounds.enabled` e `sounds.volume` governano i
  segnali; la rotta è `GET /api/additions.sound?which=ding|approval`.
- L'AudioContext si crea al primo gesto (pointerdown/keydown) e riprende da solo:
  i browser bloccano l'audio prima di un'interazione. Un segnale che non può
  suonare viene loggato e inghiottito, mai propagato all'interfaccia.
- Corretto anche `VERSION` in `lib/index.js`, rimasto a `0.3.0` mentre il
  pacchetto era alla 0.5.x: `/api/additions.info` ora riporta la versione vera.
- 12 test nuovi (7 host sui suoni e sulla rotta, 5 sul bundle: transizioni,
  caching del buffer, player disabilitato, `configure`).

## 0.5.3 — 2026-11-26

- **Repository rinominato** in `kormoran/dsh-additions` (prima
  `dsh-chatshifter`): aggiornati `repository`/`homepage`/`bugs` in
  `package.json` e le istruzioni di installazione nel README. Nessuna modifica
  al codice; il pacchetto npm si chiamava già `dsh-additions`.

## 0.5.2 — 2026-11-25

- **La tab «Workspace» ora è trovabile**: il `+` del pannello destro apre la tab
  *guida*, e la guida elenca solo i tipi che dichiarano voci `guide`. La
  definition ora porta `guide: [{ id: 'workspaces', order: 10, title, description }]`
  (senza `icon`: la guida ripiega sul proprio glifo, così il pannello non dipende
  da un artwork esterno). Nuove chiavi `guide.title`/`guide.description` nelle 9
  lingue; il test del bundle verifica la voce.

## 0.5.1 — 2026-11-25

- **Corretto il click su «Sposta nel workspace…»**: `MenuItemButton` segnala la
  scelta con `onSelect`, non `onClick`. La riga veniva renderizzata (`t` e `open`
  arrivavano) ma il gestore non veniva mai invocato: il menu restava aperto e non
  succedeva nulla, senza errori in console. Ora la riga usa `onSelect`, e due test
  di regressione fissano il contratto del primitivo (`onSelect` presente,
  `onClick` assente, chiusura del menu e apertura del dialog con
  `sessionId`/`displayTitle`).

## 0.5.0 — 2026-11-24

- **Pannello destro «Workspace»**: nuova tab per `ctx.sidebarRightTabs`
  (`{id, kind, priority, title}`) con corpo in `sidebar.right.pane.tab` e chip in
  `sidebar.right.pane.tab.title`. Elenca i workspace con titolo, percorso e data
  di creazione; «Dettagli» chiama `GET /api/additions.workspace-stats` e mostra
  dimensione, directory, file, righe di codice, righe di documentazione e totale,
  con avviso quando la scansione è parziale e pulsanti Aggiorna/Indietro.
- La tab si registra in modo condizionale (`ctx.inject(['sidebarRightTabs'])`):
  se il pannello destro non è composto, il resto della metà browser continua a
  funzionare.
- 17 chiavi nuove tradotte nelle 9 lingue (dizionari di base + pannello uniti in
  un namespace completo) e due test in più sul bundle (46 totali).

## 0.4.0 — 2026-11-24

- **Metà browser portata all'API client corrente.** DSH 0.2.1-rc.2 non espone
  più `ctx.contextMenus`: la voce «Sposta nel workspace…» ora si registra in
  `sidebar.workspaces.session.menu.item` con `ctx.slots.inject`/`ctx.slots.register`,
  e il flusso di scelta della destinazione è diventato un dialog in
  `shell.overlay` (lista dei workspace, «Un'altra cartella…», avviso su cosa non
  viaggia, esito). Undici test del bundle coprono registrazioni, dizionari e
  controller.
- **Motore delle statistiche workspace** (`lib/workspace-stats.js`) con la rotta
  autenticata `GET /api/additions.workspace-stats?workspaceId=…|path=…`:
  dimensione in byte, numero di directory e file, righe di codice e righe di
  documentazione (contate separatamente, più il totale). Scansione limitata da
  tetto di tempo, di voci e di byte letti, con rapportino `truncated`/`exhausted`;
  directory generate e vendorizzate escluse, symlink non seguiti, file binari
  contati come byte e non come righe. Nove test su fixture, budget e rotta.
- Il pannello destro «Workspace» che consuma queste statistiche arriva nel
  prossimo passo: qui c'è il lato dati completo e testato.

## 0.3.0 — 2026-11-24

- **Rinomina**: il plugin diventa `dsh-additions` (pacchetto, bundle `id`,
  rotte `/api/additions.*`, namespace locale `additions`, voce del loader).
  Percorso dei nomi: `dsh-chatshifter` → `dsh-commander` (abbandonato: nome npm
  occupato da un plugin di terzi) → `dsh-additions`. Il repository GitHub resta
  `dsh-chatshifter` finché non lo si rinomina.
- **Nuovo comando `/quit`** (`lib/quit.js`): ferma il processo DSH dal composer.
  Emette `SIGINT` dopo un ritardo configurabile — è il percorso ordinato di
  `Ctrl+C`, quello che smonta i plugin e chiude il server web — con un watchdog
  che forza `process.exit(0)` se lo smontaggio si blocca. Config:
  `quit.command`, `quit.delayMs`, `quit.graceMs`. Gli argomenti sono rifiutati.
- La scheda del browser non può essere chiusa da script (limite dei browser):
  il comando lo dice nel risultato e la pagina va chiusa a mano.
- 9 nuovi test su configurazione, ordine interrupt/watchdog, idempotenza,
  annullamento e rifiuto degli argomenti.

## Non pubblicato — correzioni del 24/11

- Comando di test corretto per Node ≥ 22.8: `npm test` e il README usano
  `node --test --test-isolation=none "tests/*.test.js"` al posto di `tests/`,
  che su Node 24 fallisce con `ERR_UNSUPPORTED_DIR_IMPORT`.
- Documentato nel README il canale di installazione (tarball/npm vs `link:`) e
  il fatto che una voce nuova entra nel grafo solo al riavvio di DSH.

## 0.2.0 — 2026-11-12

- Interfaccia localizzata in tutte le lingue di DSH più l'italiano: `zh`, `en`,
  `ja`, `es`, `fr`, `de`, `ru`, `pt`, `it` (namespace `chatshifter`, baseline
  `zh`, fallback `en`).
- La voce di menu, la conferma, l'avanzamento e l'esito seguono la lingua attiva.
- Gli errori dell'host espongono `code` e `details` stabili; il client li traduce
  e ricade sul `message` inglese per i codici sconosciuti.
- Test di completezza dei dizionari, dei segnaposto e delle chiavi usate.

## 0.1.1 — 2026-11-12

- Corretto lo spostamento di chat che contengono marker
  `session-log-deepseek/delivery-accepted`: i marker propri vengono ri-puntati
  alla nuova identità, quelli del prefisso ereditato restano all'antenato.
- Aggiunti `scripts/repair-delivery.mjs` (riparazione in place con dry-run) e
  `scripts/repro-delivery.mjs` (riproduzione del guasto).
- L'integrazione sceglie una sessione reale con watermark e verifica che la copia
  li possieda.

## 0.1.0 — 2026-11-12

- Prima versione: sposta una chat in un altro workspace copiando la storia, la
  registra nel workspace di destinazione e archivia l'originale.
- Voce «Sposta nel workspace…» nel menu contestuale della chat, scelta della
  destinazione, conferma esplicita e report dell'esito.
- Configurazione `archiveSource` (default `true`).
