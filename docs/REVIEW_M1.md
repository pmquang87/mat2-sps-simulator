# Abschluss-Review Meilenstein 1 & Weiterentwicklungs-Roadmap

Datum: 2026-07-27 · Prüfer: Claude (Fable 5, Orchestrator) · Stand: Commit `7addade`

## 1. Prüfergebnis: **BESTANDEN**

Meilenstein 1 („alle im Praktikum verwendeten SPS-Funktionen nachbilden") ist erfüllt und
unabhängig verifiziert.

### 1.1 Erstgeprüfte Beweise (nicht nur Agentenberichte)
| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | 0 Fehler |
| `npx vitest run` | **698/698 Tests grün** (52 Dateien) |
| `npm run gates` (typecheck→lint→test→build) | Exit 0 |
| `npx vite build` | Ein-Datei-Bundle `dist/index.html`, 1,22 MB (gzip 345 kB) |
| Browser-Smoke (standalone `file://`) | 0 Konsolenfehler, WebGL aktiv, EN-Default, DE-Umschalter inkl. Persistenz verifiziert |
| Stichprobe `src/core/timers.ts` | SI/SV/SE/SS/SA-Semantik entspricht Anleitung IV.2.6 (Nachtriggerung SV, SS-Latch + Pflicht-Reset, SA-Abfallverzögerung) |
| Stichprobe Hint-Bibliothek (A-NW8) | 3 Stufen (Konzept → neutrales Muster + sokratische Fragen → Checkliste); Musterblöcke mit bewusst abweichenden, neutralen Operanden — **kein Lösungs-Leak** |

### 1.2 Härte der Abnahme (Oracle-Phase)
- **Mutationsprüfung:** 26 Weichenzuordnungen (G/R→Fahrweg) einzeln invertiert; 8 nur
  „geschleppte" Weichen waren im Reed-/Speed-Ablauf unsichtbar → durch exakte
  `switchTrailed`-Multiset-Erwartung geschlossen; permanente Mutationskontrollen verankert.
- **Anti-Vakuitäts-Selbsttests:** jeder Abnahme-Matcher muss ein absichtlich falsches Log in
  beide Richtungen ablehnen; Release-Guard mit positiver Kontrolle (Stub-`dist/` schlägt fehl).
- **Entprell-Realismus:** xR01D erzeugt nachweislich 3 steigende Flanken pro Überfahrt —
  das Entprell-Netzwerk wird real belastet, nicht nur formal.
- **Determinismus:** Zwei Läufe ⇒ byte-identische Ereignislogs (Seed-PRNG, Ganzzahl-Simzeit,
  keine Wanduhr unterhalb `app/`).
- **Lösungsschutz:** Lösungen (`reference/Claude_work/`) nur zur Testzeit per `fs` geladen, saubere
  Skips bei Abwesenheit (empirisch geprüft); `no-bundle`-Guard scannt `src/`, committete
  `docs/` und das gebaute Bundle; lösungsabgeleitete Dokumente sind lokal und aus der
  Git-Historie entfernt.

## 2. Bekannte Grenzen und dokumentierte Annahmen
1. **7 unplatzierte Weichen** (xW01/04BH1G3, xW01/04BH1G4, xW01/04BH3G2, xW01C): in der
   Variablenliste, aber ohne Position im Gleisplan. Kommando → lokalisierten Warnhinweis
   (`W-SWI-001`), keine Anlagenreaktion. Klärung nur am realen Versuchsstand möglich.
2. **7 von 36 platzierten Weichen** tragen `mappingSource: "assumed"` (von keiner Aufgabe
   „spitz" befahren); xW04D ist prinzipiell nicht ableitbar und durch die
   A-Erwartung gepinnt — Änderung nur als bewusste Doppel-Änderung.
3. **AW-6-Kodierung, Beschleunigungs-/Bremsrampen, Reed-Fensterbreite**: nirgends
   dokumentiert → als Simulationskennlinie frei definiert (Annahmenregister in
   ARCHITECTURE.md).
4. **3D-Optik nicht per Auge geprüft**: Die Browser-Ansicht dieser Session compositet nicht;
   programmatisch verifiziert (Szene baut, rendert, 81+ Objekte). → Bitte `dist/index.html`
   öffnen und Tunnellage, Beschriftungslesbarkeit und die 4 Kameras begutachten.
5. **rAF-Uhr**: Simulation pausiert in verstecktem Tab (gewollt, deterministisch) — im
   README vermerkt.
6. **Keine CI**: Gates laufen lokal (`npm run gates`, `npm run release-check`); ein Hook oder
   eine CI wären der nächste Absicherungsschritt.

## 3. Weiterentwicklungs-Roadmap

### Meilenstein 2 — erweiterte SPS-Unterstützung (Fundament liegt bereits)
- **Bausteinmodell**: FC/FB/DB/UDT + `CALL`, Instanz-DBs, OB-1-Skelett sichtbar machen
  (FahrstromFB/WeichenFB als echte Bausteine statt Wiring-Magie) — Erweiterungspunkte in
  ARCHITECTURE.md §11 sind vorbereitet (Op-Handler-Tabelle, Statuswort).
- **Zyklus-Inspektor** (§10.5, Interface existiert): Einzelschritt durch Anweisungen mit
  VKE/Akku/ERAB-Anzeige — das stärkste Lehrwerkzeug für die Boolesche Algebra.
- **Watch-Forcing** (§10.4): Reed-Impulse und Notaus aus der Watch-Tabelle antippen.
- Arithmetik (+I, −I, *I, /I), Transfer auf mehr Ziele, Sprünge erweitert, `X`/`XN`-Übungen,
  Statuswort-Bits (VKE/STA/OR/…), Diagnose „Doppelzuweisung".
- **OPAL-Roundtrip**: Export als abgabefertige txt (identisches Format wie der
  Atom-Workflow) und Import realer Studierenden-Dateien.
- **FUP/KOP-Ansicht** (readonly zunächst): dieselben Netzwerke grafisch — DIN-EN-61131-Bezug
  der Anleitung.

### Meilenstein 3 — Szeneneditor
- Trackplan-Editor in-app (Knoten/Kanten/Weichen/Reeds platzieren), gemeinsamer Validator
  mit `tools/validate-trackplan.ts`, Speichern/Laden eigener Anlagen als JSON.
- Damit lösbar: die 7 unplatzierten Weichen einpflegen, sobald jemand den realen Aufbau
  fotografiert/vermisst; alternative Übungsanlagen für andere Semester.

### Darüber hinaus (Ideen, priorisiert)
1. **Autograder**: Die 66 BehaviorChecks decken bereits alle 22 Netzwerke ab — Punktevergabe
   (27P-Schema) + PDF/CSV-Export für Betreuer wäre ein kleiner Schritt.
2. **Replay & Scrubbing**: Ereignislog aufzeichnen, Zeitleiste ziehen, Fehlermoment
   zurückspulen (Determinismus macht das trivial korrekt).
3. **Klassenraum-Modus**: Lehrer-Dashboard (welche Gruppe hängt an welchem Netzwerk),
   gemeinsame Anzeige der Anlage per Screenshare/Artifact.
4. **Thementag-Integration**: Theorie-Quizfragen (Datentypen, Flanken, Zeitfunktionen) aus
   den Thementag-Aufgaben als interaktive Selbsttests vor den Netzwerken.
5. **Weitere Sprachen**: i18n-Schicht ist typisiert und total — EN/DE heute, weitere
   Wörterbücher sind reine Fleißarbeit.
6. **Hardware-Brücke**: OPC-UA/S7comm-Proxy, um dasselbe Studentenprogramm gegen eine echte
   S7-313C laufen zu lassen (Simulator als Vorstufe zum Präsenztermin).
7. **PWA/Offline**: Manifest + Service-Worker aufs Ein-Datei-Bundle — installierbar auf
   Studierenden-Laptops ohne Netz.
8. **Barrierefreiheit vertiefen**: ARIA-Struktur der Panels, Tastaturpfade im 3D-Viewport,
   Kontrastprüfung beider Themes.
9. **Signale/Optik**: Lichtsignale, Sound (Weichenklack, Fahrgeräusch), Tag/Nacht — reine
   Motivationspflege, klar hinter 1–4 einzuordnen.

### Kurzfristig empfohlen
1. `dist/index.html` öffnen und die 3D-Optik begutachten (Punkt 2.4).
2. Entscheidung xW04D-Zuordnung dokumentieren lassen (Betreuer fragen) — betrifft
   `trackplan.json` + beide Erwartungsdateien.
3. Optional: Git-Hook oder CI für `npm run gates` + `release-check`.
