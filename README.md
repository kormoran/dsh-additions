# dsh-additions

Comandi e funzioni aggiuntive per DeepSeek Harness.

Il plugin è un insieme di funzioni aggiunte per mia comodità man mano che usavo l'harness; 
da qui il nome `dsh-additions` perché è il posto dove aggiungere ciò che serve — un
comando, un pannello, un'azione — senza aprire un plugin nuovo ogni volta. 
Per questo motivo ho lasciato la versione a 0.x.0 invece di mettere "1.0.0" in pubblicazione: visto
che è una collezione di funzioni, probabilmente non ci sarà mai una versione "completa" di
questo plugin. A maggior ragione perché dsh stesso è ancora in versione 0.2.2 al momento, quindi tutto è ancora in divenire.

- **comando** (`lib/quit.js`) — `/quit` ferma il processo DSH dal composer, con
  percorso ordinato e watchdog di uscita;
- **host** (`lib/index.js`) — legge la sessione sorgente, scrive una nuova copia
  persistita sotto il workspace di destinazione, la registra nel workspace e
  archivia l'originale;
- **browser** (`lib/client.js`) — una voce «Sposta nel workspace…» nel menu
  contestuale della chat, con la scelta della destinazione, l'avviso esplicito
  su cosa non viaggia e l'esito dell'operazione. La voce e i messaggi sono
  tradotti in tutte le lingue di DSH più l'italiano.

> La metà browser usa l'API client corrente (`ctx.slots`): la voce compare nel
> menu `⋯` della chat e apre un dialog di scelta della destinazione. Su DSH
> 0.2.0, che esponeva `ctx.contextMenus`, questa versione non si carica.

## Statistiche workspace

Il plugin sa misurare un workspace: dimensione totale in byte, numero di
directory, numero di file, righe di **codice** e righe di **documentazione**
(sommate a parte, più il totale). La documentazione conta come codice: `.md`,
`.rst`, `.txt`, `.tex`, `.adoc`, `.org`, `.mdx`, `.wiki` finiscono nel secondo
conteggio.

La rotta è autenticata e risponde solo al Peer owner:

```text
GET /api/additions.workspace-stats?workspaceId=<id>
GET /api/additions.workspace-stats?path=<percorso assoluto>
→ { ok, workspaceTitle, cached,
    path, sizeBytes, directories, files, codeFiles, docFiles,
    codeLines, docLines, totalLines, truncated, exhausted, elapsedMs }
```

La scansione è volutamente limitata, perché un workspace è una directory
arbitraria e una richiesta web non deve mai restare appesa:

| Limite (`stats`) | Default | Effetto |
|---|---|---|
| `timeLimitMs` | `10000` | oltre questo tempo la scansione si ferma e marca `truncated` |
| `cacheTtlMs` | `15000` | una seconda richiesta entro questo tempo riusa il risultato (`cached: true`) |
| `maxEntries` | `200000` | directory + file visitati al massimo |
| `maxBytesRead` | `67108864` | byte letti per contare le righe |

Directory generate o vendorizzate (`.git`, `node_modules`, `.venv`, `dist`,
`build`, `target`, cache) non entrano nel conteggio; i symlink non vengono
seguiti; i file binari (NUL nei primi byte) contano come byte ma non come righe;
un file più grande di 4 MiB viene contato parzialmente e il risultato dice
`exhausted: "file"`.

### Pannello destro «Workspace»

Come si apre: **`+`** (nuova tab) nel pannello destro → tab *guida* → capsula
**«Workspace»**. Serve saperlo perché il `+` non elenca i tipi registrati: apre
la guida, e la guida mostra solo i tipi che dichiarano voci `guide` nella loro
definition (`{ id, order, title, description, icon? }`). Un tipo senza `guide` è
registrato ma irraggiungibile dalla UI.

La tab elenca i workspace con titolo, percorso e data di creazione. «Dettagli»
legge le statistiche dal vivo e mostra dimensione, directory, file, righe di
codice, righe di documentazione e totale; se la scansione è parziale lo dice, e i
pulsanti Aggiorna/Indietro permettono di ricalcolare o tornare all'elenco.

La tab si registra solo se il pannello destro è composto
(`ctx.inject(['sidebarRightTabs'])`): senza quel servizio il resto della metà
browser continua a funzionare.

## Comandi

### `/rename` — rinomina la chat corrente

Il rename nativo resta nel menu `⋯` della chat (voce «Rinomina», con il suo
dialog); `/rename` è la variante da tastiera, per quando la mano è già sul
composer:

```text
/rename Nuovo titolo
/rename "Un titolo con spazi"
```

Il testo dopo il comando è il titolo (una coppia di virgolette esterna viene
tolta). Il comando usa lo stesso percorso del rename nativo
(`SessionTitleService.rename`): scrive un evento `session/title` con sorgente
`user`, quindi il titolo è durevole, blocca la rigenerazione automatica e
viaggia con il log in una copia spostata. Senza argomento risponde con il titolo
attuale e l'uso. Se il servizio dei titoli non è composto, il comando non
compare e il resto del plugin resta intatto.

### `/quit` — ferma DSH

Scrivi `/quit` nel composer e invia. Il comando risponde, poi dopo `delayMs`
emette `SIGINT` sul processo: è lo stesso percorso di `Ctrl+C` nel terminale di
lancio, quello che smonta i plugin e chiude il server web. Se lo smontaggio si
blocca, un watchdog chiama `process.exit(0)` dopo `graceMs`.

Lo scopo di questo comando è chiudere il processo node.js in cui gira dsh nel caso
si sia lanciato l'harness senza finestra console (come faccio io, per non avere
ancora un'altra finestra fra i piedi). Se no l'unica è killarlo da gestione attività.

| Config (`quit`) | Default | Significato |
|---|---|---|
| `command` | `quit` | nome del comando |
| `delayMs` | `500` | attesa prima dell'interrupt, perché il risultato arrivi al browser |
| `graceMs` | `5000` | tempo concesso allo smontaggio ordinato prima dell'uscita forzata |

La scheda del browser **non** si chiude da sola: Chrome ed Edge ignorano
`window.close()` sulle schede aperte dall'utente (e `dsh web` apre il browser dal
sistema, non via `window.open`). Chiudi la scheda quando la pagina segnala la
disconnessione: il server intanto si è fermato davvero.

Due cose da sapere: 
1. `/quit` interrompe anche un turno in corso, e il log della sessione resta rileggibile al resume successivo; 
2. `/quit` con argomenti viene rifiutato (`/quit takes no argument.`) senza spegnere nulla.

## Segnali sonori

Due avvisi acustici (disabilitabili), per non dover guardare lo schermo e poter fare altro mentre il modello lavora:

| Segnale | Quando | Suono predefinito |
|---|---|---|
| `ding` | il modello **finisce il turno** (`running: true → false`) | campana sintetizzata |
| `approval` | c'è una **richiesta di permesso** in attesa (`pendingInteraction.kind === 'approval'`) | «uh oh» |

I due eventi si leggono da `uiSession.sessionStatus`, lo stesso stato che il
client usa per i puntini di attività: nessun listener entra nel waterfall delle
approvazioni, quindi il plugin non può ritardare o bloccare una decisione.

I suoni predefiniti sono generati da [scripts/make-sounds.mjs](scripts/make-sounds.mjs)
(16-bit mono, 22 kHz): nessun campione di terzi, licenza pulita, 85 kB in tutto.

### Attivare e scegliere i due file

Due strade equivalenti, perché il plugin dichiara il proprio namespace di
impostazioni (`additions`) e quindi ha una pagina di configurazione.

**Dalla pagina del plugin** — la via normale: apri **Plugin** nella sidebar,
scegli `dsh-additions`, apri la riga `additions` e premi il pulsante di
configurazione. Trovi:

- la casella **«Attiva i suoni di notifica»** (agisce subito, senza ricaricare);
- la casella **«Fine turno»** con il percorso del file `ding`;
- la casella **«Richiesta di autorizzazione»** con il percorso del file `approval`;
- **Salva** / **Annulla** per le due caselle di testo (i percorsi si inviano
  insieme, così un percorso scritto a metà non sostituisce un suono funzionante).

I valori così scelti finiscono nel patch del profilo (`~/.dsh/profiles/<nome>/cordis.patch.yml`,
riga `additions`) e vengono applicati a caldo: sono campi *volatili* dello schema
del plugin, quindi né il server né la pagina vanno riavviati.

**Dalla configurazione del bundle** — per chi preferisce il file, o per un
profilo generato:

```yaml
sounds:
  enabled: true
  volume: 0.7
  ding: C:\suoni\campanello.wav
  approval: C:\suoni\uh-oh.mp3
```

| Campo (`sounds`) | Default | Significato |
|---|---|---|
| `enabled` | `true` | spegne entrambi i segnali (dalla pagina: la casella) |
| `volume` | `0.7` | guadagno applicato dal browser (`0`–`1`); solo da file |
| `ding` | asset impacchettato | file alternativo per la fine del turno (dalla pagina: casella) |
| `approval` | asset impacchettato | file alternativo per la richiesta di permesso (dalla pagina: casella) |

Formati accettati: wav, mp3, ogg, m4a, flac, webm; il percorso deve essere
**assoluto**.

Il file viene letto **a ogni riproduzione** (niente cache lato host): sostituirlo
o cambiare percorso ha effetto dal segnale successivo. Se il percorso indicato
non è leggibile, il plugin suona l'asset impacchettato e la risposta della rotta
lo dichiara nell'header `x-additions-sound-source` — un errore di battitura non
ti fa perdere l'avviso.

Due avvertenze:

- i browser bloccano l'audio finché non c'è un gesto dell'utente: l'AudioContext
  si crea e si riprende al primo click o tasto, quindi il **primo** segnale dopo
  l'apertura della pagina può restare muto;
- il segnale di fine turno vale per **ogni** sessione (anche quelle create da
  subagenti): se lanci più lavori insieme, sentirai più ding.

## Cosa fa

1. Legge la sessione sorgente: dalla memoria se è viva (`ctx.sessions`),
   altrimenti dal log persistito con sola lettura (`ctx.sessionPersistence`).
2. **Rifiuta una chat che sta ancora lavorando** (turno aperto, subagenti
   discendenti, job posseduti, promemoria attivi): la stessa waterfall
   `workspace/session-activity` che governa l'archiviazione del registry. Il
   dialog chiede prima (`GET /api/additions.preflight`) e mostra il motivo senza
   far scegliere una destinazione.
3. Scrive un **nuovo** log nella cartella di progetto del workspace di
   destinazione, con lo stesso formato e gli stessi eventi. I marker di consegna
   del log (`session-log-deepseek/delivery-accepted`) vengono ri-puntati alla
   nuova identità: il formato rifiuta un marker della generazione corrente che
   nomina un'altra sessione, e senza questa riscrittura la copia risulta
   corrotta in lettura (`current-generation delivery marker names the wrong
   Session`). I marker dentro il prefisso ereditato di un fork restano invece
   intestati all'antenato, come per qualsiasi fork. Le altre identità non si
   toccano di proposito: `job/registered`/`job/settled` portano l'owner
   originale («copied history does not transfer execution ownership») e
   `subagent/catalog` nomina le sessioni figlie.
4. **Riapre la copia e la valida** prima di proseguire: id, `cwd`, `isSeeded` e
   cut, lunghezza, sequenze dense da zero, tipi, timestamp e marker di consegna
   che nominano la copia. Se la validazione fallisce la copia non viene
   registrata né l'originale archiviato: l'errore è `clone-invalid` con il
   motivo e il file viene rimosso se il percorso è assoluto.
5. Registra la nuova sessione nel workspace (`Workspace.attachSession`), così
   compare raggruppata sotto quel workspace. Se la registrazione fallisce, la
   copia viene rimossa (best-effort) e l'errore è `attach-failed`.
6. Archivia l'originale (`WorkspaceRegistry.archiveSession`) — nascosto, non
   cancellato: lo spostamento è reversibile con «Ripristina».

Due richieste concorrenti sulla stessa chat sono serializzate (`move-in-progress`);
un `requestId` ripetuto risponde la stessa copia senza scriverne una seconda.

## Compatibilità

| Superficie | API usate |
|---|---|
| Host | `ctx.sessions` (`get`, `snapshotEvents`, `inheritedEventCount`), `ctx.sessionPersistence` (`stat`, `open`, `create`, `append`, `flush`, `close`), `ctx.workspaceRegistry` (`get`, `resolveByPath`, `create`, `attachSession`, `archiveSession`), `ctx.connection.fetch.register`, `ctx.commands.register`, `ctx.sessionTitle` (`get`, `rename`; opzionale), `ctx.waterfall('workspace/session-activity')`, `Config` schemastery per il namespace `additions` |
| Browser | `ctx.slots.inject/register`, `ctx.locale.register/bind`, `ctx.workspaces.list`, `ctx.sessions.refresh`, `ctx.remote.directoryPicker.pick`, `ctx.configForms.get/whileServed/mutate`, i primitivi `Modal`/`Button`/`MenuItemButton`/`Switch`/`Input` |
| Formato log | sessione **v4**; i log storici vengono letti dal backend, che li traduce in memoria alla versione corrente (la copia nasce nella versione logica letta). Nessun formato proprietario. |
| Piattaforma | Windows (testato), percorsi macOS/Linux gestiti dal confronto case-sensitive; la matrice multi-OS non è ancora in CI |

`package.json` dichiara `engines.dsh` (`>=0.2.2-rc.1 <0.3.0-0`): il plugin manager
rifiuta l'installazione su una linea DSH diversa prima di eseguire codice.

## Cosa viaggia e cosa no

| Viaggia | Non viaggia |
|---|---|
| tutta la storia della conversazione, immagini e allegati (riferimenti per hash) | l'identità della sessione: la chat spostata ha un **nuovo id** |
| il titolo (evento `session/title`) | `AGENTS.md`, `.dsh/skills`, file di progetto: la copia legge quelli del nuovo workspace |
| il preset agente registrato (`agentPreset`) | sotto-sessioni, subagenti, job in background |
| la marcatura fork (`isSeeded` + cut), se la sorgente era a sua volta un fork | permessi e impostazioni locali della cartella |

L'originale non viene toccato: la sua storia resta intatta e può essere
ripristinata.

## Lingue

Il plugin parla tutte le lingue di DSH più l'italiano, sia nella UI sia nei
metadati con cui il Plugins page lo presenta:

| `zh` | `en` | `ja` | `es` | `fr` | `de` | `ru` | `pt` | `it` |
|---|---|---|---|---|---|---|---|---|

- **UI**: i dizionari stanno in `lib/client.js` sotto il namespace `additions`.
  `zh` è la baseline: DSH tipizza e spedisce ogni lingua contro il key set
  cinese e richiede anche `en` come fallback, quindi ogni dizionario deve avere
  le stesse chiavi e gli stessi segnaposto (`{title}`, `{reason}`, …). I test
  `every key the bundle translates…` e `every locale is complete…` lo
  verificano.
- **Metadati del plugin** (titolo e descrizione nella pagina Plugins): un file
  per lingua in `locale/<id>.json`, con `{ "meta": { "title", "description" } }`.
  DSH legge `locale/en.json` e ogni lingua presente nella stessa cartella;
  l'inglese è il fallback dichiarato. I file sono esportati come
  `./locale/*.json` e inclusi nel tarball.
- **Errori**: l'host non traduce i messaggi, espone un `code` stabile; il client
  mappa **ogni** codice delle rotte di spostamento e delle statistiche su una
  frase localizzata (`reason.*`). Un codice sconosciuto ricade sul `message`
  inglese dell'host. Il test `every refusal code the host can answer is
  localized` tiene allineati gli elenchi esportati da `lib/move.js` e
  `lib/workspace-stats.js` con la mappa del bundle.
- **Limite della piattaforma**: descrizioni e risultati dei comandi (`/quit`,
  `/rename`) sono testo del host e non hanno un canale di traduzione; DSH
  localizza lato client solo i comandi built-in. Restano quindi in inglese in
  ogni lingua, come per gli altri plugin esterni.

L'italiano diventa selezionabile quando un language pack registra la lingua
`it`: nel profilo `web` lo fa `dsh-locale-it`. Il plugin registra solo il
dizionario `it`, non la definizione della lingua, così non entra in conflitto
con il pack che la possiede.

## Installazione

Requisiti: DSH con profilo web e Node.js ≥ 20. Per l'italiano serve un language
pack che registri `it` (`dsh-locale-it`).

Da pacchetto (tarball o npm):

```powershell
dsh plugin --profile web add C:\percorso\dsh-additions-0.3.0.tgz
```

Da repository GitHub, se il repository è accessibile:

```powershell
dsh plugin --profile web add github:kormoran/dsh-additions
```

Per lo sviluppo, con link al checkout:

```powershell
dsh plugin --profile web add link:C:\percorso\dsh-additions
```

Il canale di installazione decide come si aggiorna il profilo:

| Installazione | Cosa finisce nel profilo | Per aggiornare il codice |
|---|---|---|
| `add <file>.tgz` / `add dsh-additions` | copia del pacchetto in `node_modules` | rifai `npm pack` e reinstalla il tarball |
| `add link:<percorso>` | symlink al checkout | il file cambia subito, ma la voce va riavviata |

In entrambi i casi una voce **nuova** entra nel grafo solo al riavvio di DSH: il
server legge i bundle del profilo una volta, al boot.

Dopo l'installazione **ricarica la pagina**: la voce compare nel menu `⋯` di
ogni chat in sidebar, tra «Crea fork» e «Copia ID sessione». Dopo aver
modificato `lib/client.js`, il bundle servito è revisionato per metadati del
file: per farlo rileggere senza riavviare DSH disabilita e riabilita la voce
`additions` dalla pagina Plugin (la pagina aperta la riceve a caldo); un
semplice reload del browser non basta, perché il grafo puntato dal boot è
quello letto dalla voce al suo ultimo avvio.

## Configurazione

Il plugin dichiara uno schema `Config` e con esso il proprio **namespace di
impostazioni** (`additions`): i campi marcati *volatili* compaiono nella pagina
di configurazione del plugin e si applicano a caldo.

| Campo | Default | Significato |
|---|---|---|
| `archiveSource` | `true` | Archivia (nasconde) l'originale dopo uno spostamento riuscito. `false` lascia entrambe le chat visibili. |
| `quit` | vedi [Comandi](#quit--ferma-dsh) | `command`, `delayMs`, `graceMs` del comando `/quit`. |
| `stats` | vedi [Statistiche workspace](#statistiche-workspace) | limiti della scansione (tempo, voci, byte, cache). |
| `sounds` | vedi [Segnali sonori](#segnali-sonori) | `enabled`, `volume`, `ding`, `approval`; `enabled`, `ding` e `approval` sono modificabili dalla pagina. |

Nella pagina del plugin compaiono solo i tre campi volatili di `sounds`;
`volume` e gli altri blocchi restano configurabili dal patch del profilo. Una
scrittura dalla pagina salva la configurazione **completa** della riga nel patch
del profilo (i campi non volatili restano quelli correnti).

## API interna

Rotte autenticate dal carrier della connessione (solo Peer owner):

- `GET /api/additions.preflight?sessionId=…` — `{ ok, movable, source? }` oppure
  `{ ok, movable: false, code, message, details? }`; sola lettura, non scrive
  nulla. Il dialog la interroga prima di offrire le destinazioni.
- `POST /api/additions.move` — `{ sessionId, workspaceId? | targetPath?, keepOriginal?, requestId? }`
  → `{ ok, sessionId, workspaceId, workspaceTitle, workspacePath, source, events, location, validated, archived, archiveError? }`
- `GET /api/additions.info` — versione e configurazione della metà host.
- `GET /api/additions.workspace-stats` — statistiche di un workspace (vedi sopra).
- `GET /api/additions.sound?which=ding|approval` — il file audio del segnale,
  con `x-additions-sound-source: default|custom`.

Gli errori rispondono `{ ok: false, error: { code, message, details? } }`:
`code` è il contratto stabile che il client traduce, `message` è un fallback
inglese per i consumatori API e `details` porta i valori dei segnaposto
(`sessionId`, `path`, `reason`, `activity`, …). Codici dello spostamento:

| `code` | HTTP | Quando |
|---|---|---|
| `missing-session`, `invalid-session-id`, `missing-target`, `relative-path`, `invalid-body` | 400 | richiesta inutilizzabile (l'id non può contenere separatori di percorso) |
| `session-not-found`, `workspace-not-found` | 404 | chat o workspace inesistenti |
| `subagent-session`, `empty-session`, `unsupported-format`, `same-workspace`, `source-busy`, `move-in-progress` | 409 | rifiuto di merito, prima di scrivere |
| `invalid-path`, `workspace-create-failed` | 400 | la cartella scelta non può diventare un workspace |
| `clone-invalid`, `attach-failed` | 500 | la copia non ha superato la validazione o la registrazione; l'originale **non** è archiviato |
| `internal` | 500 | guasto inatteso, nel log dell'host |

Il client localizza `source-busy`, `subagent-session`, `empty-session`,
`session-not-found` e `move-in-progress`; per gli altri codici mostra il
`message` dell'host.


## Limiti noti

- Una chat sorgente vuota, una sotto-sessione di subagente o una chat che sta
  ancora lavorando vengono rifiutate **prima** di scrivere; il dialog lo dice
  prima di far scegliere la destinazione.
- La copia è istantanea e non è transazionale con il workspace: se la
  registrazione fallisce, la copia viene rimossa best-effort (solo un percorso
  assoluto viene toccato) e l'errore `attach-failed` riporta id e motivo.
- L'identità della chat cambia: eventuali link o automazioni che citano l'id
  originale vanno aggiornati. Il proprietario dei job resta quello originale per
  contratto (la storia copiata non trasferisce l'esecuzione), quindi i job
  elencati nella copia appartengono ancora alla chat di partenza.
- **Titolo delle copie fork-derived**: una sessione che era già un fork e non
  aveva ancora un evento `session/title` resta senza titolo, perché il servizio
  titoli esclude le sessioni seed dalla generazione automatica. La copia non è
  viva al momento dello spostamento, quindi non si può chiedere al servizio di
  generarlo: usa `/rename <titolo>` sulla copia (o sulla sorgente prima di
  spostarla).
- **Archiviando la chat aperta**, il client non ne azzera la selezione come fa
  l'archiviazione nativa: la vista resta finché non si naviga altrove. Non
  esiste un'API pubblica per chiudere la vista corrente.
