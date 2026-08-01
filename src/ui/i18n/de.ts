/**
 * German dictionary (ARCHITECTURE.md §5.6) — a TOTAL Record<MsgKey, string> checked by
 * tsc: a key missing here (relative to en.ts) is a compile error.
 *
 * Fachsprache wie im Praktikum: Anweisungsliste (AWL), Zykluszeit, Merker, Weichenspulen,
 * Beobachtungstabelle, Not-Aus.
 */
import type { MsgKey } from './i18n';

export const de: Record<MsgKey, string> = {
  // ── Rahmen ───────────────────────────────────────────────────────────────
  'app.title': 'MAT2 SPS 3D-Simulator',
  'app.subtitle': 'AWL-Emulator mit 3D-Modellbahnanlage',
  'app.subtitlePump': 'AWL-Emulator mit der 3D-Pumpenanlage der Anleitung',
  'app.loading': 'Wird geladen…',
  'lang.label': 'Sprache',
  'lang.en': 'EN',
  'lang.de': 'DE',
  'lang.switchTo': 'Oberflächensprache auf {lang} umstellen',

  // ── Versuchsauswahl ──────────────────────────────────────────────────────
  'experiment.label': 'Versuch',
  'experiment.railway': 'Modellbahn',
  'experiment.pump': 'Pumpe',
  'experiment.switchTo': 'Zum Versuch {name} wechseln — die Seite wird neu geladen; jeder Versuch behält sein eigenes Programm',

  // ── Statuszeile ──────────────────────────────────────────────────────────
  'status.ready': 'Bereit',
  'status.running': 'Läuft',
  'status.paused': 'Angehalten',
  'status.simTime': 'Simulationszeit {value} s',
  'status.cycle': 'Zyklus {value}',
  'status.scan': 'Zykluszeit {value} ms',
  'status.noProgram': 'Kein Programm geladen',
  'status.programLoaded': 'Programm geladen ({count} Anweisungen)',
  'status.programErrors': 'Programm nicht geladen — {count} Fehler',
  'status.notausActive': 'NOT-AUS aktiv',
  'status.derailed': 'Zug entgleist — Reset erforderlich',
  'status.simUnavailable': 'Simulationskern nicht verfügbar: {reason}',
  'status.dataMissing': 'Anlagendaten (src/data) noch nicht vorhanden — die 3D-Anlage bleibt leer.',

  // ── Editor ───────────────────────────────────────────────────────────────
  'editor.title': 'AWL-Programm',
  'editor.load': 'In SPS laden',
  'editor.loadTitle': 'Programm übersetzen und in den Emulator übertragen (Strg+Enter)',
  'editor.dirty': 'nicht übertragene Änderungen',
  'editor.saved': 'deckungsgleich mit der SPS',
  'editor.symbols': '{count} Symbole für die Vervollständigung verfügbar',
  'editor.symbolsNone': 'Symbolliste nicht verfügbar — Vervollständigung nur für Anweisungen',
  'editor.clear': 'Leeren',
  'editor.clearTitle': 'Editorinhalt löschen',
  'editor.label': 'AWL-Quelltext',

  // ── Vervollständigung ────────────────────────────────────────────────────
  'completion.mnemonic': 'Anweisung',
  'completion.symbol': 'Symbol',
  'completion.address': 'Adresse',
  'completion.literal': 'Konstante',

  // ── Meldungen ────────────────────────────────────────────────────────────
  'diagnostics.title': 'Meldungen',
  'diagnostics.none': 'Keine Meldungen.',
  'diagnostics.error': 'Fehler',
  'diagnostics.warning': 'Warnung',
  'diagnostics.info': 'Hinweis',
  'diagnostics.at': 'Zeile {line}, Spalte {col}',
  'diagnostics.hint': 'Hinweis',
  'diagnostics.jumpTo': 'Im Editor anzeigen',
  'diagnostics.summary': '{errors} Fehler, {warnings} Warnung(en)',

  // ── Bedienung ────────────────────────────────────────────────────────────
  'controls.title': 'Bedienung',
  'controls.run': 'Start',
  'controls.runTitle': 'Zyklische Bearbeitung starten',
  'controls.stop': 'Stop',
  'controls.stopTitle': 'Bearbeitung anhalten (Zustand bleibt erhalten)',
  'controls.reset': 'Reset',
  'controls.resetTitle': 'SPS-Speicher, Zeiten, Zähler und Anlage zurücksetzen',
  'controls.scan': 'Zykluszeit',
  'controls.scanTitle': 'Simulierte SPS-Zykluszeit',
  'controls.speed': 'Zeitraffer',
  'controls.speedTitle': 'Simulationszeit beschleunigen oder verlangsamen',
  'controls.notaus': 'NOT-AUS',
  'controls.notausTitle': 'Rastender Taster: E 1.7 (NotausBit) wird 0 — Ihr Programm muss den Zug stoppen',
  'controls.notausRelease': 'Entriegeln',
  'controls.startTrack': 'Startgleis',
  'controls.startTrackTitle': 'Startposition der Lok — die Gleiswahl setzt die Anlage zurück und stellt die Lok in die Mitte des Gleises, Blickrichtung IU',
  'controls.startTrackFromExercise': 'steht zurzeit auf dem Startgleis der geöffneten Aufgabenstellung',
  'controls.startStation': 'Bahnhof',
  'controls.startStationTitle': 'Bahnhof, in dem die Lok startet',
  'controls.startLane': 'Gleis',
  'controls.startLaneTitle': 'Gleis dieses Bahnhofs, auf dem die Lok startet',
  'controls.startLaneDeadEnd': 'Stumpfgleis',
  'controls.camera': 'Kamera',
  'controls.labels': 'Schilder',
  'controls.labelsTitle': 'Weiße xW…/xR…-Namensschilder in der 3D-Ansicht einblenden',

  // ── Anpassbares Layout (§5.7) ────────────────────────────────────────────
  'layout.title': 'Layout',
  'layout.reset': 'Layout zurücksetzen',
  'layout.resetTitle': 'Standardgrößen der Fenster wiederherstellen',
  'layout.splitterHint': 'Ziehen oder Pfeiltasten benutzen (Shift = größerer Schritt). Doppelklick, Pos1 oder Ende stellt den Standard wieder her.',
  'layout.splitter.toolsCentre': 'Größe ändern: Aufgabenspalte / Programmspalte',
  'layout.splitter.centreRight': 'Größe ändern: Programmspalte / 3D-Spalte',
  'layout.splitter.editorMessages': 'Größe ändern: AWL-Programm / Meldungen',
  'layout.splitter.viewportWatch': 'Größe ändern: 3D-Anlage / Variablentabelle',

  // ── Eingänge erzwingen („Selbst testen“, §10.3) ──────────────────────────
  'inputs.title': 'Selbst testen: Eingänge',
  'inputs.note': 'Klick erzwingt ein Eingangsbit des geladenen Programms, erneuter Klick gibt es frei. Ein erzwungenes Bit behält seinen Wert, auch wenn ein Reedkontakt es ansteuern würde — so laufen die Zeit- und Flankenbeispiele der Anleitung ohne die Anlage.',
  'inputs.toggleTitle': 'Eingang {address} im Prozessabbild (PAE) erzwingen — erneuter Klick gibt ihn frei',
  'inputs.notePump': 'Klicken erzwingt ein Eingangsbit des geladenen Programms, erneutes Klicken gibt es frei. Ein erzwungenes Bit behält seinen Wert auch dann, wenn ein Grenzschalter oder ein Taster ihn treiben würde — praktisch, um einen Zweig zu prüfen, in dem die Tanks gerade nicht stehen.',

  // ── Bedienelemente der Anlage, mit der Tastatur erreichbar (§ Versuche) ───
  'plant.title': 'Bedienelemente der Anlage',
  'plant.note': 'Dieselben Bedienelemente wie am 3D-Pult, mit Tabulator und Tastatur bedienbar. S1 und S0 sind Taster: sie bleiben nur gedrückt, solange Sie sie halten. Die Schalter und die Handventile rasten ein.',
  'plant.holdTitle': '{name} zum Betätigen gedrückt halten — Maustaste oder Leertaste; beim Loslassen fällt der Taster ab',
  'plant.toggleTitle': '{name} ein- oder ausschalten',
  'plant.valve.inA': 'Handventil Zulauf → Tank A',
  'plant.valve.outB': 'Handventil Ablauf ← Tank B',

  // ── Vorlagen-Erkennung (§5.1.5 I-TPL-001 / W-TPL-001) ────────────────────
  'template.detected': 'Aufgabenvorlage erkannt: {networks} Netzwerk(e) gefunden, {instructions} Anweisung(en) übersetzt, {ignored} Zeile(n) Aufgabentext übergangen. Ihre Datei bleibt unverändert — in die SPS geladen werden nur die Abschnitte nach „--Bitte hier programmieren--“.',
  'template.cleaned': '{instructions} Anweisung(en) geladen. {ignored} Vorlagenzeile(n) — Trennlinien, blanke „Netzwerk n“-Überschriften, Punktangaben — wurden nicht als Anweisung übersetzt.',
  'template.stray': 'Zeile übergangen: „{text}“ sieht wie eine Anweisung aus, liegt aber außerhalb eines Abschnitts „--Bitte hier programmieren--“ und wurde nicht geladen.',
  'template.strayHint': 'Verschieben Sie die Zeile unter die Marke „--Bitte hier programmieren--“ ihres Netzwerks, oder löschen Sie die Trennlinie darüber.',

  // ── Laufzeitwarnungen der Koordinationsschicht ───────────────────────────
  'runtime.unplacedSwitch': 'Weiche {switchId} ist auf diesem Anlagenmodell nicht vorhanden — der Spulenbefehl (Spule {coil}) bleibt wirkungslos.',
  'runtime.unplacedSwitchHint': 'Das Symbol steht in der Variablenliste, im Gleisplan gibt es diese Weiche aber nicht. Verwenden Sie eine auf der Anlage vorhandene Weiche.',

  // ── Kameras (§5.4) ───────────────────────────────────────────────────────
  'camera.orbit': 'Orbit',
  'camera.bird': 'Vogelperspektive',
  'camera.cab': 'Führerstand',
  'camera.trackside': 'Streckenkamera',

  // ── Ansicht ──────────────────────────────────────────────────────────────
  'viewport.title': '3D-Anlage',
  'viewport.unavailable': '3D-Ansicht nicht verfügbar: {reason}',

  // ── Beobachtungstabelle (§10.4) ──────────────────────────────────────────
  'watch.title': 'Beobachtungstabelle',
  'watch.name': 'Symbol',
  'watch.address': 'Adresse',
  'watch.value': 'Wert',
  'watch.empty': 'Keine Zeilen.',
  'watch.unavailable': 'Beobachtungswerte nicht verfügbar: {reason}',
  'watch.filter': 'Filter',
  'watch.filterPlaceholder': 'Symbol oder Adresse…',
  'watch.section.inputs': 'Eingänge E (Reedkontakte, Not-Aus)',
  'watch.section.output': 'Ausgangswort (Fahrstrom)',
  'watch.section.system': 'Systemmerker (Fahrstufen / STOP / Notaus-Flanke)',
  'watch.section.coils': 'Weichenspulen M 100 – M 111',
  'watch.section.student': 'Merker für Studierende M 10 – M 20',
  'watch.section.timers': 'Zeiten T 10 – T 20',
  'watch.section.counters': 'Zähler Z 1',
  'watch.section.pumpInputs': 'Eingänge E (Taster, Grenzschalter, Kippschalter)',
  'watch.section.pumpOutputs': 'Ausgänge A (Pumpe, Meldeleuchten)',
  'watch.section.pumpFlags': 'Merker M 0 – M 20 (die Anleitung nutzt M 0.0)',
  'watch.timer': '{remaining} / {preset} ms',
  'watch.counter': 'Zählerstand {value}',
  'watch.q': 'Q',
  'watch.bitsHint': 'Bit 7 … Bit 0',

  // ── Anlagendetails ───────────────────────────────────────────────────────
  'switch.assumedMapping': 'Angenommene Verdrahtung: Die Zuordnung G/R → Zweig ist für diese Weiche nicht dokumentiert und wurde konsistent gewählt. Aus G und R lässt sich nie eine Fahrtrichtung ableiten.',

  // ── Seitenleisten-Tabs ───────────────────────────────────────────────────
  'tabs.exercises': 'Aufgaben',
  'tabs.hints': 'Hinweise',
  'tabs.examples': 'Beispiele',
  'tabs.parameters': 'Parameter',

  // ── Statische Aufgabenbeschreibung (Versuch Pumpe) ───────────────────────
  'task.title': 'Aufgabe',
  'task.note': 'Dieser Versuch wird nicht bewertet. Er ist das Lehrbeispiel der Anleitung: Sie können jede Anweisung an einer laufenden Anlage ausprobieren — Starten, Stoppen, Befüllen und Ablassen von Hand in der 3D-Ansicht.',

  // ── Anlagenparameter (Versuch Pumpe) ─────────────────────────────────────
  'params.title': 'Anlagenparameter',
  'params.unavailable': 'Anlagenparameter nicht verfügbar: {reason}',
  'params.note': 'Förderleistung, Schaltpunkte und Trockenlaufverzögerung wirken sofort. Die beiden Anfangsfüllstände gelten ab dem nächsten Zurücksetzen.',
  'params.reset': 'Auf Standardwerte',
  'params.resetTitle': 'Jeden Parameter auf seinen dokumentierten Standardwert zurücksetzen',
  'params.range': 'zulässig {min} – {max} {unit}',
  'params.sliderLabel': '{label} (Schieberegler)',
  'params.valueLabel': '{label} (Wert)',
  'params.applyLive': 'sofort',
  'params.applyOnReset': 'nach Zurücksetzen',
  'params.field.pumpRatePctS': 'Förderleistung A → B',
  'params.field.refillRatePctS': 'Zulauf (Ventil in A)',
  'params.field.drainRatePctS': 'Ablauf (Ventil aus B)',
  'params.field.llsThresholdPct': 'Schaltpunkt LLS (Leermeldung)',
  'params.field.hlsThresholdPct': 'Schaltpunkt HLS (Vollmeldung)',
  'params.field.dryRunDelayS': 'Trockenlaufverzögerung',
  'params.field.initialVolAPct': 'Anfangsfüllstand Tank A',
  'params.field.initialVolBPct': 'Anfangsfüllstand Tank B',
  'params.unit.pctPerS': '%/s',
  'params.unit.pct': '%',
  'params.unit.s': 's',

  // ── Aufgabenbrowser (§10.1) ──────────────────────────────────────────────
  'exercise.title': 'Aufgaben',
  'exercise.unavailable': 'Aufgabendaten nicht verfügbar: {reason}',
  'exercise.points': '{points} P',
  'exercise.status.untouched': 'neu',
  'exercise.status.attempted': 'versucht',
  'exercise.status.passed': 'bestanden',
  'exercise.back': '← Alle Netzwerke',
  'exercise.taskDe': 'Aufgabe (Original, Deutsch)',
  'exercise.taskEn': 'Übersetzung (Englisch)',
  'exercise.symbolNotes': 'Symbolhinweis',
  'exercise.runChecks': 'Checks ausführen',
  'exercise.runChecksTitle': 'Programm in eine frische SPS + Anlage laden und das Prüfszenario dieses Netzwerks abspielen (deterministisch, 50 ms Zyklus)',
  'exercise.runningChecks': 'Checks laufen…',
  'exercise.noProgram': 'Kein Programm geladen — Lösung im Editor schreiben und zuerst „In SPS laden“ drücken.',
  'exercise.checkError': 'Prüflauf fehlgeschlagen: {reason}',
  'exercise.results': 'Prüfergebnisse',
  'exercise.resultSummary': '{passed} bestanden · {failed} fehlgeschlagen · {pending} nicht geprüft',
  'exercise.result.pass': 'Bestanden',
  'exercise.result.fail': 'Fehlgeschlagen',
  'exercise.result.pending': 'Nicht geprüft',
  'exercise.allPassed': 'Alle Checks bestanden — Netzwerk fertig!',
  'exercise.runInfo': 'Der Prüflauf findet in einer separaten, deterministischen Simulation statt (fester Seed, 50 ms Zyklus) — die 3D-Ansicht bleibt unberührt.',

  // ── Hinweise (§10.2) ─────────────────────────────────────────────────────
  'hints.title': 'Hinweise',
  'hints.noNetwork': 'Wählen Sie im Tab „Aufgaben“ ein Netzwerk, um dessen Hinweise zu sehen.',
  'hints.forNetwork': 'Hinweise für {network}',
  'hints.level': 'Hinweis {level} von {total}',
  'hints.levelName.1': 'Konzept',
  'hints.levelName.2': 'Muster',
  'hints.levelName.3': 'Checkliste',
  'hints.show': 'Hinweis anzeigen',
  'hints.locked': 'Gesperrt',
  'hints.lockedInfo': 'Wird nach einem fehlgeschlagenen Prüflauf, 5 Minuten auf diesem Netzwerk oder „Ich komme nicht weiter“ freigeschaltet.',
  'hints.stuck': 'Ich komme nicht weiter — nächsten Hinweis freischalten',
  'hints.reference': 'Verweis: {label}',
  'hints.openExample': 'Passendes Beispiel öffnen',
  'hints.none': 'Für dieses Netzwerk sind keine Hinweise vorhanden.',

  // ── Beispielbibliothek (§10.3) ───────────────────────────────────────────
  'examples.title': 'Beispiele',
  'examples.unavailable': 'Beispielbibliothek nicht verfügbar: {reason}',
  'examples.source': 'Quelle: {source}',
  'examples.load': 'In den Editor einfügen',
  'examples.loadTitle': 'Editorinhalt durch dieses lauffähige Beispiel ersetzen',
  'examples.copy': 'Kopieren',
  'examples.copyTitle': 'Beispiel in die Zwischenablage kopieren',
  'examples.confirmReplace': 'Aktuellen Editorinhalt durch dieses Beispiel ersetzen? Das aktuelle Programm wird überschrieben (bleibt aber im Undo-Verlauf, Strg+Z).',

  // ── Szeneneditor (Betreiber-Werkzeug, DESIGN_SCENE_EDITOR.md — Aufruf mit ?editor=1) ──
  'editor3d.title': 'Szeneneditor',
  'editor3d.hint': 'Weiche in der 3D-Ansicht anklicken, um sie auszuwählen.',
  'editor3d.none': 'Keine Weiche ausgewählt.',
  'editor3d.source': 'Zuordnungsquelle: {source}',
  'editor3d.mapping': 'G → {g}, R → {r}',
  'editor3d.fixed': 'Diese Weiche hat keine Spulen (fest liegend) — nichts zu tauschen.',
  'editor3d.flip': 'G/R-Zuordnung tauschen',
  'editor3d.flipTitle': 'Tauscht, welchen Zweig die Spulen G und R stellen — nur im Entwurf',
  'editor3d.noFlips': 'Noch nichts getauscht.',
  'editor3d.flipped': 'Getauscht: {list}',
  'editor3d.downloadPlan': 'Gepatchte trackplan.json herunterladen',
  'editor3d.downloadPlanTitle': 'Vollständiger Ersatz für src/data/trackplan.json — zusammen mit der Erwartungs-Notiz prüfen und committen',
  'editor3d.downloadNote': 'Erwartungs-Notiz herunterladen',
  'editor3d.downloadNoteTitle': 'Welche gepinnten Orakel-Erwartungen jeder Tausch bewegen würde (Doppel-Änderungs-Disziplin)',
};
