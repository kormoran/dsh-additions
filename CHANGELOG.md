# Changelog

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
