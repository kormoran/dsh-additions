# Changelog

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
