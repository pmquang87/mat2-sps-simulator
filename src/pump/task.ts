/**
 * The pump experiment's task text — the teaching example of Anleitung IV.2.5.2
 * (reference/research/anleitung.md §5.1, Abbildung 4), summarized in German and translated into
 * English.
 *
 * This is STATIC content, not a graded exercise: the pump plant exists so every AWL
 * instruction of the manual can be tried against something visible, and the shell's
 * Exercises tab renders this document instead of the railway's exercise browser.
 *
 * The bodies are the same markdown-lite dialect the pedagogy content model parses
 * (paragraphs, `-` bullets, fenced blocks), so `ui/panels/contentView` renders them with no
 * special case. The `{ de, en }` shape is declared locally rather than imported: pump/
 * imports core/ only (§2), and it is structurally identical to pedagogy's `LocalizedText`.
 */

/** Structural twin of pedagogy's `LocalizedText` — see the module note. */
export interface PumpText { de: string; en: string; }

export interface PumpTaskSection {
  heading: PumpText;
  /** markdown-lite: paragraphs, `-` bullets, fenced code blocks. */
  body: PumpText;
}

export interface PumpTaskDoc {
  title: PumpText;
  intro: PumpText;
  sections: readonly PumpTaskSection[];
}

export const PUMP_TASK: PumpTaskDoc = {
  title: {
    de: 'Lehrbeispiel Pumpe (Anleitung IV.2.5.2)',
    en: 'Teaching example: pump (Anleitung IV.2.5.2)',
  },
  intro: {
    de: 'Eine Kreiselpumpe fördert Produkt aus dem Quelltank A in den Zieltank B. '
      + 'Auf diesem Beispiel führt die Anleitung den gesamten Anweisungsvorrat ein. '
      + 'Hier gibt es keine Bewertung: probieren Sie jede Anweisung an der laufenden Anlage aus.',
    en: 'A centrifugal pump moves product from source tank A into target tank B. The manual '
      + 'introduces its entire instruction set on this example. Nothing here is graded — try '
      + 'every instruction against the live plant.',
  },
  sections: [
    {
      heading: { de: 'Signalbelegung (Abbildung 4)', en: 'Signal map (Abbildung 4)' },
      body: {
        de: '- E 0.0 — S1, Start-Taster (Taster, nicht rastend)\n'
          + '- E 0.6 — S0, Stopp-Taster (Taster)\n'
          + '- E 0.1 — Leermeldung LLS Tank A (1 = Tank A leer)\n'
          + '- E 0.2 — Vollmeldung HLS Tank A (1 = Tank A voll)\n'
          + '- E 0.3 — Leermeldung LLS Tank B (1 = Tank B leer)\n'
          + '- E 0.4 — Vollmeldung HLS Tank B (1 = Tank B voll)\n'
          + '- E 0.5 — Trockenlaufschutz LS (meldet 1, wenn benetzt)\n'
          + '- A 0.1 — Pumpe\n'
          + '\n'
          + 'Leermeldungen sind 1, wenn der Tank leer ist; Vollmeldungen sind 1, wenn er voll ist.',
        en: '- E 0.0 — S1, start button (momentary)\n'
          + '- E 0.6 — S0, stop button (momentary)\n'
          + '- E 0.1 — low-level switch LLS tank A (1 = A empty)\n'
          + '- E 0.2 — high-level switch HLS tank A (1 = A full)\n'
          + '- E 0.3 — low-level switch LLS tank B (1 = B empty)\n'
          + '- E 0.4 — high-level switch HLS tank B (1 = B full)\n'
          + '- E 0.5 — dry-run guard LS (reports 1 while wetted)\n'
          + '- A 0.1 — pump\n'
          + '\n'
          + 'Empty signals are 1 while the tank is empty; full signals are 1 while it is full.',
      },
    },
    {
      heading: { de: 'Start- und Endbedingungen', en: 'Start and stop conditions' },
      body: {
        de: 'Startbedingungen: Tank A nicht leer UND Tank B leer UND Trockenlaufschutz '
          + 'benetzt UND S1 gedrückt.\n'
          + '\n'
          + 'Endbedingungen: Tank A leer ODER Tank B voll ODER S0 gedrückt.\n'
          + '\n'
          + 'Weil S1 ein Taster ist, muss Ihr Programm den Zustand selbst halten — mit S/R '
          + 'auf einem Merker oder mit einer Selbsthaltung über den Ausgang.\n'
          + '\n'
          + 'Startzustand der Anlage: Tank A 90 %, Tank B 0 %. Beide Tanks fassen gleich '
          + 'viel, also erreicht ein einfacher Leerpumpvorgang immer zuerst „Tank A leer“ — '
          + 'Tank B bleibt bei 90 % stehen und die Vollmeldung (98 %) kommt nicht. Sie '
          + 'kommt erst, wenn Sie während des Pumpens den Zulauf von Hand öffnen. So sehen '
          + 'Sie beide Endbedingungen getrennt statt gleichzeitig; die Anfangsfüllstände '
          + 'lassen sich im Reiter Anlagenparameter ändern.',
        en: 'Start: tank A not empty AND tank B empty AND the dry-run guard wetted AND S1 '
          + 'pressed.\n'
          + '\n'
          + 'Stop: tank A empty OR tank B full OR S0 pressed.\n'
          + '\n'
          + 'S1 is a momentary button, so your program has to hold the state itself — either '
          + 'with S/R on a flag or with a self-holding branch across the output.\n'
          + '\n'
          + 'The plant starts with tank A at 90 % and tank B empty. Both tanks hold the same '
          + 'amount, so a plain pump-down always ends on "tank A empty" — B stops at 90 % and '
          + 'the full signal (98 %) never comes. It comes only if you open the refill valve by '
          + 'hand while the pump runs. That way you see the two end conditions separately '
          + 'instead of at the same instant; the initial levels are editable in the Plant '
          + 'parameters tab.',
      },
    },
    {
      heading: { de: 'Zusätzliche Bedienelemente', en: 'Extra controls on the pedestal' },
      body: {
        de: 'Damit die Zeit-, Flanken- und Sprungbeispiele der Anleitung etwas Sichtbares '
          + 'schalten, trägt das Pult über die Abbildung hinaus:\n'
          + '\n'
          + '- E 0.7 — Kippschalter; die Flanken- und Sprungbeispiele der Anleitung fragen '
          + 'genau diesen Eingang ab\n'
          + '- E 1.0 bis E 1.4 und E 1.7 — weitere Kippschalter\n'
          + '- A 0.2 und A 0.3 — Meldeleuchten\n'
          + '\n'
          + 'Die beiden Handventile (Zulauf in A, Ablauf aus B) gehören der Anlage, nicht der '
          + 'SPS: mit ihnen erreichen Sie jede Sensorkombination von Hand.\n'
          + '\n'
          + 'Alle Bedienelemente gibt es zweimal: als anklickbares Modell in der 3D-Ansicht '
          + 'und als beschriftete Schaltfläche in der Bedienleiste (mit der Tastatur '
          + 'erreichbar). Beide schalten dieselbe Anlage.',
        en: 'So the manual’s timer, edge and jump examples switch something visible, the '
          + 'pedestal carries more than the figure shows:\n'
          + '\n'
          + '- E 0.7 — toggle switch; the manual’s edge and jump examples query exactly this '
          + 'input\n'
          + '- E 1.0 to E 1.4 and E 1.7 — further toggle switches\n'
          + '- A 0.2 and A 0.3 — indicator lamps\n'
          + '\n'
          + 'The two hand valves (refill into A, drain out of B) belong to the plant, not to '
          + 'the PLC: use them to reach any sensor combination by hand.\n'
          + '\n'
          + 'Every control exists twice: as a clickable model in the 3D view and as a labelled '
          + 'button in the control bar (reachable from the keyboard). Both drive the same '
          + 'plant.',
      },
    },
    {
      heading: { de: 'Trockenlaufschutz (E 0.5)', en: 'Dry-run guard (E 0.5)' },
      body: {
        de: 'Der Trockenlaufschutz meldet 1, solange die Pumpe benetzt ist, und 0, wenn sie '
          + 'trocken läuft. Trocken heißt: die Pumpe läuft UND Tank A ist leer — und das '
          + 'ununterbrochen für die eingestellte Trockenlaufverzögerung (Standard 2 s).\n'
          + '\n'
          + 'Wichtig für Ihr Programm: die Meldung geht sofort wieder auf 1, sobald die Pumpe '
          + 'ausgeschaltet ist (oder wieder Produkt in Tank A steht). Der Schutz ist ein '
          + 'Sensor, kein Abschalter — die Anlage stoppt die Pumpe nicht von sich aus. Wer '
          + 'die Pumpe nur über E 0.5 abschaltet, ohne den Zustand zu speichern, sieht sie '
          + 'deshalb im nächsten Zyklus wieder anlaufen: mit ausgeschalteter Pumpe ist der '
          + 'Schutz ja wieder benetzt.',
        en: 'The dry-run guard reports 1 while the pump is wetted and 0 while it runs dry. '
          + 'Dry means: the pump is running AND tank A is empty — continuously, for the '
          + 'configured dry-run delay (2 s by default).\n'
          + '\n'
          + 'What matters for your program: the signal goes back to 1 the moment the pump is '
          + 'switched off (or product is back in tank A). The guard is a SENSOR, not a '
          + 'cut-out — the plant never stops the pump by itself. So a program that switches '
          + 'the pump off from E 0.5 alone, without latching the state, sees it start again '
          + 'on the next scan: with the pump off, the guard reads wetted again.',
      },
    },
    {
      heading: { de: 'Erster Ansatz (Anleitung IV.2.5.3)', en: 'First step (Anleitung IV.2.5.3)' },
      body: {
        de: 'Der Einstieg der Anleitung — Merker setzen und rücksetzen, Pumpe zuweisen:\n'
          + '\n'
          + '```awl\n'
          + 'U    E    0.0   // Wenn S1 (E 0.0) betätigt wird\n'
          + 'S    M    0.0   // setze Merkerbit für Schalter\n'
          + '\n'
          + 'U    E    0.6   // Wenn S0 (E 0.6) betätigt wird\n'
          + 'R    M    0.0   // Rücksetze Merkerbit für Schalter\n'
          + '\n'
          + 'U    M    0.0   // Wenn Merkerbit M 0.0 anliegt\n'
          + '=    A    0.1   // schalte Pumpe (A 0.1) ein, sonst aus\n'
          + '```\n'
          + '\n'
          + 'Erweitern Sie ihn Schritt für Schritt um Trockenlaufschutz, Leer- und '
          + 'Vollmeldungen — die Beispielbibliothek enthält jede Stufe.',
        en: 'The manual’s starting point — set and reset a flag, then assign the pump:\n'
          + '\n'
          + '```awl\n'
          + 'U    E    0.0   // when S1 (E 0.0) is pressed\n'
          + 'S    M    0.0   // set the flag bit for the switch\n'
          + '\n'
          + 'U    E    0.6   // when S0 (E 0.6) is pressed\n'
          + 'R    M    0.0   // reset the flag bit\n'
          + '\n'
          + 'U    M    0.0   // while flag M 0.0 is set\n'
          + '=    A    0.1   // switch the pump (A 0.1) on, otherwise off\n'
          + '```\n'
          + '\n'
          + 'Extend it step by step with the dry-run guard and the level signals — the '
          + 'examples library carries every stage.',
      },
    },
  ],
};
