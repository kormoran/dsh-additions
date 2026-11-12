# dsh-chatshifter

Sposta una chat di DeepSeek Harness in un altro workspace, portandosi dietro la
storia — oppure, equivalentemente, assegna un nuovo workspace a una chat
esistente.

Un plugin a due metà per [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):

- **host** (`lib/index.js`) — legge la sessione sorgente, scrive una nuova copia
  persistita sotto il workspace di destinazione, la registra nel workspace e
  archivia l'originale;
- **browser** (`lib/client.js`) — una voce «Sposta nel workspace…» nel menu
  contestuale della chat, con la scelta della destinazione, l'avviso esplicito
  su cosa non viaggia e l'esito dell'operazione.

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

## Installazione

```powershell
dsh plugin --profile web add link:C:\percorso\dsh-chatshifter
```

La riga `insert` di `cordis.patch.yml` è il bundle; la metà browser è dichiarata
in `package.json` sotto `dsh.client` e servita da `/plugins`. Nessun passo di
build: il bundle browser è scritto a mano nel formato factory del module loader.

Dopo l'installazione **ricarica la pagina**: la voce compare nel menu `⋯` di
ogni chat in sidebar, tra «Crea fork» e «Copia ID sessione». Dopo aver
modificato `lib/client.js`, il bundle servito è revisionato per metadati del
file: per farlo rileggere senza riavviare DSH disabilita e riabilita la voce
`chatshifter` dalla pagina Plugin (la pagina aperta la riceve a caldo); un
semplice reload del browser non basta, perché il grafo puntato dal boot è
quello letto dalla voce al suo ultimo avvio.

## Configurazione

| Campo | Default | Significato |
|---|---|---|
| `archiveSource` | `true` | Archivia (nasconde) l'originale dopo uno spostamento riuscito. `false` lascia entrambe le chat visibili. |

## API interna

Due rotte autenticate dal carrier della connessione (solo Peer owner):

- `POST /api/chatshifter.move` — `{ sessionId, workspaceId? | targetPath?, keepOriginal? }`
  → `{ ok, sessionId, workspaceId, workspaceTitle, workspacePath, source, events, location, archived, archiveError? }`
- `GET /api/chatshifter.info` — versione e configurazione della metà host.

## Sviluppo

```powershell
node --test --test-isolation=none tests/
node scripts/integration.mjs
```

I test unitari usano servizi finti; `scripts/integration.mjs` compone lo
`SessionStore` e il backend JSONL reali dall'installazione dsh locale, legge una
sessione reale (in sola lettura) e verifica che la copia sia materializzata
sotto il workspace di destinazione e riapribile con la stessa storia.

## Limiti noti

- Una chat sorgente vuota o una sotto-sessione di subagente vengono rifiutate.
- La copia avviene all'istante: i turni ancora aperti vengono chiusi dal resume
  sulla copia, come per qualsiasi log interrotto.
- Se la scrittura riesce ma la registrazione nel workspace fallisce, la copia
  resta su disco con un nuovo id e l'errore lo riporta.
- L'identità della chat cambia: eventuali link o automazioni che citano l'id
  originale vanno aggiornati.
