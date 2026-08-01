# Visuelle Begutachtung der 3D-Szene (2026-07-27)

Durchgeführt im echten Chrome (compositing) gegen den Dev-Server, alle vier Kameramodi.
Damit ist der offene Punkt 2.4 aus `REVIEW_M1.md` abgeschlossen.

## Positiv bestätigt

| Prüfpunkt | Ergebnis |
|---|---|
| Topologie vs. Gleisplan | **Bird-Ansicht deckt sich mit `Gleisplan SPS.pdf`**: ineinanderliegende Ringe A/B, Kehrschleife K links um den See, BH2 oben (5 Gleise), BH1-Kopf unten, BH3 Mitte-rechts, Gleise D/E rechts |
| Landschaft vs. Video | **Badesee mit felsiger Insel**, graues MFD-Gebirge mit **Aussichtsturm** (gelblich), Tannen, **roter Backstein-Lokschuppen** an der Plattenkante, Bahnhofsgebäude mit dunkelrotem Dach — alles wie in `video_design.md` beschrieben |
| Zug | Bordeaux-Lok mit silbernem Dach und hellem Zierstreifen + zwei rot-weiße Wagen — entspricht der Videobeschreibung (BR 119/219-Anmutung) |
| Beschriftungen | **lesbar**: Bahnhofstafel „BH1" in der Lokführer-Ansicht, „G2" und Reed-Namen (z. B. xR01BH1G1) in der Streckenkamera |
| Weichenlage-Anzeige | rote/grüne Stellungsmarker an den Weichen sichtbar |
| Kameras | Orbit, Bird, Cab, Trackside schalten fehlerfrei; Cab zeigt Schwellenband bis zum Horizont |
| Startzustand | Einstiegsbeispiel geladen, Meldungsliste „No messages." — der warnungsfreie Starter greift |

## Gefundene Defekte

### D1 (major) Streckenkamera: schwarzer Keil verdeckt das untere Bildviertel
In der **Trackside**-Ansicht ragt ein großes schwarzes Dreieck von unten ins Bild. Ursache
mit hoher Wahrscheinlichkeit: die Kameraposition liegt **innerhalb eines Gebirgs-Kegels**,
sodass dessen Rückseiten (unbeleuchtete Innenfläche) gerendert werden — genau das Risiko,
das der Szenen-Agent als „mountain cones that will bury non-tunnel track inside their
radius" selbst notiert hatte. Wirkung: die didaktisch wichtigste Perspektive (Zug fährt am
Geber vorbei) ist teils blind.

### D2 (major) 3D-Viewport kollabiert bei schmalem Fenster
Bei Fensterbreiten bis ca. 1100 px stapelt das Layout die Spalten, und der Viewport-Container
hat `min-height: 0` bei `flex: 0 1 auto` → das Canvas schrumpft auf einen ~40 px hohen
Streifen (gemessen: Canvas-CSS-Höhe 40 px bei Fenster 1063 px; bei 1911 px korrekt 863×470).
Auf Studierenden-Laptops mit 13″-Display ist die Anlage damit praktisch unsichtbar.

### D3 (minor) Gebäudeplatzierung nahe am Gleis
In der Cab-Ansicht steht das Bahnhofsgebäude sehr dicht am Nachbargleis und scheint dessen
Bahnsteig-/Gleisbereich zu berühren. Kein Funktionsfehler (Kollisionen sind nicht simuliert),
aber optisch prüfen.

### D4 (minor, bekannt) Beschriftungsplatten liegen flach
Weichen-/Reed-Schilder sind flache Platten auf der Platte statt kamerazugewandter Sprites;
aus schrägen Winkeln sind sie stark verzerrt lesbar. Bewusste Abweichung des Szenen-Agents,
hier bestätigt: in Cab/Trackside noch lesbar, in Orbit/Bird nicht.

### D0 Falschdiagnose des Orchestrators (zur Ehrlichkeit protokolliert)
Die unten stehende Erstvermutung zu D1 („Kamera steckt in einem Gebirgskegel") war **falsch**.
Der Szenen-Agent hat sie aus der Geometrie widerlegt (kleinster Abstand Stativ↔Kegelachse
0,755 m bei r = 0,252 m) und die wahre Ursache gefunden: Stativ 2 stand im Bahnhofsgebäude,
zusätzlich waren alle Satteldächer invers gewickelt. Lehre: eine plausible Ursache ist kein
Befund — die Geometrie musste nachgerechnet werden.

### D5 (major) Tunnelportal nicht sichtbar
Nutzermeldung: „das Tor in den Gebirgstunnel ist nicht sichtbar". In Orbit/Bird läuft das
Gleis auf das Massiv zu und verschwindet in der grauen Kegelfläche — kein erkennbarer
Tunnelmund.

---

## Behebung (2026-07-27)

Eigentümer: `src/scene/**`, `src/ui/styles.css`, `tests/scene/**`. `src/data/trackplan.json`
wurde **nicht** verändert (read-only), alle Korrekturen sind szenenseitig und deterministisch.

### D1 behoben — Streckenkameras stehen jetzt nachweisbar frei

**Ursache (aus der Geometrie belegt, nicht geraten):** Der schwarze Keil war *kein*
Gebirgskegel. Kein Stativ liegt innerhalb eines Kegels (kleinster Abstand Stativ↔Kegelachse
0,755 m bei r = 0,252 m). Stattdessen stand **Stativ 2 mitten im Bahnhofsgebäude BH1**:
Gebäudemitte Welt (0,000 | 0,935), Stativ (0,000 | 0,951) — 16 mm Abstand, Linse 36 mm über
dem Dachfirst. Ein headless Raycast-Rendering (78 × 26 Strahlen) über die Trackside-Kamera
zeigt das Gebäude als **von unten ins Bild wachsendes Dreieck**: 166 px im Startzustand,
1665 von 2028 px im ungünstigsten Zuglauf.

Zweitursache, die die Fläche schwarz machte: `gableRoofGeometry()` war **komplett invers
gewickelt** — alle sechs Vertexnormalen zeigten nach unten (y ≈ −0,85, numerisch geprüft).
Damit waren alle Satteldächer Backfaces, wurden weggeculled, und man sah die vom Firstdach
verschattete Oberseite des Wandkastens statt eines Dachs.

**Fix (Variante a + b + c):**
- `tracksideTripodPositions()` (`cameras.ts`) berechnet die vier Stative jetzt mit einem
  Freiheitstest gegen alle Szenerie-Grundflächen (`sceneryFootprints()`: Gebirge, See,
  Gebäude, Notaus-Leuchte) und schiebt ein blockiertes Stativ deterministisch entlang seiner
  eigenen Plattenkante, bis ≥ 90 mm Luft sind.
- Dachwicklung korrigiert (Normalen zeigen nach außen), Massiv als Höhenfeld mit garantiert
  nach oben gewickelten Quads (siehe D5) — eine Kamera *kann* keine unbeleuchtete Rückseite
  mehr sehen.
- Near-Plane-Prüfung im Test: Freiraum > 4 × Near-Plane (0,01 m).

**Nachher gemessen** (Stativ → Szenerie-Freiraum): 0: 190 mm, 1: 811 mm, 2: 190 mm,
3: 385 mm. Stativ 2 wanderte von x = 0,000 auf x = 0,280. Geländehöhe unter allen vier
Stativen = 0. Raycast-Nachmessung: **0 px** Gebäude im Bild von Stativ 2 (vorher 166 bzw.
1665 px); von jedem Stativ ist das Nachbargleis in ≤ 0,2 m Abstand unverdeckt sichtbar
(Test `tests/scene/cameras.test.ts`).

### D2 behoben — Viewport kollabiert nicht mehr

**Ursache genauer als vermutet:** nicht `flex: 0 1 auto`, sondern die Grid-Zeilen. Im
gestapelten Layout (`max-width: 1080px`) hatte `.app-main`
`grid-template-rows: minmax(260px,2fr) minmax(260px,2fr) minmax(180px,1fr)` — und die
rechte Spalte (3D + Watch) ist das **letzte** DOM-Kind, landet also in der *kleinsten* Zeile
(180 px). Davon nimmt `.app-column-right`'s zweite Zeile `minmax(140px, 2fr)` 140 px, für den
Viewport bleiben 30 px → Canvas 28 px.

**Fix** (nur in den beiden Media Queries, das breite 3-Spalten-Layout ist unberührt):
Zeilenminima so gesetzt, dass der Viewport ≥ 360 px hoch ist, `.app-shell` darf über die
Fensterhöhe hinauswachsen (`height: auto; min-height: 100%`) — die Seite scrollt statt den
Viewport zu quetschen —, und im gestapelten Layout steht der 3D-Viewport per `grid-row: 1`
**oben**. Wichtig: Zeilenmaximum ist `vh`, nicht `fr`; mit unbestimmter Höhe fallen `fr`-
Tracks auf max-content zurück (gemessen: Canvas 863 × 1929).

**Gemessen im echten Chrome** (`getBoundingClientRect()` des Canvas, Dev-Server):

| Fenster | vorher | nachher |
|---|---|---|
| 900 × 800 | 878 × **28** | 863 × **358** |
| 1024 × 768 | 987 × **28** | 987 × **358** |
| 1024 × 600 | 987 × **28** | 987 × **358** |
| 1280 × 800 | 727 × 252 | 718 × **358** |
| 1600 × 900 | 718 × 447 | 718 × 447 (unverändert) |
| 1920 × 1080 | 866 × 555 | 866 × 555 (unverändert) |

### D3 bestätigt und behoben — Gebäude standen wirklich im Gleis

Kein perspektivischer Trugschluss. Minimaler Abstand Gebäude-Grundfläche ↔ Gleisachse:
**BH1 5,6 mm**, BH2 2,1 mm, BH3 9,1 mm — bei 15 mm Schotter-Halbbreite stehen die Wände also
auf dem Schotter, und deutlich innerhalb des Bahnsteigprofils (24…44 mm).

`buildingPlacements()` schiebt jede Grundfläche jetzt entlang der Normalen ihres nächsten
Gleises nach außen (auf der Platte geklemmt) und modelliert Bahnhofsgebäude schmaler, wenn
der 26-pt-Plattenrand Bahnsteig *und* 72 mm tiefes Gebäude nicht trägt. Nachher:

| Gebäude | vorher | nachher | Maße nachher |
|---|---|---|---|
| Bahnhof BH1 (480/537) | 5,6 mm | **44,4 mm** | 175 × 40 × 46 mm, Pos. (480/543,5) |
| Bahnhof BH2 (560/4) | 2,1 mm | **44,4 mm** | 175 × 40 × 46 mm, Pos. (560/−3,5) |
| Bahnhof BH3 (600/172) | 9,1 mm | **44,2 mm** | 175 × 72 × 58 mm, Pos. (600/162) |
| Lokschuppen | 68,7 mm | 68,7 mm | unverändert |
| Bäckerei | 158,1 mm | 158,2 mm | unverändert |

44 mm = `platformOffset + platformWidth`, d. h. die Gebäudewand sitzt an der *hinteren*
Bahnsteigkante — dort, wo ein Empfangsgebäude hingehört.

### D5 behoben — echte Tunnelmünder, plus ein Datenbefund

**Befund zur Datenlage (bitte entscheiden):** Gleis läuft sehr wohl durch die Gebirgs-
Grundflächen — aber viel mehr als deklariert. Innerhalb der Kegelradien liegen die Kanten
`e44` (8 von 10 Stützpunkten), `e49`, `e52`, `e69`, `e73`, `e74`, `e86` — alle **nicht** als
Tunnel deklariert. Ein aus reinen Kegeln gebautes Massiv begräbt damit ≈ 1,9 m offenes Gleis
inklusive der Weiche an `n55` (Deckung dort 121 mm) — und jedes Portal. Besonders:
`e48` (als Tunnel deklariert) ist **kollinear** mit den offenen Kanten `e49`/`e52` auf
x = 281,5; die drei bilden eine durchgehende Gerade. `e48` kann daher kein Tunnel sein, ohne
`e49`/`e52` mit-zu-deklarieren oder das Massiv zu verkleinern. **`e48` erhält folglich kein
Portal**, `e68` sehr wohl.

**Fix:** Das Massiv ist kein Kegelhaufen mehr, sondern **ein Höhenfeld**
(`buildTerrain()`/`buildMassif()`): Maximum aus Haupt- und Satellitenkegeln, anschließend
entlang jeder *offenen* Gleistrasse zu einem Felseinschnitt weggeschnitten (Sohle ±31,5 mm,
Wandflanke 35 mm, Smoothstep). Ein Mesh für alle Massive (kein Z-Fighting in der
Überlappung), Quads per Konstruktion nach oben gewickelt, Quads auf Plattenhöhe entfallen
(Einschnittsohle bleibt Wiese).

`findPortalSites()` läuft jede Tunnelkante ab und nimmt jede Stelle, an der die *geschnittene*
Geländehöhe die nötige Felsdeckung (54 mm = Portaloberkante 46 mm + 8 mm Gitterreserve)
kreuzt — bisektiert auf 0,1 mm. Nichts ist hartkodiert. Das Portal steht als Mauerrahmen
(zwei Pfeiler + Sturz + Deckplatte, dunkleres `rockDark` als Kontrast zum Massiv) mit einer
unbeleuchteten Bohrung von 90 mm Tiefe darin.

**Nachher gemessen:**

| | Position (Plan) | Felsdeckung am Mund | Ausrichtung |
|---|---|---|---|
| Einfahrt `e68` @ 183,1 mm | (294,3 / 251,5) | 54,0 mm | Yaw 65,7° = lokale Gleistangente |
| Ausfahrt `e68` @ 500,1 mm | (365,8 / 200,9) | 54,1 mm | Yaw 6,3° = lokale Gleistangente |

Bohrungslänge 317 mm. 40 mm vor dem Mund ist die Deckung < 46 mm (Mund öffnet ins Freie),
40 mm dahinter ≥ 113 mm. Raycast-Nachweis: von der Anfahrt sind Portalpixel im Bild und das
Gleis läuft in die Öffnung; in der Bird-Ansicht ist der Einschnitt samt Deckplatte sichtbar.
Der Test `tests/scene/terrain.test.ts` prüft zusätzlich, dass **keine** offene Trasse tiefer
als die Schienenoberkante (5,6 mm) im Fels liegt.

### Neue Tests

- `tests/scene/cameras.test.ts` (6 Tests): Stativhöhe/Plattengrenzen, außerhalb jeder
  Gebirgs-Grundfläche + über Grund, Szenerie-Freiraum ≥ 90 mm und ≫ Near-Plane,
  Raycast „Nahgleis sichtbar", Ausweichen eines blockierten Stativs.
- `tests/scene/terrain.test.ts` (8 Tests): Höhenfeld flach/hoch, kein begrabenes offenes
  Gleis, ein einziges nach außen gewickeltes Massiv-Mesh, Dachnormalen nach außen,
  Portalanzahl = unabhängig nachgezählte Deckungswechsel, Portal auf der Felswand
  (nicht begraben), Portalausrichtung = Gleistangente, kein Portal ohne Deckung.

`npm run gates`: typecheck ✓, eslint ✓, vitest 779/779 in 56 Dateien ✓, vite build ✓.

---

## Datenentscheidung des Orchestrators zu D5 (2026-07-27)

Der Szenen-Agent hat die Inkonsistenz korrekt aufgedeckt: `e48` war als Tunnel deklariert,
ist aber kollinear mit den *offenen* Kanten `e49`/`e52` auf der C-Vertikalen (x = 281,5) und
konnte deshalb kein Portal bekommen — ein deklarierter Tunnel ohne Tunnelmund.

**Entscheidung: `e48` aus `landscape.tunnels[0].edgeIds` entfernt; der Tunnel ist allein
`e68`.** Begründung (didaktisch, nicht optisch):

- Innerhalb der Hauptkegel-Grundfläche (Zentrum 300/268, r = 95 pt) liegen **zwei
  Weichenknoten**: `n55` (Abstand 38,4 pt, = `xW02C`) und `n51` (73,1 pt). Ein *Tunnel* über
  der C-Vertikalen würde diese Weichen im Fels begraben.
- Genau das darf nicht passieren: die weißen Beschriftungsschilder und die sichtbare
  Zungenbewegung sind der didaktische Kern der Anlage (vgl. `video_design.md`: „Vergiss nicht
  die kleinen weißen Aufkleber … da diese das Bindeglied zur SPS-Programmierung sind").
  Eine Weiche, die man nicht sehen kann, ist als Lernobjekt wertlos.
- Die Alternative „Massiv verkleinern" wurde verworfen: um beide Knoten freizustellen, müsste
  der Radius unter 38 pt fallen — das Gebirge wäre kein Massiv mehr und der im Video gezeigte
  Berg mit Aussichtsturm ginge verloren.
- Die vom Agenten gebaute Lösung ist die modellbahnübliche und wird beibehalten: **großes
  Massiv als Höhenfeld, Felseinschnitt (offener Trog) entlang der Trassen, die sichtbar
  bleiben müssen, echte Bohrung mit Portal dort, wo ein Tunnel deklariert ist.**
- Aufgabe B („Nach Durchfahrt des Tunnels", ausgelöst an `xR01BH3G2`) bleibt erfüllt: `e68`
  führt von `n55` in Richtung BH3 durch das Massiv und hat jetzt zwei vermessene Portale.

Geprüft: kein Test kodiert `e48` als Tunnel (`tests/data/trackplan.test.ts` fordert nur
nichtleere, existierende Tunnelkanten), Gates nach der Änderung erneut grün.

**Nachtrag des Szenen-Agents:** `e48` trug in `edges[]` weiterhin `"tunnel": true`. Da
`edges` read-only ist, ist `landscape.tunnels` jetzt **die** maßgebliche Quelle:
`tunnelEdgeIds()` nimmt die per-Kante-Flagge nur noch als Fallback, wenn
`landscape.tunnels` leer ist. Ohne das hätte die Flagge `e48` still weiter begraben und die
Entscheidung oben unterlaufen. `SceneManager` benutzt denselben Helper.

---

## D6 (major, vom Nutzer per Screenshot bestätigt) Zu viel Gleis im Fels — behoben

Nutzerbefund: zwischen zwei Portalen verschwindet eine lange Gleisstrecke vollständig im
Massiv. Messung bestätigt: `e68` war über die **volle Länge (158 pt = 553 mm)** von der
Kegel-Grundfläche überdeckt, nach dem Einschnitt-Carve noch 101,6 pt (356 mm) tatsächlich
begraben — auf einer 960 pt breiten Platte.

### Was geändert wurde

**1. `landscape.mountains` neu modelliert** (die einzige erlaubte Datenänderung, zusammen mit
`landscape.tunnels`). Statt zweier riesiger Kegel (r = 95 / 72) jetzt **fünf überlappende
Hügel**, die den Gleisplan respektieren:

| # | Zentrum (Plan) | r [pt] | h [pt] | Rolle |
|---|---|---|---|---|
| 1 | 300 / 255 | 42 | 52 | Gipfel: trägt den **Aussichtsturm** und die Bohrung |
| 2 | 352 / 296 | 58 | 42 | großer Südost-Rücken (gleisfreie Fläche) |
| 3 | 231 / 193 | 46 | 38 | West-Lobe (gleisfreie Tasche westlich der C-Vertikalen) |
| 4 | 326 / 325 | 32 | 28 | Süd-Schulter, bricht die Silhouette |
| 5 | 382 / 258 | 30 | 24 | Nordost-Schulter |

Hügel 2–5 berühren **keine** Trasse; nur Hügel 1 überquert `e68` (und schneidet die
C-Vertikale `e49` als Felseinschnitt). Massiv-Ausdehnung 185…412 × 147…357 pt
(795 × 735 mm) — flächig größer als das alte Gebirge, nur nicht mehr über dem Gleis.

**2. Höhenprofil Kegel → Smoothstep.** `h = H·smoothstep(1 − d/r)`: flacher Gipfel (der
Aussichtsturm steht waagerecht statt auf einer 58°-Flanke), flacher Fuß (kein Knick zur
Platte), und die überdeckte Strecke ist bei gleichem Radius ~10 % kürzer. Die
„zerklüftete" Silhouette kommt jetzt aus den überlappenden Hügeln der Daten, nicht mehr aus
hartkodierten Satellitenkegeln (entfernt).

**3. Einschnittwand von 35 mm auf 21 mm verschmälert** (`CUT_FALLOFF_PT` 10 → 6). Eine breite
Wand reicht bis in den Gipfel 65 mm daneben und ließ den Turm auf einer 79°-Schräge stehen
(Fußabfall 124 mm). Ein geblasener Felseinschnitt ist ohnehin nahezu senkrecht.
Terrain-Gitter dafür auf 2,5 pt (8,75 mm) verfeinert — Massiv 7222 Dreiecke.

**4. Gebäude stehen auf dem *tiefsten* Punkt ihrer Grundfläche**, nicht auf der Mitte: an
einem Hang gräbt sich die bergseitige Wand ein (liest sich als in den Hang gebaut) statt die
talseitige zu schweben.

**5. Bohrung als gefegte Röhre** entlang der Gleiskurve zwischen den beiden Portalen statt
eines geraden Kastens pro Portal — `e68` dreht zwischen den Mündern 20°, ein Kasten wäre
seitlich aus dem Fels gebrochen. `mats.tunnelDark` ist jetzt `DoubleSide`, damit die Röhre
von außen *und* von innen schwarz liest.

**6. Zug wird nach Felsdeckung ausgeblendet, nicht nach Kante.** Vorher blendete
`SceneManager` den Zug über die *gesamte* Tunnelkante aus — 553 mm, davon nur 161 mm wirklich
im Fels; der Zug verschwand also bei hellem Tageslicht. Jetzt ab
`TRAIN_HIDE_COVER_MM` = 35,6 mm Deckung (Wagendachhöhe): flacher davor verdeckt das Massiv
selbst nur den unteren Teil des Fahrzeugs — genau wie eine Einfahrt in einen Tunnelmund.

### Messwerte vorher/nachher

| Größe | vorher | nachher |
|---|---|---|
| `e68` begraben (Deckung > SOK) | 101,6 pt = 356 mm | **46,0 pt = 161 mm** |
| `e68` Zug unsichtbar | 158,0 pt = 553 mm (ganze Kante) | **35,1 pt = 123 mm** |
| Portalabstand | 90,5 pt = 317 mm | **30,6 pt = 107 mm** |
| max. Felsdeckung über `e68` | 149 mm | 166 mm |
| offene Kanten begraben | 0 pt (Einschnitt) | 0 pt |
| offene Kanten: Terrain an der Schotterkante | bis 47,1 mm | **0,0 mm** |
| Massiv-Mesh über offener Trasse (Raycast von oben) | — | **0,00 mm (kein Treffer)** |
| Reeds/Weichen mit Deckung > SOK | 0 | **0** |
| Aussichtsturm Standhöhe | 174 mm | **182 mm**, Fußabfall 5/13/5/5 mm |
| Stativ-Freiräume | 190/811/190/385 mm | 190/811/190/385 mm (unverändert) |

Portale nachher: `e68` @ 48,5 pt, Plan (292,7 / 255,0), Deckung 54,2 mm, Yaw 65,7° = lokale
Gleistangente, Einfahrt; `e68` @ 79,1 pt, Plan (310,5 / 230,3), Deckung 54,1 mm, Yaw 45,9°,
Ausfahrt. Bohrung 107 mm, über die ganze Länge ≥ 36 mm Deckung (Röhrendach).

### Offene Kanten: „sichtbar", nicht nur „ausgeschnitten"

Zwei unabhängige Messungen, beide als Test verankert:
1. **analytisch** — Höhenfeld an Achse und beiden Schotterkanten (±15 mm) für jede
   Nicht-Tunnel-Kante alle 5 mm: **überall 0,0 mm** (≤ SOK 5,6 mm gefordert);
2. **am Mesh** — Strahl von y = 1 m senkrecht nach unten auf das Massiv-Mesh über denselben
   Punkten: **kein einziger Treffer**, das Massiv existiert über offener Trasse gar nicht.

Zusätzlich: jeder Reed und jeder Weichenknoten steht auf Höhe ≤ SOK — die didaktisch
zentralen Schilder und Zungen sind ausnahmslos im Freien. Nur an `e49` erreicht das Terrain
52 mm *seitlich* in Bahnsteigabstand (44 mm) — dort gibt es keinen Bahnsteig (der einzige
Reed `xR02C` bildet kein `BHnGm`-Paar), das ist die Einschnittwand.

### Neue Tests (`tests/scene/terrain.test.ts`, jetzt 13 Tests)

- `never buries open track, over the full ballast width` — analytisch, > 3000 Stichproben
- `leaves the massif mesh entirely clear of open track (bird camera sees rails)` — Raycast
- `keeps every reed and switch node in daylight`
- `stands the Aussichtsturm on a summit, not on flat grass` — Höhe ≥ 100 mm und Fußabfall
  < 20 mm auf Turmradius
- `keeps every bore short: the train is only briefly out of sight` — ≤ 70 pt pro Tunnelkante
- `lines every bore between a paired entry and exit mouth` — Paarung, Deckung ≥ Röhrendach,
  eine gefegte Röhre pro Bohrung im Szenengraph

---

## D7 (visuelle Regression) Aussichtsturm zur Hälfte im eigenen Gipfel — behoben

Meldung: „Aussichtsturm auf dem Massiv nicht mehr zu finden". **Es war wirklich etwas kaputt**,
aber nicht das vermutete Verschieben.

### Messung (vorher)

Der Turm **existierte** im Szenengraph und stand **exakt richtig**: Weltposition
(−0,630 | −0,052) = Planpunkt (300 / 255). Die in D3 eingeführte Gleis-Verschiebung war also
nie das Problem — Türme sind in `buildingPlacements()` von Anfang an ausgenommen
(`if (full.tower) … pt: spec.pt`). Verdachtsmechanismus 1 ist damit ausgeschlossen.

Schuldig war Mechanismus 2, die D6-Änderung „Gebäude stehen auf dem tiefsten Punkt ihrer
Grundfläche". `groundUnderFootprint()` tastete die **Ecken der 40 × 40 mm Bounding-Box** ab,
also 28,3 mm von der Achse — der Turmschaft ist aber ein Zylinder mit **15 mm** Fußradius.
Zwei dieser Ecken lagen im Felseinschnitt der C-Vertikalen:

| Tastradius | Ost / West / Süd / Nord | |
|---|---|---|
| 15 mm (echter Fußradius) | 177 / **169** / 177 / 177 mm | brauchbar |
| 20 mm | 173 / **122** / 173 / 173 mm | Wand erreicht |
| 28,3 mm (Box-Ecken) | 165 / **28** / 165 / 165 mm | Einschnittsohle |

Ergebnis: Basis auf **114,9 mm** statt 182 mm gesetzt → **67 mm der 157 mm Turmhöhe (43 %)
im eigenen Gipfel versunken**. Sichtbar blieb ein 63-mm-Stummel Schaft plus Plattform und
Kappe — ein Pilz statt eines schlanken Turms.

### Fix

1. `buildingShape('aussichtsturm')` beschreibt jetzt die **echte** Geometrie
   (`CylinderGeometry(11, 15, 130)`): 30 × 30 mm Grundfläche, 157 mm Höhe — nicht mehr die
   40 mm der Aussichtsplattform.
2. `groundUnderFootprint()` tastet **runde** Grundflächen auf den Achsen ab, Kästen weiter an
   den Ecken. Ein Zylinder hat keine Ecken; die Bounding-Box-Ecke greift 41 % weiter hinaus
   als das Bauwerk steht.

### Messwerte vorher/nachher

| Größe | vorher | nachher |
|---|---|---|
| Turm im Szenengraph | vorhanden | vorhanden |
| Weltposition | (−0,630 \| −0,052) = Plan (300/255) | unverändert |
| Basis (Bauwerksfuß) | 114,9 mm | **169,3 mm** |
| Dachspitze | 271,9 mm | **326,3 mm** |
| Gelände unter der Achse | 182,0 mm | 182,0 mm |
| **Überstand über das höchste Gelände der Grundfläche** | **89,9 mm** | **144,3 mm** |
| im Gelände versunken | 61,8 mm (39 %) | **12,7 mm (8 %)** |
| sichtbarer Schaft | 63 mm | **117 mm** |
| Strahlen auf den Turm, Orbit (10 920 Strahlen) | 2 | **5** |
| Strahlen auf den Turm, Bird (10 920 Strahlen) | 2 | 2 (unverändert) |

Zum Vergleich: vor der D6-Umformung betrug der Überstand ≈ 128 mm. Der Turm ist jetzt also
**prominenter als vor der Umformung**.

Dass die **Bird**-Zahl gleich bleibt, ist der eigentliche Lehrsatz dieses Defekts: eine
Senkrechtansicht sieht nur die Grundrissfläche der Plattform, ganz egal wie tief der Schaft im
Fels steckt. „Geländehöhe ≥ 100 mm" plus „mindestens ein Bird-Strahl" hätte das Absinken
also **nicht** gefunden — nur die Überstandsmessung findet es.

### Ehrliche Einordnung der Größe

Auch nach dem Fix ist der Turm ein **kleines** Objekt: die Plattform ist 38 mm breit auf einer
3360 mm breiten Platte, in einer Vollansicht mit 866 px also ≈ **10 px breit** und ≈ 30 px
hoch. Auf einem JPEG ist das ein blassgelber Strich am linken Massiv — leicht zu übersehen,
selbst wenn alles stimmt. Er steht auf dem westlichsten, höchsten Hügel (Zentrum Plan
300/255), unmittelbar östlich des Felseinschnitts der C-Vertikalen.

### Mitgeprüft: Insel und Portale

Vollbild-Raycast (130 × 84 = 10 920 Strahlen je Kamera, komplette Szene):

| Objekt | Bird | Orbit |
|---|---|---|
| Aussichtsturm | 2 | 5 |
| Badesee-Insel (`lakeIsland`) | 4 | 3 |
| Tunnelportale | 2 | 2 |
| Bohrungsröhre | 0 | 0 |
| Massiv | 433 | 201 |
| Bahnhofsgebäude | 54 | 47 |

Insel und Portale nehmen weiter Strahlen — nichts davon ist von der Umformung verdeckt
worden. Die **Bohrung** nimmt bewusst 0 Strahlen aus Bird/Orbit: sie liegt im Fels und ist nur
schräg durch einen Mund sichtbar (in der Portal-Anfahrt aus dem D5-Raycast bestätigt).

### Neue Tests (`tests/scene/terrain.test.ts`, jetzt 15 Tests)

Neuer Block `scenery visibility from the overview cameras`:
- `shows the Aussichtsturm standing clear of its own summit` — Objekt existiert, steht
  unverschoben auf dem Planpunkt, **Dachspitze ≥ 120 mm über dem höchsten Gelände im
  Fußkreis** und höchstens ein Viertel der Turmhöhe im Boden. Mit den Vorher-Werten
  (89,9 mm / 61,8 mm) schlägt beides fehl — das ist die Assertion, die gefehlt hat.
- `takes rays from the Bird and Orbit cameras for tower, island and portals` — echte
  Kamerastrahlen der App-Rigs (Bird ortho, Orbit 45°) durch den projizierten Zielpixel;
  Turm aus Bird *und* Orbit, Insel aus Bird, jedes Portal aus Bird oder Orbit.

Die Sphere der Badesee-Insel heißt dafür jetzt `lakeIsland` (vorher unbenannt).

---

## D8 (major, Nutzer-Screenshot) „Gleis geht direkt in den Berg, Tor da, aber kein Tunnel" — behoben

Der Nutzer hat recht, und die Ursache ist grundsätzlich: **ein Höhenfeld kann kein Loch haben.**

### Messung (vorher)

Entlang `e68`, 0,25-pt-Abtastung:

| | |
|---|---|
| Gelände schließt über der Schienenoberkante bei | s = 44,6 pt = **156 mm** |
| Portal (54 mm Deckung) stand bei | s = 48,6 pt = **170 mm** |
| ⇒ Schienen verschwanden | **14 mm VOR** dem Rahmen im ungebrochenen Hang |

Und quer über die Portalbreite (±10 pt) am Mund: **West 0 mm / Mitte 54 mm / Ost 175 mm** —
eine diagonale Rampe. Deshalb sah der Nutzer einen „T-Block auf einem schmalen Pfeiler": der
Westpfeiler stand frei im Einschnitt, der Ostpfeiler lag 175 mm tief im Fels, und Sturz plus
Deckplatte ragten schräg aus dem Hang. Eine Öffnung gab es **nirgends** — die 0 Strahlen auf die
Bohrung aus Bird/Orbit waren kein Beweis für „liegt im Fels", sondern für „es gibt kein Loch".

### Fix — vier Teile

**1. Zweipass-Terrain (`resolveTunnels()`).** Pass 1: Hügel + Einschnitte → wo kreuzt eine
Tunnelkante in volle Felsdeckung? Das sind die Münder. Pass 2: vor jedem Mund ein
**`ApproachClip`** — alles im Korridor *außerhalb* der Mundebene wird auf Plattenhöhe
abgetragen. Die Richtungsprüfung ist entscheidend: ein reiner Abstandsschnitt hätte den
Aussichtsturm 33 mm dahinter mit abgetragen (genau das ist beim ersten Versuch passiert,
Turmfuß auf 0 mm). Korridorbreite = Lichtraum + 5 mm, nicht die volle Portalbreite.

**2. Echtes Loch im Mesh.** `buildMassif()` lässt die Quads im „Mundfenster" weg (Aperturbreite
+ 0,6 Zelle, ±1,2 Zelle um die Mundebene, nur wo das Gelände unter der Mauerkrone liegt). Das
Loch ist ≤ ±26 × 45 mm und damit kleiner als die Portalmauer, die in derselben Ebene steht —
man schaut also nie durch den Berg.

**3. Portal = Stützmauer mit Loch**, nicht zwei Pfeiler unter einer Kappe: linke Wange, rechte
Wange, Sturz darüber, Deckplatte. 80 mm breit, 66 mm hoch, 12 mm tief, **lichte Öffnung
34 × 42 mm**, Außenfläche exakt auf der Mundebene.

**4. Felsboden über der Bohrung (`BORE_MIN_COVER_MM` = 52 mm).** `e68` läuft am Westmund nur
39 mm neben dem offenen `e49`, dessen Einschnittmaske den Hügel *innerhalb* des Tunnels
abschnitt und ein Felsband 16 mm über der Schiene in die Bohrung ragen ließ (gemessen). Zwischen
den Mündern hält der Korridor jetzt mindestens 52 mm — die Funktion **hebt nur**, begräbt also
kein offenes Gleis.

### Messwerte nachher (Kamera auf Schienenhöhe, entlang der Trasse — nicht von oben)

| Prüfung | Ergebnis |
|---|---|
| Anfahrt 4…120 mm vor dem Mund: Deckung | **0,0 mm** (offener Trog bis zur Mauer) |
| 10 / 20 mm hinter dem Mund | **111 / 158 mm** Fels (Einfahrt), 77 / 93 mm (Ausfahrt) |
| Zentrale Strahlen auf `bore:e68`, Westmund | **49 von 49 (100 %)** |
| Zentrale Strahlen auf `bore:e68`, Ostmund | **42 von 49 (86 %)** |
| Tiefstes Massiv-Mesh im Lichtraum (±12 mm) über der Bohrung | **48,4 mm** (> Röhrendach 44 mm) |
| Lichte Öffnung | **34 × 42 mm** vs. Lok 24 × 31,6 mm, Wagen 24 × 35,6 mm |
| Rahmensymmetrie zur Gleisachse | Wangen bei ∓28,50 mm, **Versatz 0,000 mm** |
| Bohrung | 171…273 mm = **102 mm** |

Die 7 Strahlen auf die Wange am Ostmund sind ein Messartefakt: die gerade Kamera steht 140 mm
zurück auf einer Kurve, ihre Achse trifft die Mundebene leicht schräg. 86 % ist klar über der
geforderten Mehrheit.

**Kein Rückfall in D1:** das Mesh bleibt ein Höhenfeld, alle Vertexnormalen zeigen weiter nach
oben (Test unverändert grün); das Loch wird von der Mauer verdeckt, und die Bohrung ist
`MeshBasicMaterial` mit `side: DoubleSide` — unbeleuchtet schwarz von innen *und* außen, also
kein schwarzes Loch mit invertierten Normalen. **Kein Rückfall in D6:** offene Kanten weiter
0,0 mm Deckung an Achse und Schotterkanten, Mesh-Raycast von oben ohne Treffer.

### Ehrlicher Restbefund (Datenlage, nicht Code)

Der Westmund liegt am geometrischen Limit: `e68` ist dort nur **39 mm** von der Achse des
offenen `e49` entfernt, die Apertur ist 34 mm breit, der Einschnittboden von `e49` ±31,5 mm.
Die Apertur überlappt also den Einschnitt des Nachbargleises. Der Felsboden aus Punkt 4 löst
das Sichtbarkeitsproblem, lässt aber eine **20 mm** dünne Felswand zwischen Bohrung und `e49`
stehen (Lok-Halbbreite 12 mm ⇒ 8 mm Luft). Ursache: der Aussichtsturm sitzt laut Trackplan
23,6 mm von der Achse von `e68` — also **auf dessen Schotter** — und erzwingt damit, dass der
Gipfel und damit die Felsdeckung schon bei s ≈ 45 pt beginnt, genau in dem Abschnitt, in dem
`e68` und `e49` sich berühren. Ein Mund weiter östlich (ab s ≈ 72 pt, wo `e68` frei von `e49`
ist) würde verlangen, den Turm ~145 mm zu verschieben — `landscape.buildings` gehört nicht zu
meinem Bereich. **Zur Entscheidung:** so lassen (funktioniert, sieht wie ein Portal am Ende
eines Einschnitts aus) oder den Turm freigeben.

### Neue Tests (`tests/scene/terrain.test.ts`, jetzt 19 Tests)

Neuer Block `tunnel mouth at track level` — bewusst **nicht** von oben:
- `shows a clear majority of central rays hitting the dark bore` — Auge auf der Trasse, 140 mm
  vor dem Mund, Aperturmitte; > 60 % der zentralen 49 Strahlen müssen `bore:` treffen
- `opens the approach so the rock stops at the masonry face` — 4…120 mm davor ≤ SOK, 20 mm
  dahinter > Aperturhöhe
- `keeps the loading gauge clear of terrain along every bore` — Raycast im Lichtraumprisma
- `clears the rolling stock and is symmetric about the track centre line`

---

## D9 (Nutzermeldung) Tangentenknicke auf der Westseite — behoben

Nutzerbefund: derselbe Vergleich, drei markierte Stellen auf Seite 1 des Gleisplans und im
Render — Westecke (Gleise A/B um die obere linke Ecke), Kurvengruppe Mitte-links, Anschluss der
K-Kehrschleife an die Außenbögen. Der Plan zeichnet dort **weiche Schwünge**, unser Render eine
**Kette gerader Sehnen mit sichtbaren Ecken**; zusätzlich ein **abrupter kurzer Stummel** oben
links ohne Gegenstück im Plan.

Behoben als **reine Datentransformation** (Eigentümerentscheidung, `reference/HANDOFF.md`):
`tools/smooth-trackplan.ts` schreibt `edges[].pts` einmalig zu einer dichten G1-Polylinie um.
Beide Konsumenten (`src/plant/geometry.ts` → `Polyline`, `src/scene/trackMesh.ts` →
`buildEdgeCurves`) sehen damit identische Geometrie **ohne eine Zeile Codeänderung**; die
Einschnittmaske des Massivs folgt automatisch, D6/D8 bleiben intakt.

### Quelle der Wahrheit zuerst: die Pfadprimitive des PDFs

`tools/extract-gleisplan-paths.py` (PyMuPDF) holt die **74 gestrichenen Primitive** des grauen
Gleisnetzes aus **Seite 3** von `Gleisplan SPS.pdf` — 52 Geraden und 22 Ketten kubischer
Béziers — und legt sie als `tools/gleisplan-paths.json` ab (die PDF selbst ist gitignoriert,
das Artefakt muss also mit ins Repo). Seite 3 statt 1/2, weil dort der rote Aufgabenweg das
Netz nicht überdeckt; Seiten 3 und 4 sind byte-identisch, das prüft das Skript selbst.

Damit ließ sich erstmals **messen statt schätzen**, wie weit unsere Daten vom Plan abweichen
(max. Abstand eines Stützpunkts zur nächsten Planlinie):

| Kante | vorher | Befund |
|---|---|---|
| `e28` | **221,8 mm** | Bogen A oben links: Knoten `n37` liegt 119 mm neben dem Plan |
| `e27` | **186,4 mm** | dito Bogen B, Knoten `n35` 70 mm daneben |
| `e26` / `e25` | 119,2 / 70,5 mm | dieselbe Kurvengruppe |
| `e10` | 0,1 mm an den Enden, aber **40,3 mm Sehnenfehler** | 2-Punkt-Sehne, wo der Plan einen Bogen zeichnet |
| `e86` | 0,0 / **23,7 mm Sehnenfehler** | dito |
| `e87` / `e44` | 20,5 / 16,3 mm | K-Kehre an den Außenbögen (Nutzerbereich 3) |
| `e81` | **32,7 mm** | Zwischenpunkt (300/511) frei erfunden — Plan zeichnet **eine Gerade** |
| alle übrigen 94 Kanten | ≤ 11,4 mm | Abtastung im Wesentlichen plantreu |

### Befund zu `n38`/`n39` und den 10-Einheiten-Stummeln `e96`/`e97`

Ausdrücklich gegen das PDF geprüft, **nicht** angenommen:

- Der Plan hat an `x = 196,68` und `x = 210,72` je eine **echte Gerade** (Primitive #69/#70) von
  `y = 128,31` bis `y = 99,96`, Länge 28,35 pt. `e96`/`e97` liegen mit **0,02 / 0,07 pt** darauf —
  die Stummel sind **plantreue Gleisstücke**, kein Artefakt.
- Die Bögen, die dort ankommen (Planprimitive #22/#21), enden **tangential** an diesen Geraden.
  Die 79,5°/74,6°-Ecken an `n39`/`n38` sind also **keine echten Ecken**: unsere Bögen `e28`/`e27`
  laufen ~18,9 pt über ihren Tangentenpunkt hinaus und treffen die Vertikale dann quer.
- Der „abrupte kurze Stummel" ist damit erklärt: die 10 pt Vertikale steht als Spitze ab, weil der
  Bogen fast waagerecht ankommt. Die Stummel bleiben unangetastet gerade — geglättet wurde der
  **Anschluss**, nicht der Stummel. (Sie sind mit 10 pt allerdings nur ein Teilstück der 28,35 pt
  des Plans; das ist eine Folge der falsch platzierten Knoten, siehe „Offener Restbefund".)

### Algorithmus (drei Pässe, alle Toleranzen im Dateikopf des Skripts)

1. **Planreparatur je Kante.** Liegen *beide* Endpunkte einer Kante innerhalb 0,5 pt auf **einem**
   Planprimitiv, ist dieses maßgeblich: Gerade → Zwischenpunkte entfallen; Bogen → die Kante wird
   aus der Bézier neu abgetastet, aber nur wenn der Plan die gespeicherte Polylinie um > 8 mm
   verfehlt. Betroffen: `e10`, `e14`, `e44`, `e86`, `e87` (neu abgetastet) und `e81` (auf die
   Plangerade eingezogen). Die Schwelle ist **kein freier Regler**: bei 1 mm wird auch `e68`
   ersetzt, das verschiebt den D8-Tunnelmund um 8,6 mm und kippt den Aussichtsturm auf die
   abgetragene Seite des Approach-Clips (Turmfuß 169 → 0 mm). 3,6 mm Plantreue auf `e68` sind das
   nicht wert.
2. **Ketten statt Kanten.** Geglättet wird pro **Kette** über einfache (Grad-2-)Knoten hinweg,
   Abbruch an jeder Weiche und jedem Prellbock — die schlimmsten Knicke sind kantenübergreifend.
   57 Ketten. **Kein Knoten wird bewegt**, auch kein kettenintern liegender.
3. **G1-Glättung.** Jedes Kettensegment wird gegen den Plan als `line` (hugt eine Plangerade auf
   ≤ 2 pt und parallel auf ≤ 2°) oder `curve` klassifiziert. Tangenten: an `line|line` gar keine
   (das Segment bleibt unverändert — **echte Planecken werden bewahrt**), an `line|curve`
   **geklemmt** auf die Richtung der Geraden (das entfernt die 79,5°/74,6°), an `curve|curve` die
   normierte Summe der Nachbarsehnen (derselbe Schätzer, den `MeshAccum.sweep` schon benutzt —
   exakt für kollineare Punkte, eine Gerade kann also nicht ausbeulen). Jedes `curve`-Segment wird
   zur kubischen Bézier (Hermite, Griffe = Sehne/3) und in Schritten von ≤ 2,0° Kursänderung
   abgeflacht. Die Segmentzahl ist auf `floor(Lauflänge / 1 pt)` begrenzt, das garantiert also den
   **mittleren** Abstand ≥ 1 pt, **nicht** den kleinsten: bei kursäquidistanter Abtastung drängen
   sich die Stützpunkte am krümmungsstärksten Ende zusammen (gemessen: 17 von 1077 Segmenten unter
   1 pt, kürzestes 0,6701 pt = 2,35 mm auf `e86`). Ein Mindestabstand ist mit der Kursschranke
   **arithmetisch unvereinbar** — ein Segment wegzulassen verschmilzt zwei Spannen mit je ~2,0° zu
   einer mit ~4,0°. Die Rundung auf `COORD_DECIMALS` lässt auf dem kürzesten Segment 0,06°
   Richtungsunsicherheit, also weit innerhalb des 3°-Budgets.
   **Widersprüchliche Läufe werden neu gebaut:** kinkt ein Kurvenlauf innen > 15° oder braucht er
   am Ende > 30° Klemmkorrektur, dann liegen seine Stützpunkte gar nicht auf einer glatten Kurve.
   Dann werden alle Nicht-Knoten-Stützpunkte verworfen und der Lauf aus seinen **Knoten** plus den
   geklemmten Endtangenten neu gebaut. Das trifft genau die zwei kaputten Westläufe
   (`n29→n35→n38` und `n28→n37→n39`, je 16 Stützpunkte verworfen). Ohne diesen Pass ist das
   Ergebnis formal G1, praktisch aber ein **3-mm-Radius-Haken** an `n39` — auf dem Schirm wieder
   eine Ecke (gemessen: engster Radius 29,9 mm).
4. **Knotentangenten aus dem Plan** (`planKnotTangent`, gehört zu Pass 3). In einem so neu gebauten Lauf haben die
   *innen* liegenden Knoten (`n37`, `n35`) keine Richtungsinformation mehr — ihre Nachbarstützpunkte
   sind gerade verworfen worden. Die Sehnen zwischen den überlebenden Knoten zu mitteln ist dann
   willkürlich und war messbar falsch: an `n37` ergibt das −48,32°, damit verlässt die Kurve den
   Knoten steiler als die Sehne nach `n39` und die restlichen 69° Kursänderung werden in den
   Schwanz von `e28` gepresst — **84,6 mm Radius, der engste Bogen der ganzen Anlage, genau an der
   vom Nutzer markierten Stelle.** Der Plan ist im ganzen Werkzeug die Autorität, also auch hier:
   die Knotentangente ist die **Planrichtung am plannächsten Punkt** (`n37` −22,54°, 34,0 pt
   entfernt; `n35` −18,28°, 20,1 pt entfernt), mit zwei Schranken — Knoten ≤ 60 pt vom Plan und
   Korrektur ≤ 45° gegen die Sehnenmittelung. Ergebnis:

   | Knoten | Sehnenmittel | Plan | engster Radius | max. Planabstand |
   |---|---|---|---|---|
   | `n37` (`e26`/`e28`) | −48,32° | **−22,54°** | 84,6 → **107,2 mm** | 160,2 → **138,3 mm** |
   | `n35` (`e25`/`e27`) | −47,72° | **−18,28°** | 98,7 → **135,1 mm** | 131,6 → **95,1 mm** |

   Krümmung **und** Plantreue verbessern sich, das ist also kein Tauschgeschäft. Die zweite Schranke
   ist nötig, weil `n35` zum *inneren* Bogenpaar (#19/#21) gehört, sein plannächstes Primitiv aber
   der äußere Bogen #20 ist (20,1 pt) — hier zulässig, weil die Bögen dort nahezu konzentrisch
   laufen (Korrektur 29,4°), bei größerem Missverhältnis fällt die Regel auf die Sehnen zurück.

   Verworfene Alternative (aus dem Prüfbericht, gegen das PDF gemessen): `e28`'s Schwanz dem
   Planbogen #22 bis zu seinem Tangentenpunkt (196,56/128,87) folgen zu lassen und die Differenz am
   `n37`-Ende aufzunehmen. Das ist geometrisch unmöglich, ohne `n37` zu verschieben: der Plan
   wendet an seinem Wendepunkt (126,9/199,1) **waagerecht** (0,72°), unsere `e26` kommt an `n37`
   mit −68,54° an. Gemessen ergibt jede Variante davon einen Haken mit **8,8 mm** Radius (bei
   jedem Anteil von #22, den man behält), und der Tangentenpunkt als bloßer zusätzlicher Knoten
   verschlechtert den Radius auf 67,5 mm. Ein einzelner Kreisbogen `n37` → Tangentenpunkt mit
   senkrechter Ankunft hätte R = 244 mm, müsste aber 138° drehen und `n37` nach *unten rechts*
   verlassen — auf dem Schirm eine Schlaufe.

Das Skript iteriert bis zum **Fixpunkt** (2 Pässe auf diesen Daten), damit ein erneuter Lauf
byte-identisch nichts ändert.

### Messwerte vorher/nachher

| Größe | vorher | nachher |
|---|---|---|
| max. Headingsprung zwischen Nachbarsegmenten | **20,54°** (`e81`) | **2,27°** (`e27`) |
| Knick an einfachen Knoten: `n39` / `n38` / `n29` | **79,46° / 74,61° / 41,44°** | **1,15° / 1,10° / 1,06°** |
| `n35` / `n37` / `n28` / `n72` / `n30` / `n78` | 31,98° / 30,42° / 29,01° / 26,40° / 12,48° / 11,97° | 2,26° / 2,16° / 1,00° / 0,86° / 1,01° / 0,48° |
| einfache Knoten mit > 3° Knick | **30 von 44** | **9 von 44** — und alle neun sind **echte Planecken** |
| engster Krümmungsradius (kanteninterne Tripel) | 239,9 mm (`e32`) | **90,9 mm** (`e39`), dann `e28` 107,2 / `e30` 115,1 / `e46` 116,9 |
| engster Radius im markierten Westbereich | — (Ecken = 0) | `e28` **107,2 mm**, `e27` 135,1 (erste Fassung: 84,6 / 98,7) |
| Radius aus dem Schwellenversatz (6,5 mm), gerendert | 18 mm (`e81`) | **88,4 mm** (`e28`); erste Fassung 71 mm |
| max. Abweichung der Mittellinie | — | **108,53 mm** (`e27`), 102,2 (`e28`), 83,4 (`e25`), 81,0 (`e26`); `e10` 40,3; **sonst ≤ 23,7 mm** |
| max. Bogenlängenänderung je Kante | — | **+24,85 mm / +4,86 %** (`e27`), `e26` +23,81, `e28` +21,63, `e87` +20,21, `e10` +17,70 = **+7,38 %** (prozentual am meisten); die übrigen 91 Kanten ≤ 0,94 mm |
| max. Bogenlängenänderung je Kette | — | **+46,66 mm / +1,793 %** (`e21+e15+e16+e17+e26+e28+e96+e29`) |
| Netzlänge gesamt | 36 230,4 mm | **36 370,0 mm (+139,6 mm, +0,385 %)** |
| max. Abstand eines Stützpunkts zum Gleisplan | **221,8 mm** | **138,3 mm** (`e28`); höchster Wert außerhalb der Westecke `e51` **11,47 mm** |
| Plan → Gleis, Mittelwert über alle 74 Primitive | **21,86 mm** | **15,43 mm** (Maximum 211,9 → 138,9) |
| Stützpunkte in `edges[].pts` | 363 | **1178** (`trackplan.json` 68 → 123 kB, `dist` 1,26 MB) |
| Reedposition (Auslöse-`offsetMm`) | — | **unverändert, alle 45** |
| Knotenkoordinaten | — | **unverändert, alle 86** (bit-identisch, auch als Kantenendpunkt) |
| Planausdehnung über alle `pts` (`PlanFrame`) | 26,4 / 14,9 / 933,5 / 525,1 | **identisch** — der Weltrahmen wandert *nicht*, keine Szenenposition verschiebt sich dadurch |
| Weichen-Abzweigwinkel | 3,88° schmalster (`(xW)`) | **1,70°** schmalster (`xW05D`), dann `xW03C` 2,31 / `(xW)` 2,68 / `xW02C` 3,34 / `xW02D` 4,36; alle übrigen 31 ≥ 9,61° |
| Gelände unter offenem (nicht-Tunnel-)Gleis | 0,000 mm | **0,000 mm**, `tests/scene/terrain.test.ts` 19/19 grün |
| Oracle-Suiten | 63/63 | **63/63 unverändert**, keine Erwartung angepasst |
| `npm run gates` | 883 Tests / 62 Dateien | **913 Tests / 64 Dateien**, tsc ✓ eslint ✓ build ✓ |

Gerendert bewegt sich der Reed-**Marker** dort mit, wo die Kante neu gebaut wurde: `xR02B` 82,9 mm
und `xR02A` 80,6 mm (beide **unverdrahtet**, reine Dekoration; erste Fassung 58,7 / 53,8 mm — der
Zuwachs ist der Preis der plantreueren Westläufe), `xR02K` 11,5 mm, dann als schlechtester
**verdrahteter** Marker `xR01K` 5,1 mm, `xR03A` 1,4 mm, `xR03B` 1,2 mm, alle übrigen ≤ 0,84 mm. Die
Auslöseposition (`edgeId` + `offsetMm`) ist unverändert, deshalb ist die Ereignisfolge identisch.
Die beiden 80-mm-Verschiebungen sind **nicht** gegen die Reed-Symbole des Plans geprüft — die
Extraktion holt nur die 4,56-pt-Gleisstriche; wer später absolute Zeittoleranzen einführt, muss neu
baselinen.

### Was der Glättung zum Opfer fiel — bewusst akzeptiert

- **Engster Bogen jetzt `e39` mit 90,9 mm** statt vorher 239,9 mm (`e32`), also global 2,6× enger.
  Die Stelle liegt direkt hinter der Klemmung an `n1`, ihr Stützpunkt (915,72/423,04) ist nur
  **3,6 mm** vom Plan entfernt — die Position ist plantreu, die Krümmung ist ein Hermite-Überschwinger.
  Zum Maßstab: der engste Bogen, den der Gleisplan selbst zeichnet, hat **197,4 mm** (Primitiv #9).
  `e39` liegt in keinem der drei markierten Bereiche. Als Untergrenze gepinnt (85 mm).
- **`xW05D` (`n18b`) klappt von 37,94° auf 1,70° Abzweigwinkel zusammen** — `e10` verlässt den Knoten
  jetzt mit 91,70° statt 127,94°, weil es dem Planbogen #9 folgt statt einer 2-Punkt-Sehne. Das ist
  **plan-korrekt** (Kurve #9 läuft 0,05 mm an `n18b` vorbei und verlässt Plangerade #31 tangential,
  der wahre Abzweigwinkel dort ist wirklich ~1,7°), kollidiert aber mit der ausdrücklichen didaktischen
  Anforderung in `src/scene/switchMesh.ts`, dass „die Zungenlage auf einen Blick lesbar" sein muss.
  Die Daten bleiben unverändert (der Plan hat recht); stattdessen ist der Abzweigwinkel **jeder** der
  36 Weichen als Untergrenze gepinnt, damit ein künftiges Zusammenklappen auffällt. Anzumerken: sub-5°
  Weichen gab es auch vorher schon (`(xW)` 3,88°, `xW02C` 4,48°), das ist keine neue Klasse von Problem.
  Ob die Zunge einen Mindest-Darstellungswinkel bekommen soll, ist eine Eigentümerentscheidung.
- **Neun einfache Knoten bleiben Knicke von 7,36° bis 19,02°** (`n31`, `n81`, `n83`, `n13`, `n74`,
  `n70`, `n80`, `n79`, `n75`). Sie sind korrekt bewahrt — jede der beiden Kanten hugt eine
  Plan*gerade* (schlechtester Fall 7,00 mm, `e72` an `n70`) und es sind immer **verschiedene**
  Primitive, der Plan zeichnet dort also wirklich Ecken. Echtes Gleis kann nicht um 19° knicken, das
  wird im 3D-Bild als unmögliche Geometrie zu lesen sein; alle neun liegen bei `x ≥ 337,9`, also
  **außerhalb** aller drei markierten Bereiche (`x < 300`). Ob die echte Anlage diese
  Weichenleiter-Anschlüsse ausrundet, kann das PDF nicht beantworten — separate Datenfrage.

### Offener Restbefund (Daten, nicht Code) — braucht eine Eigentümerentscheidung

Die Westecke ist jetzt **glatt** und deutlich plantreuer, aber sie liegt weiter **falsch**: `n35`
(88/185) und `n37` (75/175) sind **70 bzw. 119 mm** neben der Stelle, an der der Gleisplan seine
beiden Tangentialbögen zusammenstoßen lässt (#20/#22 bei 126,9/199,1, #19/#21 bei 126,7/213,4). Der
Plan baut diese Ecke aus **zwei tangentialen Viertelkreisen** je Gleis (`R ≈ 351 mm` und
`R ≈ 251 mm` außen, `R ≈ 301 mm` innen), unsere Daten aus zwei flachen Bögen durch einen um 57,2 pt
(200 mm) verschobenen Wendepunkt. Deshalb bleibt `e28` auch nach der Glättung 138 mm vom Plan
entfernt, und deshalb sind `e96`/`e97` nur 10 statt 28,35 pt lang.

Beide Richtungen gemessen (die zweite fehlte in der ersten Fassung):

| | vorher | erste Fassung | jetzt |
|---|---|---|---|
| Gleis → Plan, `e28` / `e27` / `e26` / `e25` | 221,8 / 186,4 / 119,2 / 70,5 mm | 160,2 / 131,6 / 119,2 / 70,5 | **138,3 / 95,1 / 119,2 / 70,5** |
| Plan → Gleis, Mittel #20 / #22 (außen) | 79,3 / 137,6 mm | 70,8 / 100,8 | **57,8 / 72,6** |
| Plan → Gleis, Mittel #19 / #21 (innen) | 75,4 / 130,8 mm | 80,6 / 106,4 | **85,7 / 100,5** |
| Kette außen (`e26+e28+e96`) gegen #20+#22+#69 | 148,4 mm | 122,6 | **105,4** |
| Kette innen (`e25+e27+e97`) gegen #19+#21+#70 | 129,7 mm | 125,5 | **107,8** |

`#19` ist das **einzige** Primitiv, das im Mittel schlechter wird (75,4 → 85,7 mm): es ist der innere
Bogen, dessen Wendepunkt unser `n35` verfehlt. Auch dieser Wert ist als Obergrenze gepinnt, damit er
nicht stillschweigend weiter wächst.

**Plantreu wäre nur, `n35` und `n37` zu verschieben** — das war ausdrücklich untersagt (Knoten
verankern Topologie, Weichengeometrie und Tests) und würde die Bogenlängen der A/B-Westäste um
~90 mm ändern sowie die gepinnte Knotenliste in `tests/data/trackSmoothness.test.ts` berühren.
Das ist eine Entscheidung, keine Implementierungsfrage. Der Rest (glatt, tangential an den
Stummeln, `R ≥ 107 mm` im Westbereich) ist ohne Knotenverschiebung das Erreichbare.

### Neue Tests (30)

- `tests/data/trackSmoothness.test.ts` (24): Headingsprung ≤ 3° kanteninternen **und** an
  einfachen Knoten; die neun Restknicke werden **gegen die Planprimitive nachgemessen** (jeder
  liegt zwischen zwei *verschiedenen* Plangeraden, jede auf ≤ 2,5 pt gehugt) statt behauptet; die
  drei Nutzerbereiche einzeln benannt (`e26/e28/e96/e29`, `e25/e27/e97/e30`; `e44/e88/e87/e19`;
  `e12/e14/e16/e46/e53/e54`); `e96`/`e97` bleiben gerade, auf ihrer Planvertikalen und werden
  tangential getroffen; Krümmungsuntergrenze **85 mm** (gemessen 90,9); **Plantreue in beiden
  Richtungen gepinnt** — jede Kante außer den vier Westkanten ≤ 12 mm zum Plan, die vier Westkanten
  auf ihren gemessenen Rest (139/120/96/71 mm), und der Mittelabstand der vier Westprimitive
  (#19 ≤ 86, #20 ≤ 58, #21 ≤ 101, #22 ≤ 73 mm) — Plantreue kann damit nur besser werden; die
  Knotentangenten an `n35`/`n37` kommen nachweislich **aus dem Plan** (beide Kanten verlassen den
  Knoten auf < 3° der Planrichtung) und die beiden Schranken der Regel sind mit ihren Messwerten
  belegt, inklusive Rückfall auf die Sehnen für einen planfernen Knoten; die dokumentierte
  Abtastregel (Segmentzahl ≤ `floor(L / 1 pt)`) und das gemessene kürzeste Segment (> 0,6 pt,
  ≤ 20 Segmente unter 1 pt); **alle 86 Knoten, alle 45 Reedpositionen und alle 36 Weichenknoten
  literal gepinnt** plus der **Abzweigwinkel jeder Weiche** als Untergrenze; Kantenendpunkt
  bit-identisch mit seinem Knoten; Idempotenz und Determinismus des Werkzeugs.
- `tests/scene/trackSmoothness.test.ts` (6): beide Konsumenten liefern **dieselbe** Bogenlänge und
  denselben Planpunkt zu jedem `offsetMm` (< 1e-6 mm) — die Eigenschaft, wegen der die Glättung
  überhaupt in die Daten musste; Schwellen-Yaw impliziert nie einen Radius < **80 mm** (gemessen
  88,4); das gefegte Schotterband kann sich in keinem der drei Bereiche selbst überschlagen
  (Radius > 3 × Halbbreite) **und** hält seinen gemessenen Bereichsboden (West ≥ 100, Mitte-links
  ≥ 300, K-Kehre ≥ 110 mm).

Gegenprobe auf Wirksamkeit, beide Vorgängerdatensätze eingespielt: gegen die **alten** Daten fallen
**14 von 30** Tests durch, gegen die **erste Fassung** der Glättung noch **7 von 30** — darunter
genau die drei, die vorher wirkungslos waren (Krümmungsuntergrenze, Schwellen-Yaw und das
Schotterband der Westecke bestanden mit den alten Daten, weil deren engster Radius 239,9 mm war).
Die „unverändert"-Pins bestehen erwartungsgemäß in allen Fällen — das ist ihr Zweck.

---

## D9 — Vorarbeit und Blockade (historisch, vor der Behebung)

### Gemessen (vorher)

`trackplan.json` speichert jede Kante als dünne Punktliste, beide Konsumenten verbinden sie mit
Geraden. Maximaler Headingsprung zwischen aufeinanderfolgenden Segmenten:

| Bereich (Nutzermarkierung) | Kanten | max. Knick |
|---|---|---|
| oben links, A/B/C um die Ecke | `e29` 10,12° · `e30` 9,33° · `e27`/`e28` (Knoten `n39` **79,5°**, `n38` **74,6°**) | 79,5° |
| Mitte links | `e25`/`e26` (Knoten `n29` **41,4°**, `n35` 32,0°, `n37` 30,4°) | 41,4° |
| unten links, K-Kehre an den Außenbogen | `e12` 11,11° · `e14` 10,95° · `e16` 10,41° · `e46` 11,00° | 11,1° |
| schlimmste Kante überhaupt | `e81` (nur 3 Punkte) | **20,54°** |

30 von 44 einfachen Zwei-Kanten-Knoten haben > 3° Knick.

### Probe: zentripetale Catmull-Rom-Glättung, 8 Stützpunkte je Segment

| | |
|---|---|
| max. Abweichung der Mittellinie von den alten Sehnen | **5,56 mm** (`e81`, sonst deutlich weniger) |
| größte Bogenlängenänderung einer Kante | **0,75 mm** (`e46`) |
| Netzlänge gesamt | 36 230 → 36 240 mm (**+9 mm, +0,026 %**) |
| max. Headingsprung danach | **4,92°** (von 20,54°), bei 10-Punkt-Kanten ≈ 1,4° |

0,75 mm Bogenlänge = 9 ms bei 80 mm/s, gegen ein 10-mm-Reedfenster und 300-ms-Impulse — sehr
wahrscheinlich unkritisch, muss aber gegen die Oracle-Suite gefahren werden.

### Blockade: es gibt zwei unabhängige Polylinien-Implementierungen

- `src/plant/geometry.ts` → `Polyline` (Planeinheiten, Bogenlänge in mm) treibt Zugfahrt und
  Reedpositionen;
- `src/scene/trackMesh.ts` → `buildEdgeCurves`/`EdgeCurve` (Weltkoordinaten) treibt die Schienen.

Beide lesen `edges[].pts` **getrennt**. Nur in `src/scene` zu glätten würde den Zug neben seinen
eigenen Schienen fahren lassen — ausdrücklich verboten. Ich besitze weder `src/plant/**` (dort
arbeitet gerade ein anderer Agent) noch `edges[].pts`.

**Vorschlag (geringster Eingriff, kein Code in `src/plant`):** die Glättung als **reine
Datentransformation** — `edges[].pts` einmalig durch eine dichte G1-Spline ersetzen
(`tools/`-Skript, deterministisch, im Repo nachvollziehbar). Beide Konsumenten sehen dann
identische glatte Geometrie, **ohne eine Zeile Code zu ändern**; auch die Einschnittmaske des
Massivs folgt automatisch, weil sie aus denselben `pts` abgeleitet wird (D6 bleibt intakt).
Nötig: Freigabe für `edges[].pts` plus ein Oracle-Lauf.

**Nachtrag zu den Knoten:** Kanten einzeln zu glätten macht jede Kante intern G1, beseitigt aber
**nicht** die 74–79°-Knicke an den Knoten `n38`/`n39` — die sind kantenübergreifend. Dafür muss
die Spline pro *Kette* über einfache Knoten hinweg gebaut werden. Achtung: an `n38`/`n39` stößt
je ein 10-Einheiten-Stummel (`e96`, `e97`) auf einen Bogen; das kann eine echte Ecke im Gleisplan
sein. Das gehört gegen `Gleisplan SPS.pdf` geprüft, bevor man es glattzieht — ich würde es nicht
raten.

---

## D10 (major, Nutzermeldung) Zug außerhalb der Platte bei Zyklus 1454 — behoben

Die Anlage ist entlastet: bei Zyklus 1454 ist der Plant-Zustand ein gültiger Gleispunkt
(`e76`, Offset 114,55/159,60 mm, Richtung −1, Plan 772,1/195,2). Außerhalb der Platte lag nur
der **gerenderte Wagenzug** — der Fehler steckt in `src/scene/trainMesh.ts`.

### Mechanismus (bestätigt, mit einer Korrektur an der Diagnose)

`TrainVisual` setzt jedes Fahrzeug an eine feste Bogenlänge hinter der Lok auf einem
**Pfadpuffer** vergangener Lokpositionen. Beim Rückwärtsfahren wandern die Fahrzeuge zu
*kleinerer* Bogenlänge — also auf Gleis, das die Lok **vor** dem Richtungswechsel aufgezeichnet
hat. Der Puffer hielt nur `lengthMm + 250` = **672 mm** Historie, und `pointAt` extrapolierte
jenseits beider Enden eine Gerade. Sobald ein Rückzug länger als die Historie wurde, lag jede
Stichprobe unter `pathS[0]`, und der Fehler wuchs **linear mit der Rückzugstrecke**: 0 → 21 →
335 → 1090 mm.

**Korrektur zur vorgeschlagenen Route 2:** die Lokposition beim Rückwärtsfahren vorne
anzuhängen behebt nur die *Lok*. Die Wagen brauchen Bogenlängen *unterhalb* der aktuellen
Lokposition — Historie, die vor dem Richtungswechsel bereits weggeworfen wurde. Keine
Trimm-Strategie kann sie zurückholen; nur Aufbewahren hilft.

### Fix (vier Teile, alle in `trainMesh.ts`)

1. **`TAIL_KEEP_MM` 250 → 2600.** Bemessen nach der Rückzugstrecke, nicht nach der Zuglänge.
   Deckt jeden Rangiervorgang der Aufgaben (Gruppe A ≈ 1,4 m) mit Reserve. Kosten ≈ 3200
   Punkte ≈ 128 kB.
2. **Extrapolation begrenzt (`EXTRAPOLATE_LIMIT_MM` = 60), nicht abgeschafft.** Ein *wenig*
   Vorausschau ist nötig: das führende Fahrzeug wird aus zwei Stichproben ±0,75 · halbe Länge
   gebildet und greift ~42 mm über den aufgezeichneten Kopf hinaus. Ein reines Clampen kostete
   sofort 21 mm Lokfehler (gemessen). Kaputt war die **Unbegrenztheit**.
3. **`INIT_TAIL_MM` = 60**, entkoppelt von `TAIL_KEEP_MM`: sonst legt der Anker eine 3 m lange
   gerade Vermutung hinter die Lok, die die Platte verlässt — und ein Rückzug rendert den Zug
   darauf (im Test aufgefallen).
4. **`pathS`-Monotonie strukturell garantiert.** `append` verankert neu statt eine
   nicht-monotone Bogenlänge zu schreiben, `prepend` hält den Anfang streng kleiner. Genau die
   Verletzung (`truncateAfter` leerte den Puffer, dann `append` unter `pathS[0]`) erzeugte den
   roten Streifen statt dreier Fahrzeuge.

### Messwerte

| Prüfung | vorher | nachher |
|---|---|---|
| Rückzug 1,4 m (Gruppe A), Gerade | exakt (Extrapolation trifft die Gerade zufällig) | **< 1 mm** |
| Rückzug 2,6 m, Bogen r = 600 mm | **71 mm** | **< 5 mm** (Sehnen-Effekt des starren Fahrzeugs) |
| Stress: 4 m Rückzug nach 0,5 m vorwärts | 447 mm | **< 250 mm** |
| Stress: 8 m Rückzug nach 0,5 m vorwärts | **535 mm — wächst weiter** | **gleich wie 4 m (±2 mm)** |
| Fahrzeuge außerhalb der Platte | 590 mm (Zyklus 1429/1454) | **keine** |

Die entscheidende Eigenschaft: die Schranke **wächst nicht mehr mit der Rückzugstrecke**.

### Neue Tests (`tests/scene/consist.test.ts`, 5 Tests)

Gegen die *alte* Konstantenbelegung gegengeprüft, damit klar ist, welcher Test greift:

| Test | fängt den alten Fehler? |
|---|---|
| 1,4 m Rückzug auf der Geraden, < 1 mm | **nein** — auf einer Geraden ist die Extrapolation zufällig richtig; bleibt als Exaktheitsprobe |
| 2,6 m Rückzug im Bogen, < 5 mm | **ja** (71 mm) |
| `pathS` streng monoton über Rückzug und Neuverankerung | ja (die Verletzung war der Streifen) |
| begrenzte Degradation, alles auf der Platte | **ja** (447 mm) |
| Schranke unabhängig von der Überschreitung | **ja** (535 mm und wachsend) |

## D11 (Nutzermeldung, annotierter Screenshot) Turm auf Felsnadel über dem Tunnel — behoben (Cloud-Session)

Vom Nutzer per GitHub-PR #1 gemerged (Commit `130cfdf`, „remove the tunnel (D11)"): der Nutzer
wählte Lesart (b) aus dem Handoff — **Tunnel und Berg darüber sind entfernt**, statt die Nadel
zu einem breiten Hügel umzuformen. `landscape.tunnels` ist leer, die Portale entfallen, der
Aussichtsturm steht auf dem verbliebenen breiten Hügel. Die Terrain-Tests wurden entsprechend
angepasst (kein Tunnel ⇒ keine Portal-/Bohrungs-Pins; `PLAN_HAS_TUNNEL`-Guards). Die
Gruppe-B-Aufgabe erwähnt „nach Durchfahrt des Tunnels" — der Streckenabschnitt existiert
weiter, nur ohne Fels darüber; didaktisch unverändert (Reeds/Weichen unberührt).

## D12 (major, Nutzer-Screenshots) Wagen neben der Spur bei Spawn und Rückschub — behoben (Cloud-Session)

Cloud-Fix (Commit `130cfdf`): `TrainVisual` platzierte die Wagen auf einem Puffer *vergangener*
Lok-Positionen (D10-Modell). Zwei Fälle widerlegten das Modell: beim Spawn existiert keine
Historie (synthetischer gerader Schwanz ⇒ 60,9 mm neben dem Gleis, nächstes Gleis ein anderer
Edge), und beim Rückschub *führen* die Wagen auf Gleis, das die Lok nie befahren hat (Fehler
wuchs bis 481,7 mm bei Zyklus 1431 des Gruppe-A-Laufs). Neu: `TrackGraph.consistPath` läuft
vom Zug aus in beide Richtungen über den **lebenden Graphen** (gleiche `nextEdge`-Auflösung wie
die Lok), veröffentlicht als `snapshot.train.consistPath`; der Pfadpuffer ist gelöscht.
Gemessen (640 Zyklen, 160 s): Fahrzeuge > 25 mm neben jeder Schiene 63/640 → **0/640**;
Fahrzeug-Spannweite max. 691 → **292 mm** (exakt). — Die Kehrseite dieses Modells (Weiche
unter dem stehenden Zug umgestellt ⇒ Wagen springen mit) ist **D16**.

## D13 (Nutzermeldung) Lok startet für Gruppe B auf Gleis 1 statt Gleis 4 — behoben (Cloud-Session)

Cloud-Fix (Commit `ead15fc`, PR #2): nur die Headless-Pfade (Check-Runner, Oracle) beachteten
`exerciseStarts`; der sichtbare Zug stand immer auf dem §7.1-Default (Gleis 1), Gruppe-B-Trigger
`xR03BH1G4` kam nie unter den Magneten. Eine Auflösungsregel `startForExercise`
(src/plant/exerciseStart.ts), `Plant.setStart` setzt die laufende Anlage um; erreichbar über
die Netzwerk-Auswahl **und** den neuen Startgleis-Schalter im ControlPanel (rendert
`SimStatus.startExercise`, nie den eigenen Klick; seit dem Startgleis-Wähler heißt das Feld `SimStatus.seatedTrack`). 12 neue Tests (rot vor dem Fix), Gates grün,
im Live-Lauf gemessen: Boot `e23@105` → Gruppe B `e43@100` → Gruppe A `e23@105`.

## D14 (Nutzermeldung) BH1/BH2/BH3-Schilder flackern / Text spiegelverkehrt — behoben

„Flickering BH1, BH2, BH3 as they are continually flipped direction": `createBoard` legte die
vordere und hintere Textfläche (und je eine Rückkopie beider Pfosten) **deckungsgleich**
übereinander, beide mit DoubleSide-Material. Der Tiefentest steht bei identischer Tiefe unent-
schieden, pro Pixel/Frame gewinnt abwechselnd die normale oder die gespiegelte Fläche —
das Schild „kippt" scheinbar ständig die Richtung (Z-Fighting). Gemessen am gebauten
Szenengraphen: Abstand der Textflächen **0 mm**, drei deckungsgleiche Mesh-Paare pro Schild.

Fix (`src/scene/labels.ts`): Textflächen ±0,4 mm entlang der Schildnormale
(`BOARD_FACE_GAP_MM` = 0,8), redundante Pfosten-Rückseiten entfernt (DoubleSide reicht).
Nachher: Abstand 0,8 mm, null deckungsgleiche Paare. Tests: `tests/scene/labelPlacement.test.ts`
(Trennung 0,5–4 mm gepinnt, Koinzidenz-Metrik mit Kontrolle, die nachweislich anschlagen kann).

## D15 (Nutzermeldung) Weichenschilder übereinander — behoben

Gemeldet als „xW01BH1G1 und xW01BH1G2 überlappen". Die Messung am gebauten Szenengraphen
(eigene Clipping-Metrik über die Weltmatrizen aller `label:`-Platten, real trackplan) ergab
zwei Paare — und korrigierte die Meldung:

| Paar | Überlappung |
|---|---|
| `xW01BH1G1` × `xW02BH1G1` | **325,4 mm²** (≈ 80 % der Platte — der vom Nutzer gesehene Stapel; beide Zungenschilder der kurzen `e22`, von beiden Enden 30 mm in die Mitte gesetzt) |
| `G4` × `xR01BH2G5` | **104,0 mm²** (Bahnsteig-Gleisschild über Reed-Schild, unberichtet) |

Fix: `deconflictPlates` (`src/scene/labels.ts`), ein deterministischer Nachlauf über die fertig
komponierte Szene (SceneManager nach den Reeds): überlappende Platten gleiten paarweise
entlang ihrer **eigenen Leserichtung** (Gleisrichtung) auseinander, 2-mm-Schritte, Budget
60 mm pro Platte — ein Schild bleibt bei seinem Referenten. Nachher: **0 überlappende Paare**
plattenweit, jedes Weichenschild < 110 mm von seinem Knoten (gepinnt). Kontrolle: eine künstlich
aufeinandergesetzte Platte wird von der Metrik erkannt (> 50 mm²).

## D16 (major, Nutzermeldung) Wagen springen auf andere Gleise — behoben

„Cabins jump to other rails — several times during running the solution of group A" (Screenshot:
ein Wagen auf dem Nachbargleis). Ursache ist die Kehrseite von D12: `TrackGraph.consistPath` lief
**bei jeder Snapshot** vom Zug aus über den lebenden Graphen und löste dabei auch die Knoten neu
auf, die der Zug längst befahren hat. Das Gruppe-A-Programm stellt Weichen hinter und unter dem
Zug — jede solche Umstellung setzte die Wagen zwischen zwei Frames auf den anderen Zweig. Der
D12-Kommentar „eine hinter der Lok gestellte Weiche nimmt die Wagen mit, genau wie auf der echten
Anlage" beschrieb das als gewollt; das ist es nicht: ein Fahrzeug steht auf der Schiene, auf der
es steht, nur Bewegung darf seine Kante ändern.

Neu (`src/plant/occupiedPath.ts`, `OccupiedPath`): der Plant führt das Gleis unter dem Zug als
**Zustand** mit — eine Kette von Kantenabschnitten in einer Bogenlängenkoordinate `u`, die in
Fahrtrichtung wächst. Aufgezeichnetes Gleis wird nie neu aufgelöst; die Kette wächst nur an ihrem
führenden Ende, um die gerade gefahrene Strecke, und löst jeden Knoten in dem Moment über
`nextEdge` auf, in dem das führende Fahrzeug ihn erreicht. Sie reicht nur so weit, wie der Zug
selbst reicht (`OCCUPIED_LEAD_MM` = 450 mm zur Wagenseite, zur Nase **0**); dahinter liegt Gleis,
auf dem nie ein Fahrzeug stand — dort bleibt der Live-Lauf über die aktuellen Weichenstellungen
die richtige Antwort (D12, Spawn). Bei der Sägefahrt spiegelt sich die Kette (`+s` dreht 180°), womit derselbe
Schienenstrang dieselben Stützpunkte behält und die Wagen beim Rückschub korrekt **führen**.
`ConsistPath` (Form und Bedeutung), `trainMesh.ts` und die Physik sind unverändert;
`Train.lastStepTravelMm` ist reine Beobachtung der Bewegung, kein Eingang in sie.

Gemessen am realen Gruppe-A-Lauf (150 s, 15 000 Physikschritte, drei Fahrzeuge über
`TrainVisual` gerendert, `alphaMs` = 0, Sprung = Weg eines Fahrzeugs in **einem** 10-ms-Schritt;
280 mm/s Höchstfahrt = 2,8 mm/Schritt):

| | vorher | nachher |
|---|---|---|
| Sprünge > 10 mm | **6** (43,5 s / 49,5 s / 55,9 s / 69,1 s) | **0** |
| größter Sprung | **63,6 mm** | — |
| max. Schritt Lok / Wagen 1 / Wagen 2 | 7,8 / 41,6 / **63,6 mm** | 2,8 / 2,8 / **2,8 mm** |

Ein Fall bleibt physikalisch unauflösbar: der Plant lässt eine Weiche unter einem **Wagen**
umlaufen (seine Belegtprüfung sieht nur die Lok, §5.3). Dann fährt die Lok später auf den neuen
Zweig, während ihre Wagen auf dem alten stehen — der Zug ist zerrissen, keine einzelne Polylinie
beschreibt ihn. Die Wagen gewinnen (eine Weiche darf kein Fahrzeug versetzen); die gezeichnete
Lok läuft dafür bis zum Wiederzusammenlauf der Routen neben ihrer wahren Position. Gemessen: im
Gruppe-A-Lauf genau **einmal**, ab 72,3 s, höchstens **50,7 mm** Abstand, nach 38 s wieder 0.
Erst jenseits von `RECORD_STRAY_MM` = 150 mm wird die Aufzeichnung verworfen (Runaway-Schutz).
**Dieser Rest ist mit D17 behoben** (die Aufzeichnung folgt der Lok, die gezeichnete Lok hängt an
ihrer veröffentlichten Position); die naheliegende Behebung — den Umlauf unter jedem Fahrzeug
sperren — ist gebaut, vermessen und verworfen worden. Beides unten unter D17.

Tests: `tests/plant/consistFreeze.test.ts` (lösungsfrei, `miniPlan`) pinnt beide Seiten — hinter
dem Zug 75/75 Stützpunkte, worst 189,7 mm vor dem Fix → 0 danach; unter den **führenden** Wagen
nach Sägefahrt 67/67 Stützpunkte, worst 167,0 mm → 0 — dazu die D12-Spawn-Semantik und eine
Kontrolle, die zeigt, dass der Vergleicher Bewegung überhaupt melden kann.
`tests/oracle/consistJump.oracle.test.ts` fährt die echte Gruppe-A-Lösung (überspringt sauber,
wenn sie fehlt) und misst die Tabelle oben; ein Diskriminator darin zeigt, dass die Physik selbst
nie mehr als 2,9 mm pro Schritt bewegt — jeder Millimeter des Sprungs kam aus dem Pfad.

### Adversariale Korrektur vor dem Commit: Nasenfenster 100 → 0

Die erste Fassung fror zusätzlich `OCCUPIED_NOSE_MM` = 100 mm **vor der Lok** ein — Gleis, das
kein Fahrzeug je befahren hat, im Widerspruch zur eigenen Regel der Aufzeichnung. Der
Physik-Verifikator konstruierte den Gegenbeweis (xW02E an `n3`, Anfahrt mit 280 mm/s, Umlauf
endet kontrolliert vor der Lok): endet die Stellung 40–95 mm voraus — also **im** Fenster —,
steht die eingefrorene Vor-Stellung gegen den tatsächlichen Fahrweg, der Stray-Schutz reißt die
Aufzeichnung um, und **die Lok selbst** springt (9 Sprünge, worst 113,7 mm; gezeichnete Lok bis
144,7 mm neben ihrer wahren Position). Mit Nasenfenster 0 messen dieselben Läufe **0 Sprünge**
und exakt die D12-Basislinie; Gruppe A/B bleiben bei 0. Gepinnt in
`tests/scene/consistLeadWindow.test.ts` (40/60/95 mm im Fenster gegen 300 mm außerhalb als
Nicht-Vakuitäts-Paar) samt Kopplungs-Pin `OCCUPIED_LEAD_MM` ≥ hinterste Render-Sonde + 50 mm.

**Offener Rest:** der in der Erstfassung hier empfohlene Physik-Block (Umlauf blockieren,
solange der Knoten unter irgendeinem Fahrzeug liegt) wurde gebaut, gemessen und **verworfen** —
und der Riss stattdessen in Aufzeichnung und Renderer geschlossen; die vollständige Analyse
und Behebung steht in **D18**.

## D17 (Nutzermeldung) Schilder getauscht: xW01BH1G1 auf der Weiche des Nachbarn — behoben

Nach D15 überlappten die Schilder nicht mehr, standen aber VERTAUSCHT: die Platzierung setzt
jedes Zungenschild 30 mm entlang der Zungenrichtung — bei den sich über die kurze `e22`
gegenüberliegenden Weichen also über die Mitte hinaus auf die Seite der jeweils ANDEREN Weiche;
das Flee-basierte D15-Auseinanderschieben trieb sie noch weiter dorthin. Die neue semantische
Metrik fand zusätzlich ein nie überlappendes, aber falsch stehendes Paar: `xW01BH2G2` /
`xW02BH2G2` (je 38,6 mm vom eigenen, 31,3 mm vom fremden Knoten).

Fix (`deconflictPlates`, zweistufig statt verschränkt): Jede Platte kennt ihren Referenten
(`userData.anchorWorld`). Stufe 1: falsch stehende Platten ziehen sich entlang ihrer
Leseachse zum eigenen Referenten zurück (geometrisch begrenzt — Halt querab des Ankers, kein
Oszillieren). Stufe 2: verbliebene Überlappungen fliehen wie in D15 (Budget 60 mm). Eine
verschränkte Variante (Retreat-Präferenz im Flee-Schritt) wurde gemessen und verworfen: ein
Flee-Schritt macht den Rückzug entlang der Achse wieder möglich, die nächste Iteration zog die
Platte in die Überlappung zurück — das `G4`×`xR01BH2G5`-Paar bewegte sich 25 Iterationen ohne
zu separieren (Trace im Fix-Verlauf).

Gepinnt (`tests/scene/labelPlacement.test.ts`, 13 Tests): null Überlappungen plattenweit,
JEDES Weichenschild näher am eigenen als an jedem fremden Weichenknoten (Knotenpaare ≥ 40 mm;
deckungsgleiche Paarknoten n16/n16b, n59/n59b ausgenommen), das gemeldete e22-Paar explizit
(xW01BH1G1 bei n12, xW02BH1G1 bei n15), plus die bestehenden Kontrollmetriken.

## D18 (major, Nutzermeldung aus der 3D-Ansicht) Zug stößt in BH3 Gleis 2 zurück, der Plant fährt nach Gleis 3 — behoben

Nutzermeldung: bei der Gruppe-A-Rangierfahrt **schiebt der gezeichnete Zug in Bahnhof 3 Gleis 2**
(`e70`), während die Anlage tatsächlich nach **Gleis 3** (`e74`) fährt. Das ist der in D16 als
„physikalisch unauflösbar" abgelegte Riss, aus der Nutzerperspektive gesehen — und es ist die
sichtbarste Fehlermeldung, die dieses Projekt bisher hatte: der Zug steht am Ende am falschen
Bahnsteig.

Gemessen im echten Lauf, Stand vor der Behebung, beim Halt am Ende der Rangierfahrt (t = 88,39 s):

| gezeichnetes Fahrzeug | Abstand zu `e70` (Gleis 2) | Abstand zu `e74` (Gleis 3) |
|---|---|---|
| Lok | **0,0 mm** | 50,0 mm |
| Wagen 1 | 136,0 mm | 51,9 mm |
| Wagen 2 | 286,9 mm | 99,9 mm |

Die Behebung besteht aus zwei unabhängigen Teilen, unten einzeln belegt: der **Aufzeichnung**
(`OccupiedPath.reresolveLead`, behebt die Meldung) und dem **Renderanker** der Lok
(`trainMesh.anchorLoco`, behebt einen davon unabhängigen Restversatz). Der zuerst untersuchte
Weg — die Physik zu ändern — ist geprüft und verworfen; diese Analyse steht unten, weil sie die
Begründung dafür ist, dass der Fall im Renderer und in der Aufzeichnung gelöst wird und nicht im
Plant.

### Teil 1: die Aufzeichnung folgt der Lok — `OccupiedPath.reresolveLead`

Läuft eine Weiche um, deren Knoten auf aufgezeichnetem Gleis liegt, **das die Lok noch nicht
befahren hat, aber gleich befahren wird** — also beim Rückschub zwischen Lok und führender
Spitze —, so wird die Aufzeichnung **jenseits dieses Knotens** mit der neuen Weichenstellung neu
aufgelöst. Der Plant löst jeden Knoten live auf, wenn sein Zug ihn erreicht; die Lok *wird* also
den neuen Zweig nehmen. Den alten dort eingefroren zu lassen hält den Zug nicht zusammen, es
zerreißt ihn garantiert.

Die D16-Einfrierregel bleibt sonst unangetastet: **hinter** der Lok und an jedem Knoten, den die
Lok bereits überquert hat, wird nie neu aufgelöst. Zusätzlich ist der Aufruf an Bewegung
gekoppelt (`Plant.step`) — ein stehender Zug fährt nirgendwohin, also gilt für ihn die
Einfrierregel unverändert, und genau das pinnt `tests/plant/consistFreeze.test.ts` weiter.

Kosten: eine einmalige Korrektur in dem Moment, in dem die Weiche umläuft. Im Gruppe-A-Lauf
bewegt sie **Wagen 2 um 13,7 mm** (t = 69,05 s, `xW02BH3G2`); Lok und Wagen 1 bleiben bei
2,8 mm/Schritt. Das ist die einzige Ausnahme im Sprung-Oracle und dort **namentlich** gepinnt,
nicht durch Anheben der Schwelle (`tests/oracle/consistJump.oracle.test.ts`).

Nachher, gleicher Halt (t = 88,39 s): Lok **0,0 mm** von `e74`, Wagen 1 **0,0 mm**, Wagen 2
**48,9 mm** — alle drei näher an Gleis 3 als an Gleis 2 (Wagen 2: 288,0 mm zu `e70`). Gepinnt in
`tests/oracle/consistFootprint.oracle.test.ts` samt Nicht-Vakuitäts-Kontrolle, die zeigt, dass die
Metrik sehr wohl „Gleis 2" melden kann.

**Stresslauf** (`tests/scene/consistStress.test.ts`, lösungsfrei auf `miniPlan`, weil die
Rückfahrt die Weiche *spitz* befahren muss — ein Rundumschlag über die 42 Weichen des echten
Plans trifft den Fall nicht und misst nichts: 22 Umläufe im Führungsfenster, 6,8 mm Ausschlag
vorher wie nachher):

| Weiche umgelegt … | vorher Sprünge / größter | vorher Aufzeichnung unter der Lok | nachher Sprünge / größter | nachher |
|---|---|---|---|---|
| 400 mm vor der Lok | 5 / **307,7 mm** | **149,6 mm** | **0** | 13,1 mm |
| 200 mm vor der Lok | 5 / **307,7 mm** | **149,6 mm** | 1 / 77,2 mm | 13,1 mm |

Die 149,6 mm sind der Stray-Schutz, der die Kette zerschneidet und neu wachsen lässt — dieselbe
Störung, die D16 mit 156,4 mm notiert hatte. Die 13,1 mm nachher sind kein Aufzeichnungsfehler,
sondern die Sehnenverkürzung der Renderprobe an der scharfen `eD`-Ecke der Fixture. Die 77,2 mm
im zweiten Fall sind die Korrektur selbst, wenn Wagen 2 den Knoten schon weit passiert hat; auf
dem echten Plan kostet dasselbe Ereignis 13,7 mm, weil echte Weichen viel flacher abzweigen.

### Teil 2: die Lok hängt an ihrer veröffentlichten Position — `trainMesh.anchorLoco`

Unabhängig vom Riss las der Renderer die Lok als **Mittelpunkt zweier Pfadstützpunkte 84 mm
auseinander**. Auf einer Kurve schneidet diese Sehne die Ecke: gemessen bis **8,1 mm** neben der
veröffentlichten Position, 25,3 s des Laufs über 3 mm — auch nachdem die Aufzeichnung korrekt
ist. Die Lok wird deshalb an `worldPos` verankert (plus der unveränderten Zwischenschritt-
Glättung `alphaMm` entlang `headingRad`).

**Nur die Position.** Die Orientierung kommt weiterhin aus derselben Sehne wie bei den Wagen,
und zwar aus einem gemessenen Grund: `headingRad` ist die exakte Polylinientangente und an
Kantenübergängen **unstetig** — mit ihr als Gierwinkel springt die Lok im Gruppe-A-Lauf um bis zu
**22,03°** in einem 10-ms-Schritt (54 Schritte über 2°, immer bei Kanteneintritt, Offset < 2 mm)
und der Kamera-Ankerpunkt um 19,3 mm, gegen 1,36° / 2,90 mm mit der Sehne.

Messwerte am vollen Gruppe-A-Lauf (150 s, 15 000 Schritte):

| | `alphaMs` = 0 | = 8 | = 16 |
|---|---|---|---|
| Lok-Versatz vorher | 50,693 mm | 50,799 mm | 50,912 mm |
| Lok-Versatz nachher | **0,000 mm** | 2,24 mm | 4,48 mm |
| größter Lok-Schritt vorher → nachher | 2,800 → **2,800 mm** | 2,800 → 2,812 mm | 2,802 → 2,825 mm |
| größter Gierschritt vorher → nachher | 1,359° → **1,359°** | 1,370° → 1,370° | 1,343° → 1,343° |
| Kamera-Anker vorher → nachher | 2,895 → 3,042 mm | 2,896 → 3,039 mm | 2,897 → 3,059 mm |
| Zuglänge (Mitte zu Mitte) | 292,00 → 292,00 mm | 292,00 → 292,03 mm | 292,00 → 292,06 mm |

Die Versatzwerte bei `alphaMs` > 0 sind exakt 280 mm/s × `alphaMs`, also die Glättung selbst: der
ganze Zug gleitet gemeinsam, der Anker fügt keinen Fehler hinzu. Eine Deckelung der Lok-Glättung
auf einen Physikschritt wurde verworfen — sie staucht den gezeichneten Zug, sobald `alphaMs` einen
Schritt übersteigt (der 50-ms-Interpolationsvertrag in `tests/scene/train.test.ts` misst dann
2,0 mm Lok gegen 10,0 mm Wagen), und `RafDriver` liefert ohnehin nur `SimClock.pendingMs` < 10 ms.

### Verworfener Weg: Weichenumlauf unter dem Wagen sperren

Der offene Rest aus D16 lautete: die Belegtprüfung `trainOccupiesNode` sieht nur die Lok, also
läuft eine Weiche unter einem *Wagen* um, der Zug wird zerrissen, und die gezeichnete Lok läuft
bis zu 50,7 mm neben ihrer wahren Position. Die vorgeschlagene Lösung — den Umlauf sperren,
solange der Knoten unter *irgendeinem* Fahrzeug liegt — wurde gebaut, vermessen und wieder
ausgebaut. Sie ist **nicht lieferbar**: sie zerstört den Gruppe-A-Referenzlauf und macht den
Renderfehler, den sie beheben soll, dreimal so groß.

**Gebaute Fassung.** `OccupiedPath.coversNode` beantwortet die Belegtfrage aus der
Aufzeichnung (Wagenseite `[Lok, Lok + OCCUPIED_LEAD_MM]`), die Nase bleibt bei
`SWITCH_OCCUPANCY_MM` = 50 mm aus dem Loksitz, `Plant.trainOccupiesNode` verodert beides. Für den
Aufschub wurden **beide** denkbaren Semantiken gemessen: *Timer pausiert* (Zungen, auf denen ein
Spurkranz steht, legen keinen Weg zurück) und *Timer läuft, Stellung rastet beim Freiwerden ein*.

**Messung am echten Gruppe-A-Lauf** (Programm aus `reference/Claude_work/gruppeA.txt`, Seed 42, Bounce an,
Lauf bis zur Ruhebedingung; Erwartungssatz = `tests/oracle/expectations/gruppeA.json` über
`assertAllExpectations`; Lok-Versatz = gezeichneter Lokkörper gegen `snapshot.train.worldPos`):

| Fußabdruck Wagenseite | Erwartungen | Lauf endet | Lok-Versatz | Sprünge > 10 mm | größter Sprung |
|---|---|---|---|---|---|
| keine Sperre (Ist-Zustand) | **grün** | 230,1 s | 50,7 mm | 0 | 2,8 mm |
| 218 mm | grün | 230,1 s | 50,7 mm | 0 | 2,8 mm |
| 258 mm | grün | 230,1 s | 50,7 mm | 0 | 2,8 mm |
| 260 mm | **rot** | Abbruch bei 600 s | 151,4 mm | 5 | 443,8 mm |
| 262 / 366 / 450 mm | **rot** | Abbruch bei 600 s | 151,4 mm | 5 | 443,8 mm |
| 450 / 366 mm, Einrast-Semantik | **rot** | Abbruch bei 600 s | 151,4 mm | 5 | 443,8 mm |

Die Semantik ist also gar nicht die Frage: Pausieren und Einrasten liefern Zeile für Zeile
dieselben Zahlen. Entschieden wird alles von der Geometrie, und die Kippkante liegt zwischen
258 und 260 mm.

**Warum.** Ein Zensus aller Weichenumläufe des Laufs (neu:
`tests/oracle/consistFootprint.oracle.test.ts`, projiziert den Weichenknoten auf den
veröffentlichten Pfad) findet genau drei Umläufe, deren Knoten in **Wagen 2** liegt:

| Weiche/Knoten | Umlauf endet | Knoten ab Lokmitte | im Wagenkörper |
|---|---|---|---|
| `xW01D`/`n1` | 55,89 s | **259,0 mm** | 40,5 mm in Wagen 2 |
| `xW02BH3G2`/`n69` | 69,04 s | **261,4 mm** | 43,4 mm in Wagen 2 |
| `xW02BH3G2`/`n69` | 113,79 s | −304,3 mm | 61,7 mm in Wagen 2 |

Der zweite ist der Riss aus D16. Der **erste ist ein Umlauf, den die Lösung braucht**: A-NW8
stellt `xW01D G`, damit die rückwärtige spitzbefahrene Fahrt `toe(e39) → e38` genau den Zweig
nimmt, den die Aufzeichnung auf dem Hinweg eingefroren hat (`mappingEvidence` in
`trackplan.json`). Beide Knoten liegen im selben Wagen, 2,4 mm auseinander — und der *gebrauchte*
liegt **näher** an der Lok als der *schädliche*. Jedes Fenster, das den Riss sperrt, sperrt
zwangsläufig auch den gebrauchten Umlauf. Gemessene Folge: `xW01D` bleibt auf R, die Lok fährt bei
59,19 s auf `e0` statt `e38`, verlässt damit ihre eigene aufgezeichnete Strecke, der
Stray-Schutz (`RECORD_STRAY_MM`) reißt die Aufzeichnung um — daher die 443,8 mm — und der Lauf
erreicht `xR02BH3G3` nie wieder. Gruppe B ist von der Sperre unberührt (Ereignisstrom
byte-identisch), was zeigt, dass die Sperre nicht generell falsch ist, sondern genau an dieser
Stelle.

Ein Aufschub kann daran nichts ändern: beim Rückschub **führen** die Wagen, die Lok ist das
letzte Fahrzeug über dem Knoten. Der Knoten wird erst frei, wenn die Lok ihn passiert hat — in
der gebauten Fassung lief `xW01D` um 60,10 s um, die Lok hatte `n1` bei 59,19 s bereits
überquert.

**Der eigentliche Befund.** Der Riss ist kein Physikfehler. Der Plant modelliert eine **Lok als
Punkt** (§5.3, `magnetOffsetMm: 0`, „Magnet in Lokmitte"); die zwei Wagen existieren nur im
Renderer (§3 `trainMesh.ts`). Für eine Sololok liegen beide Knoten mit 259 bzw. 261 mm weit
außerhalb der 50-mm-Lokhülle — die Umläufe sind legal, und genau davon geht die
Aufgabenstellung aus. Die Sperre importiert eine Renderdekoration in die Physik; deshalb bricht
sie den Referenzlauf. Solange der Renderer einen längeren Zug zeichnet, als der Plant fährt, muss
**er** den Fall tragen.

Daraus folgte die tatsächlich umgesetzte Behebung: die Aufzeichnung folgt der Lok
(`reresolveLead`) und die gezeichnete Lok hängt an ihrer veröffentlichten Position
(`anchorLoco`) — beides oben belegt. **Physik und Oracle-Erwartungen bleiben unberührt**: die
Aufzeichnung ist Plant-*Zustand*, aber kein Eingang in die Bewegung, und die Ereignisströme
beider Referenzläufe sind byte-identisch zu vorher.

**Gepinnt** in `tests/oracle/consistFootprint.oracle.test.ts` (überspringt sauber ohne die lokale
Lösung): der Zensus mit genau 3 überdeckten gegen > 10 freie Umläufe als
Nicht-Vakuitäts-Kontrolle, und die Ordnung 259,0 < 261,4 mm, an der die ganze Ablehnung hängt.

## D19 (Nutzermeldung) Gruppe B: Zug biegt am Anfang nicht nach BH3 Gleis 2 ab — Startplatz-Falle, drei Guards geliefert (der dritte im Nachtrag)

Nutzermeldung 2026-08-01: mit der Gruppe-B-Lösung „fährt der Zug am Anfang nicht nach
BH3 G2 ein, sondern direkt nach BH2". **Lösung und Simulator sind beide korrekt; der
Startplatz war falsch**, und zwei UX-Fallen haben ihn dorthin gebracht:

1. **Die Gleiswahl setzt in die Gleismitte — hinter den Auslöse-Reed der eigenen Spur.**
   Auf BH1 G4 (`e43`, 1222,6 mm) ist die Mitte 611,3 mm, der B-NW3-Auslöser `xR03BH1G4`
   liegt bei 346,8 mm. Von dort feuern die Netzwerke 3/4 in Runde 1 nie, und der Zug läuft
   durch den C-Bereich direkt nach BH2 G3. Belegt durch ein Drei-Sitze-Experiment über
   `tests/oracle/scenarioRunner.ts`; der gepinnte §7.1-Aufgabensitz (`e43` @ 100 mm) ist
   die Kontrolle, die sich korrekt verhält. Tückisch daran: die Chooser-Anzeige „BH1 G4"
   ist für beide Sitze identisch — nur die Provenienz unterscheidet sie.
2. **Ein Reload stellte den Editor-Puffer wieder her, den Sitz aber nicht.** F5 setzte die
   Lok stumm auf den §7.1-Standardstart zurück (`seatedExerciseId` war reine Laufzeit),
   während die Gruppe-B-Lösung im Editor stehen blieb.

Geliefert (Entwurf samt offener Option: `docs/DESIGN_START_SEAT_GUARD.md`):

- **Sichtbare Sitz-Notiz im ControlPanel** (`controls.seatMismatch`): offene Aufgabe und
  ein Sitz ohne deren Provenienz → sichtbarer Hinweis unter der Gleiswahl, dass der
  Live-Lauf von den bewerteten Checks abweichen kann. Nur abgeleiteter Zustand — Notiz =
  f(vom Host gemeldeter Sitz, offene Aufgabe); die D13-Ein-Zustand-Regel um ein Pixel
  erweitert. `.start-note[hidden]`-Gegenregel im Stylesheet (die Lektion aus dem
  WatchPanel-Filter); beide Hälften gepinnt in `tests/ui/controlPanel.test.ts`.
- **Der Sitz überlebt den Reload** (`mat2sps.seat.v1`, `src/ui/seatStorage.ts`): ein
  erfolgreicher `setExercise`/`setStartTrack` schreibt den Sitz, der Boot stellt ihn über
  DIESELBEN gepinnten Auflösungen wieder her (`startForExercise` / `startSpecForTrack`) —
  D13 per Konstruktion. Lesen ist total (ein kaputter Eintrag kostet die Wiederherstellung,
  nie den Boot), und eine unbekannte Aufgaben-Id wird VERWORFEN statt auf den Standard
  aufgelöst — sonst würde die Anzeige eine Provenienz behaupten, die die Anlage nicht hat.
  Gepinnt in `tests/ui/seatStorage.test.ts`, samt Kontrolle, dass `startForExercise` allein
  die unbekannte Id sehr wohl auf den Standard auflösen würde.
- **Gleismitte-Semantik:** blieb im ersten Wurf unangetastet (Owner-Entscheidung
  vorbehalten); siehe Nachtrag unten.

### Nachtrag (gleicher Tag): Owner-Entscheidung — Guard (a) gebaut, Gleismitte aufgegeben

Der Owner hat noch am 2026-08-01 entschieden: „also do guard (a), ignore the ‚middle of
the track'". Die Gleiswahl setzt seither auf den **Gleismittelpunkt, stromaufwärts
gezogen vor den ersten VERDRAHTETEN Reed der Spur** (Marge 100 mm; Boden 100 mm vom
Gleisende — die §7.1-Sitzkonvention: `e23` @ 105 mm, `e43` @ 100 mm; 100 mm = 20× der
Schließradius `reedWindowMm/2`). Richtung −1 gespiegelt (stromaufwärts = höherer Offset).
Die Regel ist monoton — der Sitz wandert nur stromaufwärts von der Mitte —, also verliert
kein Gleis einen Reed, der vorher schon vor dem Sitz lag.

Vermessung aller 12 Gleise (über die gelieferten Module, nicht von Hand): 9 Sitze wandern
(BH1 G1→100, BH1 G2→1093,6 [dir −1], BH1 G3→296,9, **BH1 G4→246,8** [der D19-Fall:
Mitte 611,3 lag HINTER `xR03BH1G4` @ 346,8], BH2 G1→297,3, BH2 G2→100, BH2 G3→100,
BH2 G5→100, BH3 G3→160,8); 3 bleiben Mitte (BH2 G4, BH3 G1 ohne verdrahteten Reed auf
dem eigenen Gleis; BH3 G2, dessen `xR01BH3G2` auf `e9` sitzt, nicht auf `e70`). Kein Sitz
spawnt in einem Reedfenster (engster Fall BH2 G3: 13,4 mm Abstand vs 5 mm Radius).

Gepinnt in `tests/plant/startTracks.test.ts` als bewusster Doppel-Edit: die wörtliche
Offset-Tabelle UND die unabhängige Neu-Herleitung aus dem rohen JSON UND die Messung am
fahrenden Plant (von jedem Sitz feuert jeder vor dem Sitz liegende Spur-Reed; Kontrolle:
der alte Mittelsitz auf BH1 G4 verfehlt `xR03BH1G4` — wortwörtlich die Nutzermeldung).
Dazu die unbedingten Invarianten (Sitz strikt im Gleis, nie stromabwärts der Mitte — der
Boden weicht auf Gleisen kürzer als 200 mm der Mitte, synthetisches Kurzgleis gepinnt) und
die Kontrolle, dass kein Sitz auf einem geschlossenen Reed spawnt. Die Chooser-Titeltexte
(EN/DE) versprechen nur noch, dass die Reedkontakte des Gleises „möglichst vor" der Lok
liegen — nicht die Mitte, und auch nicht mehr, als der 100-mm-Boden halten kann.

**Route-Beweis mit der echten Gruppe-B-Lösung** (Opus-Agent, gemessen über den
Oracle-Stack, Skript außerhalb des Repos): vom neuen Chooser-Sitz `e43` @ 246,8 mm feuert
`xR03BH1G4` bei 3,45 s, die Lok erreicht **BH3 G2 (`e70`) bei 48,32 s in Runde 1**, und
der Lauf BESTEHT den gelieferten §9.4-Erwartungssatz; die Ereignisfolgen (Reeds, Kanten,
Fahrbefehle) sind mit dem gepinnten §7.1-Sitz (`e43` @ 100 mm) identisch. Kontrolle: der
alte Mittelsitz (611,3 mm) erreicht in Runde 1 kein BH3-Reed, fährt zuerst BH2 G3 an
(35,42 s — wortwörtlich die Nutzermeldung) und FÄLLT durch den Erwartungssatz.
