# PROJECT_STATE — dsh-session-mover

Memoria permanente del progetto durante la transizione. Aggiornato: **2026-11-12**, sessione con cwd `C:\Users\m.soricetti\Documents\deepseek-harness\default-workspace`.

## Obiettivo

Un plugin per DeepSeek Harness che **sposti una chat in un altro workspace**, portandosi dietro contesto e memorie — o, equivalentemente, che assegni un nuovo workspace a una chat esistente.

## Stato: POC riuscito

Il meccanismo funziona. Una sessione è stata creata in un workspace diverso con la storia di un'altra dentro:

```
source:  session-e155ca60-…  cwd …\default-workspace   3 eventi
created: session-1           cwd …\GitHub\dsh-locale-it 4 eventi, inheritedEventCount 3, listed: true
```

Report completo in `probe-report.json` (rigenerato a ogni attivazione del probe).

## Scoperte verificate (non ipotesi)

1. **Le sessioni sono organizzate per workspace su disco**
   `~/.dsh/sessions/--<cwd normalizzato>--/session-<id>/session.v4.jsonl.zstd`
   L'appartenenza a un workspace *è* il nome della cartella che contiene il log.

2. **L'header della sessione porta la cwd**
   `ctx.sessions.create(id, { meta: { cwd } })` — e in lettura `session.header.cwd`.

3. **`fork()` NON cambia workspace**
   `fork(source, boundary?, childSessionId?)` non ha un parametro di directory e copia la `cwd` del padre. Inutilizzabile per questo scopo.

4. **`create()` accetta una storia iniziale**
   `CreateSessionOptions = { seed?: SessionEvent[], inheritedEventCount?, meta?: { cwd?, isSeeded? } }`.
   Con `seed` + `meta.cwd` si ottiene una sessione nuova, in un'altra directory, con la storia dentro. **È il primitivo del plugin.**

5. **Un plugin installato fuori dall'albero dsh non può importare i pacchetti dsh**
   `import('@deepseek-ai/dsh-session/fork')` fallisce: *Cannot find package*.
   Conseguenza: niente `buildForkSeed`; si usa solo ciò che espone il servizio iniettato (`ctx.sessions`). Se un domani servisse un import, va dichiarato come dipendenza nel `package.json` del plugin.

6. **La creazione è pigra**
   `create()` non scrive su disco finché non arriva il primo `append`. La sessione creata dal POC è solo in memoria: non compare in `~/.dsh/sessions` e sparisce al riavvio. Non è un difetto, è il comportamento documentato — ma significa che il POC non ha sporcato l'archivio.

7. **Gli allegati viaggiano gratis**
   Sono in `~/.dsh/attachments` per hash del contenuto: i riferimenti restano validi in qualunque workspace.

## Cosa NON viaggia (da decidere nel plugin vero)

| | |
|---|---|
| Sotto-sessioni e subagenti | sono sessioni separate, non vengono clonate |
| `AGENTS.md`, `.dsh/skills`, file di progetto | vivono nella directory: la chat spostata legge quelle del nuovo workspace |
| L'identità della sessione | nasce un **nuovo id**: è una copia con storia, non la stessa chat |

## File del progetto (in questa workspace, temporanei)

| Percorso | Ruolo |
|---|---|
| `packages/dsh-session-mover-probe/` | il probe, installato nel profilo `web` come bundle |
| `packages/dsh-session-mover-probe/lib/index.js` | logica: legge sorgente, crea sessione seminata, scrive il report |
| `packages/dsh-session-mover-probe/cordis.patch.yml` | configura il probe (sourceId, targetCwd, doCreate, reportPath) |
| `probe-report.json` | l'esito dell'ultima attivazione |

Il probe è **installato e attivo** nel profilo: va rimosso quando si passa al plugin vero.

## Prossimi passi (plugin vero)

1. **Interfaccia**: una voce «Sposta nel workspace…» con scelta della destinazione, oppure un comando. Serve un plugin client oltre a quello host.
2. **Id**: generare `session-<uuid>` invece di lasciare l'id automatico (il POC ha ottenuto `session-1`).
3. **Originale**: nasconderlo, non cancellarlo (`workspaceRegistry` ha `hide`/`restore`), così lo spostamento è reversibile.
4. **Aviso esplicito** su cosa non viaggia (soprattutto `AGENTS.md`), prima della conferma.
5. **Verifica**: dopo la creazione, materializzare la sessione (primo append) per accertarsi che compaia su disco sotto la cartella del nuovo workspace.
6. **Verifica aperta**: la sidebar si riaggiorna a caldo dopo la creazione, o serve un riavvio?

## Come riprendere

- La cartella canonica del progetto sarà `C:\Users\m.soricetti\Documents\GitHub\dsh-locale-it` (oggi contiene il language pack, non questo plugin) oppure una nuova directory da decidere.
- **Aprire la sessione futura con quel workspace**, non con `default-workspace`: questa sessione qui non può scrivere fuori da `default-workspace` (sandbox), e il POC è nato dentro.
- Comandi utili:

```powershell
# rimuovere il probe dal profilo (a lavoro finito)
dsh plugin --profile web remove dsh-session-mover-probe

# ispezionare le sessioni su disco
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Directory
```

## Riferimenti

- `@deepseek-ai/dsh-session` — README (fork, seed/restore, eventi) e `lib/types/index.d.ts`
- `@deepseek-ai/dsh-workspace` — README: raggruppamento per directory, `hide`/`restore`
- `@deepseek-ai/dsh-session-persistence-jsonl` — README: layout su disco, creazione pigra
