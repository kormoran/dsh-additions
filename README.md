# dsh-additions

Comandi per DeepSeek Harness — e lo spostamento di una chat in un altro
workspace, portandosi dietro la storia.

Il plugin nasce come `dsh-chatshifter`, quando conteneva solo lo spostamento; ora
il nome è `dsh-additions` perché è il posto dove aggiungere ciò che serve — un
comando, un pannello, un'azione — senza aprire un plugin nuovo ogni volta.
(Nel mezzo è passato da `dsh-commander`, abbandonato perché il nome è occupato su
npm da un plugin di terzi.)

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

### `/quit` — ferma DSH

Scrivi `/quit` nel composer e invia. Il comando risponde, poi dopo `delayMs`
emette `SIGINT` sul processo: è lo stesso percorso di `Ctrl+C` nel terminale di
lancio, quello che smonta i plugin e chiude il server web. Se lo smontaggio si
blocca, un watchdog chiama `process.exit(0)` dopo `graceMs`.

| Config (`quit`) | Default | Significato |
|---|---|---|
| `command` | `quit` | nome del comando |
| `delayMs` | `500` | attesa prima dell'interrupt, perché il risultato arrivi al browser |
| `graceMs` | `5000` | tempo concesso allo smontaggio ordinato prima dell'uscita forzata |

La scheda del browser **non** si chiude da sola: Chrome ed Edge ignorano
`window.close()` sulle schede aperte dall'utente (e `dsh web` apre il browser dal
sistema, non via `window.open`). Chiudi la scheda quando la pagina segnala la
disconnessione: il server intanto si è fermato davvero.

Due cose da sapere: `/quit` interrompe anche un turno in corso, e il log della
sessione resta rileggibile al resume successivo; `/quit` con argomenti viene
rifiutato (`/quit takes no argument.`) senza spegnere nulla.

## Segnali sonori

Due avvisi acustici, per non dover guardare lo schermo mentre il modello lavora:

| Segnale | Quando | Suono predefinito |
|---|---|---|
| `ding` | il modello **finisce il turno** (`running: true → false`) | campana sintetizzata |
| `approval` | c'è una **richiesta di permesso** in attesa (`pendingInteraction.kind === 'approval'`) | «uh oh», due sillabe discendenti |

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
2. Scrive un **nuovo** log nella cartella di progetto del workspace di
   destinazione, con lo stesso formato e gli stessi eventi. I marker di consegna
   del log (`session-log-deepseek/delivery-accepted`) vengono ri-puntati alla
   nuova identità: il formato rifiuta un marker della generazione corrente che
   nomina un'altra sessione, e senza questa riscrittura la copia risulta
   corrotta in lettura (`current-generation delivery marker names the wrong
   Session`). I marker dentro il prefisso ereditato di un fork restano invece
   intestati all'antenato, come per qualsiasi fork.
3. Registra la nuova sessione nel workspace (`Workspace.attachSession`), così
   compare raggruppata sotto quel workspace.
4. Archivia l'originale (`WorkspaceRegistry.archiveSession`) — nascosto, non
   cancellato: lo spostamento è reversibile con «Ripristina».

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

La UI del plugin è tradotta in tutte le lingue di DSH più l'italiano:

| `zh` | `en` | `ja` | `es` | `fr` | `de` | `ru` | `pt` | `it` |
|---|---|---|---|---|---|---|---|---|

I dizionari stanno in `lib/client.js` sotto il namespace `additions`. `zh` è
la baseline: DSH tipizza e spedisce ogni lingua contro il key set cinese e
richiede anche `en` come fallback, quindi ogni dizionario deve avere le stesse
chiavi e gli stessi segnaposto (`{title}`, `{reason}`, …). Il test
`every locale is complete against the Chinese baseline` lo verifica.

L'italiano diventa selezionabile quando un language pack registra la lingua
`it`: nel profilo `web` lo fa `dsh-locale-it`. Il plugin registra solo il
dizionario `it`, non la definizione della lingua, così non entra in conflitto
con il pack che la possiede.

Gli errori dell'host non sono tradotti lato server: la risposta porta un codice
stabile e i dettagli, e il client compone il messaggio nella lingua attiva. Un
codice sconosciuto ricade sul `message` inglese dell'host.

## Installazione

Requisiti: DSH con profilo web e Node.js ≥ 20. Per l'italiano serve un language
pack che registri `it` (`dsh-locale-it`).

Da pacchetto (tarball o npm):

```powershell
dsh plugin --profile web add C:\percorso\dsh-additions-0.3.0.tgz
```

> Il nome npm `dsh-additions` è libero (verificato il 24/11: 404 sul registry),
> quindi è pubblicabile. Da evitare `dsh-commander` (occupato da un plugin di
> terzi) e l'accostamento a `dsh-toy`.

Da repository GitHub, se il repository è accessibile:

```powershell
dsh plugin --profile web add github:kormoran/dsh-additions
```

Per lo sviluppo, con link al checkout:

```powershell
dsh plugin --profile web add link:C:\percorso\dsh-additions
```

La riga `insert` di `cordis.patch.yml` è il bundle; la metà browser è dichiarata
in `package.json` sotto `dsh.client` e servita da `/plugins`. Nessun passo di
build: il bundle browser è scritto a mano nel formato factory del module loader.

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

- `POST /api/additions.move` — `{ sessionId, workspaceId? | targetPath?, keepOriginal? }`
  → `{ ok, sessionId, workspaceId, workspaceTitle, workspacePath, source, events, location, archived, archiveError? }`
- `GET /api/additions.info` — versione e configurazione della metà host.
- `GET /api/additions.workspace-stats` — statistiche di un workspace (vedi sopra).
- `GET /api/additions.sound?which=ding|approval` — il file audio del segnale,
  con `x-additions-sound-source: default|custom`.

Gli errori rispondono `{ ok: false, error: { code, message, details? } }`:
`code` è il contratto stabile che il client traduce, `message` è un fallback
inglese per i consumatori API e `details` porta i valori dei segnaposto
(`sessionId`, `path`, `reason`, …).

## Sviluppo

Serve Node.js ≥ 22.8: `--test-isolation` esiste solo da lì, ed è indispensabile
sotto la sandbox DSH, dove `node --test` con isolamento di processo muore con
`spawn EPERM` (i figli non possono aprire pipe). Il pattern dei test è espanso da
Node stesso, non dalla shell, quindi il comando funziona identico su PowerShell,
cmd e POSIX.

```powershell
npm install                           # una volta: @deepseek-ai/schemastery (schema delle impostazioni)
npm test                              # node --test --test-isolation=none "tests/*.test.js"
node scripts/integration.mjs
```

`@deepseek-ai/schemastery` è una dipendenza vera del pacchetto (è la libreria di
schema che DSH usa per la configurazione dei plugin). Senza `node_modules` il
plugin si carica lo stesso — `Config` resta indefinito, la pagina delle
impostazioni non compare e il test dello schema viene saltato — ma per usare il
namespace `additions` serve installarla.

Aggiungendo un file `tests/*.test.js` viene raccolto dal glob senza toccare
`package.json`.

I test unitari usano servizi finti; `scripts/integration.mjs` compone lo
`SessionStore` e il backend JSONL reali dall'installazione dsh locale, legge una
sessione reale (in sola lettura) e verifica che la copia sia materializzata
sotto il workspace di destinazione e riapribile con la stessa storia.

## Distribuzione

`package.json` è pronto per npm, per il tarball e per l'installazione da GitHub;
il pacchetto spedisce solo `lib/`, `cordis.patch.yml`, README, LICENSE e
CHANGELOG.

```powershell
npm test
npm pack --pack-destination dist
tar -tf dist\dsh-additions-0.3.0.tgz
```

Poi scegli il canale:

- **tarball** — distribuisci `dist\dsh-additions-0.5.3.tgz` e installalo con
  `dsh plugin --profile web add <file>.tgz`;
- **npm** — `npm publish` con il nome `dsh-additions` (libero sul registry);
- **GitHub** — il repository deve essere pubblico o accessibile con credenziali;
  poi `dsh plugin --profile web add github:kormoran/dsh-additions`.

Il tarball contiene i file dichiarati in `files`; `tests/`, `scripts/`,
`PROJECT_STATE.md` e `probe-report.json` restano fuori dal pacchetto.

## Limiti noti

- Una chat sorgente vuota o una sotto-sessione di subagente vengono rifiutate.
- La copia avviene all'istante: i turni ancora aperti vengono chiusi dal resume
  sulla copia, come per qualsiasi log interrotto.
- Se la scrittura riesce ma la registrazione nel workspace fallisce, la copia
  resta su disco con un nuovo id e l'errore lo riporta.
- L'identità della chat cambia: eventuali link o automazioni che citano l'id
  originale vanno aggiornati.
