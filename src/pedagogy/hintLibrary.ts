/**
 * Bilingual hint content for the 22 networks of Gruppe A and Gruppe B (11 + 11).
 *
 * Authoring rules — ARCHITECTURE.md §5.5 (HintSpec), §7.3 (content rules), §10.2:
 *  - level 1 = concept pointer + citation into the Anleitung / Hinweise;
 *  - level 2 = a GENERIC, runnable pattern with strictly neutral operands
 *    (`E 0.x`, `A 0.x`, `M 10.x`–`M 20.x`, `T 1x`, `Z 1`) plus a guiding question;
 *  - level 3 = checklist of pitfalls for this network type.
 *  - NEVER a task operand, never a complete task solution. No plant or system symbol names
 *    (switch/reed symbols, traction-stage symbols, system flag bytes) appear anywhere in
 *    this file — `tests/pedagogy/hints.test.ts` enforces that with the §7.3 pattern list,
 *    run in the STRICT mode (no task-text exemptions) over this library.
 *
 * Authoring source: the Anleitung theory chapters (IV.2.5–IV.2.8, V.1, V.3) and the
 * published Aufgabenstellung texts — never a solution.
 */
import type { HintSpec, LocalizedText } from './types';

type AnleitungRef = NonNullable<HintSpec['anleitungRef']>;

function lt(de: string, en: string): LocalizedText {
  return { de, en };
}

interface HintInit {
  level: 1 | 2 | 3;
  title: LocalizedText;
  body: LocalizedText;
  ref?: AnleitungRef;
  exampleId?: string;
}

function hint(init: HintInit): HintSpec {
  const spec: HintSpec = { level: init.level, title: init.title, body: init.body };
  if (init.ref !== undefined) spec.anleitungRef = init.ref;
  if (init.exampleId !== undefined) spec.exampleId = init.exampleId;
  return spec;
}

// ───────────────────────────── citations into the German manual ────────────────────────────

const REF_CYCLE: AnleitungRef = {
  section: 'IV.1.2',
  label: lt('Anleitung IV.1.2 (zyklische Arbeitsweise)', 'Manual IV.1.2 (cyclic operation)'),
};
const REF_SR: AnleitungRef = {
  section: 'IV.2.5.3',
  label: lt(
    'Anleitung IV.2.5.3 (Abfrage, Speicherfunktion S/R)',
    'Manual IV.2.5.3 (query, memory function S/R)',
  ),
};
const REF_UN: AnleitungRef = {
  section: 'IV.2.5.5',
  label: lt('Anleitung IV.2.5.5 (UN)', 'Manual IV.2.5.5 (negated query, UN)'),
};
const REF_SV: AnleitungRef = {
  section: 'IV.2.6.2',
  label: lt('Anleitung IV.2.6.2 (verlängerter Impuls, SV)', 'Manual IV.2.6.2 (extended pulse, SV)'),
};
const REF_SE: AnleitungRef = {
  section: 'IV.2.6.3',
  label: lt(
    'Anleitung IV.2.6.3 (Einschaltverzögerung, SE)',
    'Manual IV.2.6.3 (on-delay, SE)',
  ),
};
const REF_SS: AnleitungRef = {
  section: 'IV.2.6.4',
  label: lt(
    'Anleitung IV.2.6.4 (speichernde Einschaltverzögerung, SS)',
    'Manual IV.2.6.4 (retentive on-delay, SS)',
  ),
};
const REF_EDGE: AnleitungRef = {
  section: 'IV.2.7',
  label: lt('Anleitung IV.2.7 (Flankenauswertung FP/FN)', 'Manual IV.2.7 (edge evaluation FP/FN)'),
};
const REF_SETUP: AnleitungRef = {
  section: 'V.1',
  label: lt(
    'Anleitung V.1 (Versuchsaufbau: 300 ms Stellzeit, Fahrstufen)',
    'Manual V.1 (test rig: 300 ms actuation time, traction stages)',
  ),
};
const REF_TIPS: AnleitungRef = {
  section: 'V.3',
  label: lt(
    'Anleitung V.3 (Hinweise: Runden, Mehrfachüberfahren, Ressourcen)',
    'Manual V.3 (notes: laps, repeated crossings, resources)',
  ),
};
const REF_COUNTER: AnleitungRef = {
  section: 'V.3',
  label: lt(
    'Hinweise/Anleitung V.3 (Zähl- und Vergleichsfunktionen)',
    'Notes / manual V.3 (counter and comparison functions)',
  ),
};

// ──────────────────────────────── reusable neutral patterns ───────────────────────────────

const CHECKLIST = lt('Checkliste', 'Checklist');

/** Route pulse: one trigger, one timer, several coils. Neutral operands throughout. */
const PULSE_BLOCK_DE = [
  '```awl',
  'U    E    0.0    // Positionsgeber (Reedkontakt)',
  'FP   M    10.0   // Flanke: eine Auswertung pro Vorbeifahrt',
  'L    S5T#300MS   // Stellzeit laden (L ist VKE-neutral)',
  'SV   T    10     // verlängerter Impuls startet',
  '',
  'U    T    10',
  '=    A    0.0    // Spule der ersten Weiche',
  'U    T    10',
  '=    A    0.1    // Spule der zweiten Weiche',
  '```',
].join('\n');

const PULSE_BLOCK_EN = [
  '```awl',
  'U    E    0.0    // position sensor (reed contact)',
  'FP   M    10.0   // edge: one evaluation per pass',
  'L    S5T#300MS   // load the actuation time (L is VKE-neutral)',
  'SV   T    10     // start the extended pulse',
  '',
  'U    T    10',
  '=    A    0.0    // coil of the first point',
  'U    T    10',
  '=    A    0.1    // coil of the second point',
  '```',
].join('\n');

const SINGLE_PULSE_BLOCK_DE = [
  '```awl',
  'U    E    0.0    // Positionsgeber',
  'FP   M    10.0   // Flanke',
  'L    S5T#300MS',
  'SV   T    10',
  '',
  'U    T    10',
  '=    A    0.0    // eine einzige Spule',
  '```',
].join('\n');

const SINGLE_PULSE_BLOCK_EN = [
  '```awl',
  'U    E    0.0    // position sensor',
  'FP   M    10.0   // edge',
  'L    S5T#300MS',
  'SV   T    10',
  '',
  'U    T    10',
  '=    A    0.0    // one single coil',
  '```',
].join('\n');

/** State change with mutual exclusion — the shape every traction-stage change needs. */
const STAGE_BLOCK_DE = [
  '```awl',
  'U    E    0.0    // Positionsgeber',
  'FP   M    10.0   // Flanke',
  'S    M    10.2   // neuen Zustand statisch setzen',
  'R    M    10.1   // vorherigen Zustand löschen',
  '```',
].join('\n');

const STAGE_BLOCK_EN = [
  '```awl',
  'U    E    0.0    // position sensor',
  'FP   M    10.0   // edge',
  'S    M    10.2   // set the new state statically',
  'R    M    10.1   // clear the previous state',
  '```',
].join('\n');

/** Wait time that survives the trigger dropping away. */
const WAIT_BLOCK_DE = [
  '```awl',
  'U    M    10.1   // Anforderung steht (gespeichert)',
  'L    S5T#5S      // Wartezeit',
  'SS   T    11     // läuft weiter, auch wenn das VKE abfällt',
  '',
  'U    T    11',
  'S    M    10.2   // Freigabe für den nächsten Schritt',
  'R    M    10.1   // Anforderung abmelden',
  '',
  'U    M    10.2',
  'R    T    11     // Zeit ausdrücklich zurücksetzen',
  '```',
].join('\n');

const WAIT_BLOCK_EN = [
  '```awl',
  'U    M    10.1   // request is latched',
  'L    S5T#5S      // waiting time',
  'SS   T    11     // keeps running even when the VKE drops',
  '',
  'U    T    11',
  'S    M    10.2   // release for the next step',
  'R    M    10.1   // clear the request',
  '',
  'U    M    10.2',
  'R    T    11     // reset the timer explicitly',
  '```',
].join('\n');

/** Edge plus lockout window — the generic debounce / multiple-crossing filter. */
const LOCKOUT_BLOCK_DE = [
  '```awl',
  'U    E    0.0    // Positionsgeber',
  'FP   M    10.0   // Flanke',
  'UN   T    15     // nur wenn die Sperrzeit NICHT läuft',
  'S    M    10.1   // Anforderung übernehmen',
  '',
  'U    M    10.1',
  'L    S5T#1S      // Sperrfenster',
  'SV   T    15     // weitere Flanken werden ignoriert',
  '```',
].join('\n');

const LOCKOUT_BLOCK_EN = [
  '```awl',
  'U    E    0.0    // position sensor',
  'FP   M    10.0   // edge',
  'UN   T    15     // only while the lockout timer is NOT running',
  'S    M    10.1   // accept the request',
  '',
  'U    M    10.1',
  'L    S5T#1S      // lockout window',
  'SV   T    15     // further edges are ignored',
  '```',
].join('\n');

/** Counting passes and acting on a specific one. */
const COUNT_BLOCK_DE = [
  '```awl',
  'U    E    0.0    // Positionsgeber',
  'FP   M    10.0   // Flanke — sonst zählt jeder Zyklus mit',
  'ZV   Z    1      // Vorbeifahrt zählen',
  '',
  'L    Z    1',
  'L    2',
  '==I              // Vergleich bildet das neue VKE',
  'S    M    10.4   // Aktion nur bei dieser Vorbeifahrt',
  '```',
].join('\n');

const COUNT_BLOCK_EN = [
  '```awl',
  'U    E    0.0    // position sensor',
  'FP   M    10.0   // edge — otherwise every scan counts',
  'ZV   Z    1      // count the pass',
  '',
  'L    Z    1',
  'L    2',
  '==I              // the comparison forms the new VKE',
  'S    M    10.4   // act only on this pass',
  '```',
].join('\n');

/** Step chain: step n+1 may only start once step n has reported completion. */
const STEP_BLOCK_DE = [
  '```awl',
  'U    M    10.2   // vorheriger Schritt ist abgeschlossen',
  'U    E    0.1    // Positionsgeber dieses Schritts',
  'FP   M    10.6   // eigener Flankenoperand',
  'S    M    10.7   // diesen Schritt anfordern',
  'R    M    10.2   // vorherigen Schritt abmelden',
  '```',
].join('\n');

const STEP_BLOCK_EN = [
  '```awl',
  'U    M    10.2   // previous step has completed',
  'U    E    0.1    // position sensor of this step',
  'FP   M    10.6   // its own edge operand',
  'S    M    10.7   // request this step',
  'R    M    10.2   // clear the previous step',
  '```',
].join('\n');

const FINAL_BLOCK_DE = [
  '```awl',
  'U    E    0.0    // Positionsgeber',
  'FP   M    10.0',
  'U    M    10.5   // Zustand: letzter Abschnitt ist erreicht',
  'S    M    10.1   // Endhalt speichern',
  'R    M    10.2   // alle Fahrzustände löschen',
  'R    M    10.3',
  '```',
].join('\n');

const FINAL_BLOCK_EN = [
  '```awl',
  'U    E    0.0    // position sensor',
  'FP   M    10.0',
  'U    M    10.5   // state: the final section has been reached',
  'S    M    10.1   // latch the final halt',
  'R    M    10.2   // clear every motion state',
  'R    M    10.3',
  '```',
].join('\n');

function checklist(itemsDe: readonly string[], itemsEn: readonly string[]): LocalizedText {
  return lt(
    itemsDe.map((item) => `– ${item}`).join('\n'),
    itemsEn.map((item) => `– ${item}`).join('\n'),
  );
}

// ─────────────────────────────── network 1: fail-safe halt ────────────────────────────────

const FAILSAFE_HALT_HINTS: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: drahtbruchsichere (0-aktive) Signale',
      'Concept: fail-safe (active-low) signals',
    ),
    body: lt(
      'Ein drahtbruchsicher verdrahtetes Signal führt im ungestörten Betrieb logisch 1 — der ' +
        'Störfall ist die 0. Ein Drahtbruch wirkt damit genauso wie ein ausgelöster ' +
        'Notausschalter, und genau das ist gewollt.\n\n' +
        'Zwei Fragen sind zu klären: Wie fragt man einen Zustand ab, der bei 0 wahr ist? Und ' +
        'welche Art der Zuweisung hält den Halt fest, statt ihn im nächsten Zyklus wieder zu ' +
        'überschreiben? Den entscheidenden Unterschied nennt die Aufgabenstellung selbst.',
      'A fail-safe wired signal carries logic 1 during undisturbed operation — the fault case ' +
        'is the 0. A broken wire therefore acts exactly like a pressed emergency-stop button, ' +
        'which is precisely the intent.\n\n' +
        'Two questions to settle: how do you query a condition that is true at 0? And which ' +
        'kind of assignment holds the halt instead of overwriting it in the next scan? The task ' +
        'text names the decisive difference itself.',
    ),
    ref: REF_UN,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: speicherndes Setzen bei 0-aktivem Eingang',
      'Pattern: latching set from an active-low input',
    ),
    body: lt(
      'Generisches Muster mit neutralen Operanden:\n\n' +
        '```awl\n' +
        'UN   E    0.0    // Störsignal, 0-aktiv abgefragt\n' +
        'S    M    10.0   // Zustand speichernd setzen\n' +
        '```\n\n' +
        'Eine dynamische Zuweisung (`=`) schreibt das VKE in jedem Zyklus auf den Operanden — ' +
        'auch die 0. Eine Speicherfunktion (`S`, `R`) wirkt nur, wenn das VKE 1 ist.\n\n' +
        'Frage: Welche der beiden Varianten hält den Halt noch, nachdem das Signal ' +
        'zurückgekehrt ist — und in welchem Netzwerk wird dieser gespeicherte Zustand später ' +
        'wieder gelöst?',
      'Generic pattern with neutral operands:\n\n' +
        '```awl\n' +
        'UN   E    0.0    // fault signal, queried active-low\n' +
        'S    M    10.0   // latch the state\n' +
        '```\n\n' +
        'A dynamic assignment (`=`) writes the VKE onto the operand in every scan — including ' +
        'the 0. A memory function (`S`, `R`) only acts while the VKE is 1.\n\n' +
        'Question: which of the two still holds the halt after the signal has returned — and in ' +
        'which network is that latched state released again later?',
    ),
    ref: REF_SR,
    exampleId: 'pump-selfhold',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Wirkt der Halt ohne Flanke, also solange die Störung überhaupt anliegt?',
        'Bleibt der Halt nach Rückkehr des Signals erhalten — und ist klar, wo er gelöst wird?',
        'Werden alle Fahrzustände zurückgesetzt und nicht nur der Stillstandsmerker gesetzt?',
        'Läuft das Netzwerk in jedem Zyklus durch (kein Sprung, der es überspringt)?',
        'Startet die Anlage nach Spannungswiederkehr aus dem sicheren Zustand, nicht sofort in Fahrt?',
      ],
      [
        'Does the halt act without an edge, i.e. for as long as the fault is present at all?',
        'Does the halt survive the signal returning — and is it clear where it gets released?',
        'Are all motion states reset, not just the standstill flag set?',
        'Does the network run in every scan (no jump skipping over it)?',
        'After power returns, does the plant start from the safe state rather than moving at once?',
      ],
    ),
    ref: REF_CYCLE,
  }),
];

// ──────────────────────────── network 2: restart after the halt ───────────────────────────

const RESTART_HINTS: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Wiederanlauf aus dem sicheren Zustand',
      'Concept: restart from the safe state',
    ),
    body: lt(
      'Der Wiederanlauf hängt am Wechsel des Signals von 0 auf 1 — nicht am Dauerzustand 1. ' +
        'Genau dafür gibt es die Flankenauswertung: sie liefert für einen einzigen Zyklus ein ' +
        'VKE 1 und macht aus einem Zustand ein Ereignis.\n\n' +
        'Der zweite Teil ist Zustandspflege: der gespeicherte Halt muss gelöst und genau ein ' +
        'Fahrzustand gesetzt werden. Für Fahrstufen empfiehlt die Anleitung ausdrücklich das ' +
        'statische Setzen — überlegen Sie, warum eine dynamische Zuweisung hier stört.',
      'The restart hangs on the signal changing from 0 to 1 — not on the steady state 1. That ' +
        'is exactly what edge evaluation is for: it yields a VKE of 1 for a single scan and ' +
        'turns a state into an event.\n\n' +
        'The second part is state hygiene: the latched halt must be released and exactly one ' +
        'motion state set. For traction stages the manual explicitly recommends the static set — ' +
        'consider why a dynamic assignment gets in the way here.',
    ),
    ref: REF_EDGE,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Flanke löst den Halt und setzt einen Zustand',
      'Pattern: an edge releases the halt and sets one state',
    ),
    body: lt(
      '```awl\n' +
        'U    E    0.0    // Signal ist wieder vorhanden\n' +
        'FP   M    10.1   // Flankenoperand — nur EINEN Zyklus lang wahr\n' +
        'R    M    10.0   // gespeicherten Halt lösen\n' +
        'S    M    10.2   // gewünschten Zustand statisch setzen\n' +
        'R    M    10.3   // konkurrierende Zustände löschen\n' +
        '```\n\n' +
        'Der Flankenoperand ist ein eigener Merker und darf im ganzen Programm nur an dieser ' +
        'einen Stelle vorkommen — sonst vergleichen zwei verschiedene Signale ihr VKE mit ' +
        'demselben Gedächtnis.\n\n' +
        'Frage: Was passiert bei `=` statt `S`, wenn das Signal dauerhaft anliegt? Und was ' +
        'passiert, wenn zwei Fahrzustände gleichzeitig gesetzt sind?',
      '```awl\n' +
        'U    E    0.0    // the signal is present again\n' +
        'FP   M    10.1   // edge operand — true for exactly ONE scan\n' +
        'R    M    10.0   // release the latched halt\n' +
        'S    M    10.2   // set the wanted state statically\n' +
        'R    M    10.3   // clear competing states\n' +
        '```\n\n' +
        'The edge operand is a flag of its own and must appear at this single place in the whole ' +
        'program — otherwise two different signals compare their VKE against the same memory.\n\n' +
        'Question: what happens with `=` instead of `S` while the signal stays present? And what ' +
        'happens if two motion states are set at the same time?',
    ),
    ref: REF_SR,
    exampleId: 'fp-pulse',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Wird der Wiederanlauf über die Flanke ausgelöst und nicht über den Dauerzustand?',
        'Ist der Flankenoperand ein eigener Merker, der nirgends sonst verwendet wird?',
        'Ist danach genau eine Fahrstufe gesetzt und sind alle anderen zurückgesetzt?',
        'Wird der gespeicherte Halt gelöst, bevor die Fahrstufe wirken soll (Reihenfolge im Zyklus)?',
        'Bleibt die Anlage stehen, solange der Störfall anliegt — auch bei mehrfachem Aus und Ein?',
      ],
      [
        'Is the restart triggered by the edge rather than by the steady state?',
        'Is the edge operand a dedicated flag that is used nowhere else?',
        'Is exactly one traction stage set afterwards, with all others reset?',
        'Is the latched halt released before the stage is meant to act (order within the scan)?',
        'Does the plant stay put while the fault is present — even across repeated off/on cycles?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

// ───────────────────────────────── per-network hint content ───────────────────────────────

const A_NW3: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Stellimpuls und Fahrstufe aus einem Auslöser',
      'Concept: actuation pulse and traction stage from one trigger',
    ),
    body: lt(
      'Ein Positionsgeber löst hier zwei verschiedene Dinge aus: die Weichen der Ausfahrt ' +
        'brauchen einen kurzen Stellimpuls, die Geschwindigkeit braucht einen gespeicherten ' +
        'Zustand. Gleicher Auslöser — aber nicht dieselbe Art der Zuweisung.\n\n' +
        'Die Relaislogik unter der Platte arbeitet träge: pro Weichenstellung sind 300 ms ' +
        'einzuplanen. Eine Spule dauerhaft zu bestromen ist deshalb kein „sicherer“ Weg, ' +
        'sondern ein Fehler — der Impuls muss von selbst enden.',
      'One position sensor triggers two different things here: the points of the exit route need ' +
        'a short actuation pulse, the speed needs a latched state. Same trigger — but not the ' +
        'same kind of assignment.\n\n' +
        'The relay logic under the layout is slow: 300 ms must be allowed per point movement. ' +
        'Energising a coil permanently is therefore not the "safe" option but a fault — the ' +
        'pulse has to end on its own.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt('Muster: Weichenstraße mit 300-ms-Impuls', 'Pattern: point route with a 300 ms pulse'),
    body: lt(
      `${PULSE_BLOCK_DE}\n\nDie Fahrstufe kommt in diesem Netzwerk zusätzlich dazu.\n\n` +
        'Frage: Welche Zuweisungsart nehmen Sie für die Geschwindigkeit, damit sie nach Ablauf ' +
        'des Impulses erhalten bleibt? Und was macht Ihr Netzwerk, wenn der Kontakt beim ' +
        'Vorbeifahren zweimal schließt?',
      `${PULSE_BLOCK_EN}\n\nIn this network the traction stage comes on top of that.\n\n` +
        'Question: which kind of assignment do you use for the speed so that it survives the end ' +
        'of the pulse? And what does your network do if the contact closes twice during one pass?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Endet der Stellimpuls von selbst, oder bleibt die Spule bestromt?',
        'Hängen alle Weichen dieser Fahrstraße am selben Impuls (sie werden gleichzeitig gestellt)?',
        'Ist der verwendete Timer nicht gleichzeitig für eine andere laufende Operation belegt?',
        'Ist die Fahrstufe statisch gesetzt und die vorherige Stufe zurückgesetzt?',
        'Verträgt das Netzwerk ein zweites Schließen des Kontakts, ohne die Straße neu zu stellen?',
      ],
      [
        'Does the actuation pulse end by itself, or does the coil stay energised?',
        'Do all points of this route hang on the same pulse (they are thrown simultaneously)?',
        'Is the timer you use not occupied by another operation running at the same time?',
        'Is the traction stage set statically and the previous stage reset?',
        'Does the network tolerate a second closure of the contact without re-throwing the route?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW4: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Fahrstufenwechsel ist ein Zustandswechsel',
      'Concept: a stage change is a state change',
    ),
    body: lt(
      'Die Fahrstufen sind einzelne Merkerbits, aber sie beschreiben EINEN Zustand: es darf ' +
        'immer nur eines davon gesetzt sein. Ein Fahrstufenwechsel besteht deshalb aus zwei ' +
        'Aktionen — neue Stufe setzen, alte Stufe löschen.\n\n' +
        'Die Anleitung empfiehlt für Geschwindigkeiten das statische Setzen; damit bleibt die ' +
        'Stufe nach der kurzen Vorbeifahrt am Positionsgeber erhalten.',
      'The traction stages are individual flag bits, yet they describe ONE state: only a single ' +
        'one may ever be set. A stage change therefore consists of two actions — set the new ' +
        'stage, clear the old one.\n\n' +
        'The manual recommends the static set for speeds; that way the stage survives the brief ' +
        'pass over the position sensor.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt('Muster: Zustandswechsel mit S und R', 'Pattern: state change with S and R'),
    body: lt(
      `${STAGE_BLOCK_DE}\n\n` +
        'Frage: Was passiert an der Anlage, wenn Sie das Löschen der alten Stufe vergessen und ' +
        'zwei Stufen gleichzeitig gesetzt sind? Und brauchen Sie hier überhaupt eine Flanke, ' +
        'wenn ohnehin nur gesetzt und gelöscht wird?',
      `${STAGE_BLOCK_EN}\n\n` +
        'Question: what happens on the plant if you forget to clear the old stage and two stages ' +
        'are set at once? And do you even need an edge here, given that you only set and clear?',
    ),
    ref: REF_SR,
    exampleId: 'pump-sr',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Ist nach diesem Netzwerk genau eine Fahrstufe gesetzt?',
        'Wird die vorherige Stufe wirklich gelöscht, nicht nur die neue gesetzt?',
        'Wirkt der Wechsel am richtigen Positionsgeber (Fahrtrichtung mitdenken)?',
        'Bleibt der Zustand erhalten, wenn der Kontakt wieder öffnet?',
        'Kollidiert dieses Netzwerk mit einem späteren, das dieselben Zustandsbits schreibt?',
      ],
      [
        'Is exactly one traction stage set after this network?',
        'Is the previous stage actually cleared, not just the new one set?',
        'Does the change act on the right position sensor (mind the direction of travel)?',
        'Does the state survive the contact opening again?',
        'Does this network collide with a later one writing the same state bits?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW5: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Weichenstraße als Einheit, Geschwindigkeit als Zustand',
      'Concept: the route as one unit, the speed as a state',
    ),
    body: lt(
      'Mehrere Weichen, die für dieselbe Durchfahrt gleichzeitig umlaufen sollen, sind EINE ' +
        'Fahrstraße: ein Auslöser, ein Zeitglied, mehrere Zuweisungen. Der Aufgabentext sagt ' +
        'dazu ausdrücklich, dass derselbe Timer nur für zeitgleich ablaufende Operationen ' +
        'verwendet werden darf.\n\n' +
        'Parallel dazu ist die Geschwindigkeit zu drosseln — das ist wieder ein Zustandswechsel, ' +
        'kein Impuls.',
      'Several points that must move simultaneously for the same passage form ONE route: one ' +
        'trigger, one timer, several assignments. The task text states explicitly that the same ' +
        'timer may only be used for operations that run at the same time.\n\n' +
        'In parallel the speed has to be reduced — that is a state change again, not a pulse.',
    ),
    ref: REF_SV,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: mehrere Spulen an einem Impuls',
      'Pattern: several coils on one pulse',
    ),
    body: lt(
      `${PULSE_BLOCK_DE}\n\nWeitere Spulen hängen nach demselben Muster am selben Impuls.\n\n` +
        'Frage: Warum genügt hier EIN Zeitglied für alle Weichen der Straße — und wann bräuchten ' +
        'Sie ein zweites?',
      `${PULSE_BLOCK_EN}\n\nFurther coils hang on the same pulse following the same shape.\n\n` +
        'Question: why is ONE timer enough for all points of this route — and when would you need ' +
        'a second one?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Sind wirklich alle in der Aufgabe genannten Weichen im Impuls enthalten?',
        'Prüfen Sie die Schreibweise der Symbolnamen gegen die Variablenliste — der Aufgabentext ' +
          'enthält vereinzelt Tippfehler; maßgeblich ist die Variablenliste.',
        'Ist die Geschwindigkeit gedrosselt, bevor die Lok den Bahnhofsbereich erreicht?',
        'Endet der Stellimpuls nach der Stellzeit von selbst?',
        'Ist der Timer frei, also nicht gleichzeitig von einem anderen Netzwerk benutzt?',
      ],
      [
        'Are really all points named in the task included in the pulse?',
        'Check the spelling of the symbol names against the Variablenliste — the task text ' +
          'contains occasional typos; the Variablenliste is authoritative.',
        'Is the speed reduced before the loco reaches the station area?',
        'Does the actuation pulse end by itself after the actuation time?',
        'Is the timer free, i.e. not used by another network at the same time?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW6: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Zustand halten heißt, ihn nicht anzufassen',
      'Concept: holding a state means not touching it',
    ),
    body: lt(
      'Hier ändert sich die Geschwindigkeit nicht. Das ist kein „nichts tun“, sondern eine ' +
        'Bedingung an alle anderen Netzwerke: keines darf den gehaltenen Zustand versehentlich ' +
        'überschreiben oder löschen. Die SPS arbeitet zyklisch — das letzte schreibende ' +
        'Netzwerk im Zyklus gewinnt.\n\n' +
        'Die Aufgabe des Netzwerks ist die Ausfahrt-Fahrstraße: sie muss stehen, bevor die Lok ' +
        'den Weichenbereich erreicht.',
      'The speed does not change here. That is not "doing nothing" but a condition on every ' +
        'other network: none may accidentally overwrite or clear the held state. The PLC works ' +
        'cyclically — the last network writing in the scan wins.\n\n' +
        'The job of this network is the exit route: it must be set before the loco reaches the ' +
        'point area.',
    ),
    ref: REF_CYCLE,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Fahrstraße stellen, Zustand unangetastet lassen',
      'Pattern: throw the route, leave the state untouched',
    ),
    body: lt(
      `${PULSE_BLOCK_DE}\n\n` +
        'Frage: Welche Zeile in Ihrem Programm könnte die gehaltene Geschwindigkeit ungewollt ' +
        'löschen? Suchen Sie alle Netzwerke, die auf dieselben Zustandsmerker schreiben, und ' +
        'prüfen Sie deren Bedingungen.',
      `${PULSE_BLOCK_EN}\n\n` +
        'Question: which line in your program could clear the held speed unintentionally? Find ' +
        'every network writing the same state flags and check their conditions.',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Bleibt die Geschwindigkeit unverändert — schreibt kein anderes Netzwerk dazwischen?',
        'Steht die Fahrstraße, bevor die Lok die erste Weiche erreicht?',
        'Hängt jede genannte Spule am Stellimpuls?',
        'Prüfen Sie die Schreibweise der Kontakt- und Weichennamen gegen die Variablenliste.',
        'Wird derselbe Timer nicht parallel für eine andere, zeitlich versetzte Aktion benutzt?',
      ],
      [
        'Does the speed stay unchanged — is no other network writing in between?',
        'Is the route set before the loco reaches the first point?',
        'Does every coil named hang on the actuation pulse?',
        'Check the spelling of contact and point names against the Variablenliste.',
        'Is the same timer not used in parallel for another, time-shifted action?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW7: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Fahrweg vorbereiten, bevor die Lok da ist',
      'Concept: prepare the path before the loco arrives',
    ),
    body: lt(
      'Eine Fahrstraße muss fertig gestellt sein, bevor das erste Rad im Weichenbereich ist. ' +
        'Rechnen Sie mit den 300 ms Stellzeit pro Weiche und mit dem Weg, den die Lok in dieser ' +
        'Zeit zurücklegt — bei hoher Fahrstufe ist das nicht wenig.\n\n' +
        'Denken Sie außerdem daran, dass die späteren Netzwerke Weichen erneut ansteuern: ' +
        'derselbe Antrieb kann in verschiedenen Netzwerken unterschiedlich gestellt werden.',
      'A route must be complete before the first wheel enters the point area. Reckon with the ' +
        '300 ms actuation time per point and with the distance the loco covers in that time — at ' +
        'a high traction stage that is not little.\n\n' +
        'Also remember that later networks command points again: the same drive can be thrown ' +
        'differently in different networks.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt('Muster: Fahrstraße aus einem Impuls', 'Pattern: one pulse for the whole route'),
    body: lt(
      `${PULSE_BLOCK_DE}\n\n` +
        'Frage: Wie lange nach dem Auslösen ist eine Weiche wirklich umgelaufen — und wie ' +
        'stellen Sie sicher, dass die Lok den Weichenbereich erst danach erreicht?',
      `${PULSE_BLOCK_EN}\n\n` +
        'Question: how long after the trigger has a point really finished moving — and how do ' +
        'you make sure the loco only reaches the point area after that?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Sind alle genannten Weichen in der Straße enthalten, keine vergessen?',
        'Dauert der Impuls die Stellzeit und nicht länger?',
        'Steuert kein anderes Netzwerk dieselbe Weiche gleichzeitig gegensinnig an?',
        'Ist der Auslöser weit genug vor dem Weichenbereich, damit die Stellzeit reicht?',
        'Wird der Auslöser mit Flanke ausgewertet, sodass ein zweites Schließen nichts kaputt macht?',
      ],
      [
        'Are all named points included in the route, none forgotten?',
        'Does the pulse last the actuation time and no longer?',
        'Is no other network commanding the same point in the opposite sense at the same time?',
        'Is the trigger far enough ahead of the point area for the actuation time to fit?',
        'Is the trigger edge-evaluated so that a second closure breaks nothing?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW8: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Halt, Wartezeit, Richtungswechsel — und ein prellender Kontakt',
      'Concept: halt, waiting time, reversal — and a bouncing contact',
    ),
    body: lt(
      'Dieses Netzwerk verlangt vier Dinge zusammen: anhalten, eine Wartezeit ablaufen lassen, ' +
        'Weichen stellen und rückwärts anfahren. Die Wartezeit beginnt, wenn der Zug den Geber ' +
        'überfährt — sie muss aber weiterlaufen, obwohl der Kontakt sofort wieder öffnet. Genau ' +
        'das leistet die speichernde Einschaltverzögerung (Anleitung IV.2.6.4); sie muss ' +
        'ausdrücklich zurückgesetzt werden.\n\n' +
        'Zwei weitere Effekte kommen aus der Wirklichkeit: ein mechanischer Kontakt prellt, und ' +
        'im Modellmaßstab ist kein zielgenaues Bremsen möglich — derselbe Geber kann beim ' +
        'Ausrollen mehrmals geschlossen werden (Anleitung V.3). Beides muss die Software ' +
        'abfangen, und das Rangieren darf nur in der ersten Runde passieren.',
      'This network asks for four things at once: stop, let a waiting time elapse, throw points ' +
        'and start again in reverse. The waiting time begins when the train passes the sensor — ' +
        'yet it has to keep running although the contact opens again immediately. That is exactly ' +
        'what the retentive on-delay does (manual IV.2.6.4); it must be reset explicitly.\n\n' +
        'Two more effects come from reality: a mechanical contact bounces, and at model scale ' +
        'there is no precise braking — the same sensor can close several times while rolling out ' +
        '(manual V.3). The software has to absorb both, and the shunting move may only happen in ' +
        'the first lap.',
    ),
    ref: REF_SS,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: entprellte Flanke, gespeicherte Wartezeit',
      'Pattern: debounced edge, latched waiting time',
    ),
    body: lt(
      'Erst die Flanke gegen Prellen und Mehrfachüberfahren sperren:\n\n' +
        `${LOCKOUT_BLOCK_DE}\n\n` +
        'Dann die Wartezeit, die den Wegfall des Startsignals übersteht:\n\n' +
        `${WAIT_BLOCK_DE}\n\n` +
        'Frage: Wie lang muss das Sperrfenster mindestens sein, damit es länger als die Prellzeit ' +
        'UND länger als zwei Zyklen ist? Und woran erkennt Ihr Programm, dass gerade die erste ' +
        'Runde läuft?',
      'First lock out the edge against bouncing and repeated crossings:\n\n' +
        `${LOCKOUT_BLOCK_EN}\n\n` +
        'Then the waiting time, which survives the start signal going away:\n\n' +
        `${WAIT_BLOCK_EN}\n\n` +
        'Question: how long must the lockout window be at minimum so that it is longer than the ' +
        'bounce AND longer than two scans? And how does your program know that this is the first ' +
        'lap?',
    ),
    ref: REF_SS,
    exampleId: 'debounce-lockout',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Ist das Sperrfenster länger als die Prellzeit und länger als zwei Zykluszeiten?',
        'Wird die Anforderung nur bei der ersten gültigen Flanke übernommen?',
        'Wird die speichernde Zeit ausdrücklich zurückgesetzt, bevor sie wieder gebraucht wird?',
        'Kann der Geber beim Ausrollen mehrfach schließen, ohne die Wartezeit neu zu starten?',
        'Werden die Weichen hinter der Lok erst im Stillstand und mit eigenem Stellimpuls gestellt?',
        'Wird die Gegenrichtung erst gesetzt, wenn die Stellzeit abgelaufen ist?',
        'Gilt die Rangierfahrt wirklich nur in der ersten Runde (Sperrmerker gesetzt und nie gelöscht)?',
      ],
      [
        'Is the lockout window longer than the bounce and longer than two scan cycles?',
        'Is the request accepted only on the first valid edge?',
        'Is the retentive timer reset explicitly before it is needed again?',
        'Can the sensor close several times while rolling out without restarting the waiting time?',
        'Are the points behind the loco thrown only at standstill and with their own pulse?',
        'Is the reverse direction set only after the actuation time has elapsed?',
        'Does the shunting move really happen in the first lap only (lockout flag set and never cleared)?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW9: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: auch eine einzelne Weiche braucht einen Impuls',
      'Concept: a single point needs a pulse too',
    ),
    body: lt(
      'Der Sonderfall „nur eine Weiche“ verführt zur Abkürzung: Kontakt direkt auf die Spule. ' +
        'Das ist genau der Fehler, den die Stellzeit-Regel verhindern soll — der Kontakt wäre ' +
        'nur so lange geschlossen, wie der Magnet darüber steht, und die Spule danach ' +
        'unkontrolliert lange bestromt, wenn der Zug stehen bleibt.\n\n' +
        'Also dasselbe Muster wie bei einer ganzen Fahrstraße, nur mit einer Zuweisung.',
      'The special case "only one point" invites a shortcut: contact straight onto the coil. ' +
        'That is exactly the mistake the actuation-time rule prevents — the contact is closed ' +
        'only while the magnet is above it, and the coil would then be energised for an ' +
        'uncontrolled time if the train stops there.\n\n' +
        'So use the same pattern as for a whole route, just with one assignment.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt('Muster: einzelner Stellimpuls', 'Pattern: single actuation pulse'),
    body: lt(
      `${SINGLE_PULSE_BLOCK_DE}\n\n` +
        'Frage: Wie lange wäre die Spule bestromt, wenn Sie den Kontakt direkt zuweisen (`=` ohne ' +
        'Zeitglied) und der Zug ausgerechnet dort langsam wird?',
      `${SINGLE_PULSE_BLOCK_EN}\n\n` +
        'Question: how long would the coil be energised if you assigned the contact directly ' +
        '(`=` without a timer) and the train happened to slow down right there?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Wird die Spule nur für die Stellzeit bestromt?',
        'Ist immer nur eine der beiden Spulen eines Antriebs angesteuert, nie beide gleichzeitig?',
        'Ist der verwendete Timer nicht schon anderweitig belegt?',
        'Stört ein zweites Schließen des Gebers das Ergebnis?',
        'Wird die Weiche gestellt, bevor die Lok den Antrieb erreicht?',
      ],
      [
        'Is the coil energised for the actuation time only?',
        'Is only ever one of a drive\'s two coils commanded, never both at once?',
        'Is the timer you use not already occupied elsewhere?',
        'Does a second closure of the sensor disturb the result?',
        'Is the point thrown before the loco reaches the drive?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW10: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Richtungsumkehr führt über den Stillstand',
      'Concept: reversal goes through standstill',
    ),
    body: lt(
      'Ein Richtungswechsel ist kein Fahrstufenwechsel: erst muss der Zug wirklich stehen, dann ' +
        'darf die Gegenrichtung gesetzt werden. Die Wartezeit dazwischen ist im Programm ein ' +
        'gespeichertes Zeitglied, kein Warten in der Bearbeitung — die SPS arbeitet zyklisch ' +
        'und darf nicht blockieren.\n\n' +
        'Nach dem Anfahren ist zusätzlich die Durchfahrt-Fahrstraße zu stellen; das ist wieder ' +
        'ein Stellimpuls je Weiche.',
      'A reversal is not a stage change: first the train must really be at a stand, only then may ' +
        'the opposite direction be set. The waiting time in between is a latched timer in the ' +
        'program, not a wait inside the scan — the PLC works cyclically and must not block.\n\n' +
        'After starting off, the through route must also be set; that is an actuation pulse per ' +
        'point again.',
    ),
    ref: REF_SS,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Wartezeit, dann Gegenrichtung',
      'Pattern: waiting time, then the opposite direction',
    ),
    body: lt(
      `${WAIT_BLOCK_DE}\n\n` +
        'Die Freigabe setzt anschließend die neue Richtung und löscht die alte — genau wie ein ' +
        'Zustandswechsel.\n\n' +
        'Frage: In welcher Reihenfolge müssen Stillstand, Stellimpuls der Weichen und die neue ' +
        'Fahrstufe wirken, damit die Lok nicht in eine noch laufende Weiche fährt?',
      `${WAIT_BLOCK_EN}\n\n` +
        'The release then sets the new direction and clears the old one — exactly like a state ' +
        'change.\n\n' +
        'Question: in which order must standstill, the points\' actuation pulse and the new ' +
        'traction stage act so that the loco does not run into a point that is still moving?',
    ),
    ref: REF_SR,
    exampleId: 'ss-wait',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Wird die Gegenrichtung erst aus dem Stillstand heraus gesetzt?',
        'Ist die Wartezeit gespeichert (überlebt das Öffnen des Kontakts) und wird sie zurückgesetzt?',
        'Ist danach genau eine Fahrstufe gesetzt?',
        'Hat jede Weiche der Durchfahrt einen Stellimpuls, und ist er vor der Vorbeifahrt beendet?',
        'Stört ein mehrfaches Schließen des Gebers beim Anhalten den Ablauf?',
      ],
      [
        'Is the opposite direction set only out of standstill?',
        'Is the waiting time retentive (surviving the contact opening) and is it reset?',
        'Is exactly one traction stage set afterwards?',
        'Does every point of the passage get a pulse, finished before the loco passes?',
        'Does a repeated closure of the sensor while stopping disturb the sequence?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const A_NW11: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt('Konzept: rundenabhängige Aktionen', 'Concept: lap-dependent actions'),
    body: lt(
      'Derselbe Geber soll in der zweiten Runde etwas anderes bewirken als in der ersten. Die ' +
        'Anleitung nennt genau das als Vorgehensschritt: Kontakte identifizieren, an denen ' +
        'abhängig von der Rundenzahl mehrere Aktionen nötig sind (V.3).\n\n' +
        'Zwei Bauformen sind gängig: ein Zähler mit Vergleich, oder eine Kette von ' +
        'Zustandsmerkern, die den erreichten Abschnitt festhält. Beide brauchen eine Antwort auf ' +
        'die Frage, wo sie zurückgesetzt werden.',
      'The same sensor is meant to do something different in the second lap than in the first. ' +
        'The manual names exactly this as a working step: identify contacts where several actions ' +
        'are required depending on the lap count (V.3).\n\n' +
        'Two shapes are common: a counter with a comparison, or a chain of state flags recording ' +
        'the section reached. Both need an answer to the question where they get reset.',
    ),
    ref: REF_COUNTER,
  }),
  hint({
    level: 2,
    title: lt('Muster: zählen und vergleichen', 'Pattern: count and compare'),
    body: lt(
      `${COUNT_BLOCK_DE}\n\n` +
        'Frage: Zählt Ihr Zähler genau einmal pro Vorbeifahrt — und was zeigt der Vergleich, wenn ' +
        'der Geber beim Anhalten zweimal schließt? Wo setzen Sie den Zähler für einen neuen ' +
        'Programmlauf zurück?',
      `${COUNT_BLOCK_EN}\n\n` +
        'Question: does your counter count exactly once per pass — and what does the comparison ' +
        'show if the sensor closes twice while stopping? Where do you reset the counter for a new ' +
        'program run?',
    ),
    ref: REF_COUNTER,
    exampleId: 'counter-rounds',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Wird pro Vorbeifahrt genau einmal gezählt (Flanke, kein Dauerzustand)?',
        'Ist der Zähler beim Start des Programmlaufs in einem definierten Zustand?',
        'Schließen sich die Zweige „erste Runde“ und „zweite Runde“ gegenseitig aus?',
        'Ist der Endhalt gespeichert, sodass der Zug nicht wieder anfährt?',
        'Sind beim Endhalt alle Fahrzustände zurückgesetzt?',
        'Ist Ihnen klar, welches VKE ein Vergleich hinterlässt, wenn Sie danach weiter verknüpfen?',
      ],
      [
        'Is the count incremented exactly once per pass (edge, not steady state)?',
        'Is the counter in a defined state when the program run starts?',
        'Are the "first lap" and "second lap" branches mutually exclusive?',
        'Is the final halt latched so the train does not start again?',
        'Are all motion states reset at the final halt?',
        'Are you clear about the VKE a comparison leaves behind if you keep combining after it?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW3: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Einbiegen in eine Kehre — Fahrstraße als Einheit',
      'Concept: turning into a loop — the route as one unit',
    ),
    body: lt(
      'Für das Einbiegen müssen mehrere Antriebe gemeinsam die richtige Lage haben. Wichtig: aus ' +
        'den Kontaktbezeichnungen der Antriebe lässt sich der Fahrweg NICHT ableiten — die ' +
        'Aufgabenstellung nennt pro Weiche den zu bestromenden Kontakt, und nur diese Angabe ' +
        'gilt.\n\n' +
        'Der Rest ist das Standardmuster: ein Auslöser, ein Zeitglied, ein Stellimpuls je Spule.',
      'For turning in, several drives must be in the right position together. Important: the ' +
        'travel path can NOT be derived from the drives\' contact labels — the task names the ' +
        'contact to energise per point, and only that statement counts.\n\n' +
        'The rest is the standard pattern: one trigger, one timer, one actuation pulse per coil.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt('Muster: Fahrstraße aus einem Impuls', 'Pattern: one pulse for the whole route'),
    body: lt(
      `${PULSE_BLOCK_DE}\n\n` +
        'Frage: Welche der genannten Weichen liegt direkt hinter dem Auslöser — reicht die ' +
        'Stellzeit, bis die Lok dort ist? Wenn nicht: welcher Geber wäre der richtige Auslöser?',
      `${PULSE_BLOCK_EN}\n\n` +
        'Question: which of the named points sits directly behind the trigger — is the actuation ' +
        'time enough until the loco gets there? If not: which sensor would be the right trigger?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Sind alle genannten Spulen im Impuls enthalten?',
        'Haben Sie je Weiche genau den in der Aufgabe genannten Kontakt bestromt (keine eigene Logik)?',
        'Endet der Impuls nach der Stellzeit von selbst?',
        'Übernehmen Sie die Symbolnamen zeichengenau, inklusive Groß- und Kleinschreibung?',
        'Ist der Timer frei und nicht parallel anderweitig belegt?',
      ],
      [
        'Are all named coils included in the pulse?',
        'Did you energise exactly the contact named in the task per point (no own logic)?',
        'Does the pulse end by itself after the actuation time?',
        'Do you copy the symbol names character-exactly, including upper and lower case?',
        'Is the timer free and not occupied elsewhere in parallel?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW4: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Fahrstraße umstellen, während die Lok noch fährt',
      'Concept: re-throwing the route while the loco is still moving',
    ),
    body: lt(
      'Die Kehre wird verlassen, also müssen Antriebe UMgestellt werden, die vorher anders lagen. ' +
        'Für die Anlage ist das derselbe Vorgang wie das erste Stellen: kurzer Impuls, Stellzeit ' +
        'abwarten. Für Ihr Programm ist es ein Zustandsübergang — das Netzwerk davor darf die ' +
        'Antriebe nicht gleichzeitig in die alte Lage ziehen.\n\n' +
        'Eine nachgeschaltete Weiche gehört in dieselbe Straße, wenn sie zeitgleich laufen darf; ' +
        'sonst braucht sie ein eigenes Zeitglied.',
      'The loop is being left, so drives have to be RE-thrown from a different previous position. ' +
        'For the plant that is the same operation as the first throw: short pulse, wait out the ' +
        'actuation time. For your program it is a state transition — the preceding network must ' +
        'not pull the drives back into the old position at the same time.\n\n' +
        'A downstream point belongs in the same route if it may move simultaneously; otherwise it ' +
        'needs a timer of its own.',
    ),
    ref: REF_SV,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Straße stellen und Fahrstufe setzen',
      'Pattern: throw the route and set the stage',
    ),
    body: lt(
      `${PULSE_BLOCK_DE}\n\n` +
        'Die Fahrstufe kommt als Zustandswechsel hinzu (setzen und die alte löschen).\n\n' +
        'Frage: Darf die nachgeschaltete Weiche am selben Impuls hängen, oder muss sie später ' +
        'laufen? Woran entscheiden Sie das?',
      `${PULSE_BLOCK_EN}\n\n` +
        'The traction stage comes on top as a state change (set it, clear the old one).\n\n' +
        'Question: may the downstream point hang on the same pulse, or must it move later? What ' +
        'do you base that decision on?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Sind alle Antriebe der Ausfahrt enthalten, auch der nachgeschaltete?',
        'Übernehmen Sie die Symbolnamen zeichengenau — einzelne Einträge der Variablenliste weichen ' +
          'von der üblichen Schreibweise ab (Groß-/Kleinschreibung!).',
        'Ist die Fahrstufe gesetzt und die vorherige gelöscht?',
        'Endet jeder Stellimpuls nach der Stellzeit?',
        'Zieht kein früheres Netzwerk dieselben Antriebe gleichzeitig in die alte Lage?',
      ],
      [
        'Are all drives of the exit included, the downstream one as well?',
        'Do you copy the symbol names character-exactly — individual Variablenliste entries deviate ' +
          'from the usual spelling (upper/lower case!).',
        'Is the traction stage set and the previous one cleared?',
        'Does every actuation pulse end after the actuation time?',
        'Is no earlier network pulling the same drives back into the old position at the same time?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW5: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt('Konzept: viele Weichen, ein Auslöser', 'Concept: many points, one trigger'),
    body: lt(
      'Eine lange Fahrstraße ist kein neues Problem, sondern dasselbe Muster mit mehr ' +
        'Zuweisungen: das Zeitglied liefert das Zeitfenster, die Spulen hängen parallel daran. ' +
        'Die Stellzeit wird dadurch nicht länger — alle Antriebe laufen gleichzeitig.\n\n' +
        'Achten Sie darauf, wie viele Antriebe zeitgleich laufen dürfen und ob ein späteres ' +
        'Netzwerk einen davon wieder anders stellt.',
      'A long route is not a new problem but the same pattern with more assignments: the timer ' +
        'provides the time window, the coils hang on it in parallel. The actuation time does not ' +
        'get longer — all drives move simultaneously.\n\n' +
        'Watch how many drives may move at the same time and whether a later network throws one ' +
        'of them differently again.',
    ),
    ref: REF_SV,
  }),
  hint({
    level: 2,
    title: lt('Muster: viele Spulen an einem Impuls', 'Pattern: many coils on one pulse'),
    body: lt(
      `${PULSE_BLOCK_DE}\n\nDie weiteren Spulen hängen nach demselben Muster am selben Impuls.\n\n` +
        'Frage: Verlängert sich die Stellzeit, wenn mehr Spulen am selben Impuls hängen? Und was ' +
        'passiert, wenn zwei Netzwerke denselben Antrieb gegensinnig ansteuern?',
      `${PULSE_BLOCK_EN}\n\nThe further coils hang on the same pulse following the same shape.\n\n` +
        'Question: does the actuation time get longer when more coils hang on the same pulse? And ' +
        'what happens if two networks command the same drive in opposite senses?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Sind alle in der Aufgabe genannten Antriebe enthalten?',
        'Prüfen Sie die Kontaktbezeichnung gegen die Variablenliste — der Aufgabentext enthält ' +
          'vereinzelt Tippfehler.',
        'Endet der Impuls nach der Stellzeit?',
        'Widerspricht kein anderes Netzwerk der hier gewünschten Lage?',
        'Reicht ein Zeitglied, weil alle Antriebe zeitgleich laufen?',
      ],
      [
        'Are all drives named in the task included?',
        'Check the contact designation against the Variablenliste — the task text contains ' +
          'occasional typos.',
        'Does the pulse end after the actuation time?',
        'Does no other network contradict the position wanted here?',
        'Is one timer enough because all drives move simultaneously?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW6: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: drosseln und gleichzeitig den Weg stellen',
      'Concept: slow down and set the path at the same time',
    ),
    body: lt(
      'Ein kleines Netzwerk mit zwei verschiedenen Aktionstypen: die Geschwindigkeit ist ein ' +
        'Zustand (setzen und die alte Stufe löschen), die Weichen brauchen einen Stellimpuls.\n\n' +
        'Achten Sie auf die Schreibweise der Fahrstufe: die Aufgabentexte kürzen die Namen ' +
        'gelegentlich ab, maßgeblich ist die Variablenliste bzw. die Autovervollständigung.',
      'A small network with two different kinds of action: the speed is a state (set it, clear ' +
        'the old stage), the points need an actuation pulse.\n\n' +
        'Mind the spelling of the traction stage: the task texts occasionally abbreviate the ' +
        'names; the Variablenliste and its autocompletion are authoritative.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt('Muster: Zustand und Impuls kombiniert', 'Pattern: state and pulse combined'),
    body: lt(
      `${STAGE_BLOCK_DE}\n\n` +
        'Die Weichen kommen mit dem Stellimpuls-Muster dazu (siehe verlinktes Beispiel).\n\n' +
        'Frage: Dürfen Fahrstufe und Stellimpuls an derselben Flanke hängen — oder braucht die ' +
        'Fahrstufe eine eigene Bedingung, weil sie länger gelten muss?',
      `${STAGE_BLOCK_EN}\n\n` +
        'The points come in with the actuation-pulse pattern (see the linked example).\n\n' +
        'Question: may the stage and the pulse hang on the same edge — or does the stage need its ' +
        'own condition because it has to hold for longer?',
    ),
    ref: REF_SR,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Ist die neue Fahrstufe gesetzt und die vorherige gelöscht?',
        'Ist der Symbolname der Fahrstufe exakt wie in der Variablenliste geschrieben?',
        'Haben beide Weichen einen Stellimpuls von 300 ms?',
        'Wird gedrosselt, bevor die Lok den Bahnhofsbereich erreicht?',
        'Bleibt die Fahrstufe erhalten, wenn der Geber wieder öffnet?',
      ],
      [
        'Is the new traction stage set and the previous one cleared?',
        'Is the stage\'s symbol name written exactly as in the Variablenliste?',
        'Do both points get a 300 ms actuation pulse?',
        'Is the speed reduced before the loco reaches the station area?',
        'Does the traction stage survive the sensor opening again?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW7: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Rangierschritt = Halten, Warten, Weg stellen, Gegenrichtung',
      'Concept: a shunting step = halt, wait, set the path, reverse',
    ),
    body: lt(
      'Vier Teilschritte in einer festen Reihenfolge. Der Auslöser ist eine Vorbeifahrt, also ' +
        'ein kurzes Ereignis — die Wartezeit muss danach ohne den Geber weiterlaufen ' +
        '(speichernde Einschaltverzögerung, Anleitung IV.2.6.4) und ausdrücklich zurückgesetzt ' +
        'werden.\n\n' +
        'Im Modellmaßstab ist kein zielgenaues Bremsen möglich: rechnen Sie damit, dass der ' +
        'Geber beim Anhalten mehrfach geschlossen wird (Anleitung V.3). Die Gegenrichtung darf ' +
        'erst aus dem Stillstand und erst nach Ablauf der Stellzeit der Weichen kommen.',
      'Four sub-steps in a fixed order. The trigger is a pass, i.e. a brief event — the waiting ' +
        'time must keep running afterwards without the sensor (retentive on-delay, manual ' +
        'IV.2.6.4) and must be reset explicitly.\n\n' +
        'At model scale there is no precise braking: expect the sensor to close several times ' +
        'while stopping (manual V.3). The reverse direction may only come out of standstill and ' +
        'only after the points\' actuation time has elapsed.',
    ),
    ref: REF_SS,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: gespeicherte Wartezeit als Schrittfreigabe',
      'Pattern: latched waiting time as step release',
    ),
    body: lt(
      `${WAIT_BLOCK_DE}\n\n` +
        'Die Freigabe stellt anschließend die Fahrstraße (Stellimpuls) und setzt die ' +
        'Gegenrichtung als Zustand.\n\n' +
        'Frage: Welche Bedingung stellt sicher, dass die Weichen erst im Stillstand gestellt ' +
        'werden — und die Gegenrichtung erst danach?',
      `${WAIT_BLOCK_EN}\n\n` +
        'The release then throws the route (actuation pulse) and sets the reverse direction as a ' +
        'state.\n\n' +
        'Question: which condition makes sure the points are thrown only at standstill — and the ' +
        'reverse direction only after that?',
    ),
    ref: REF_SS,
    exampleId: 'ss-wait',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Läuft die Wartezeit weiter, obwohl der Geber längst wieder offen ist?',
        'Wird die Zeit zurückgesetzt, sodass sie später erneut von vorn laufen kann?',
        'Sind alle genannten Antriebe im Stellimpuls enthalten?',
        'Wird die Gegenrichtung erst im Stillstand und nach der Stellzeit gesetzt?',
        'Ist danach genau eine Fahrstufe gesetzt?',
        'Stört ein mehrfaches Schließen des Gebers beim Ausrollen den Ablauf?',
      ],
      [
        'Does the waiting time keep running although the sensor has long since opened?',
        'Is the timer reset so it can run from the start again later?',
        'Are all named drives included in the actuation pulse?',
        'Is the reverse direction set only at standstill and after the actuation time?',
        'Is exactly one traction stage set afterwards?',
        'Does a repeated closure of the sensor while rolling out disturb the sequence?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW8: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: zweiter Rangierschritt — Zustände auseinanderhalten',
      'Concept: the second shunting step — keeping states apart',
    ),
    body: lt(
      'Der Ablauf sieht aus wie der vorige Schritt: halten, warten, Weg stellen, in die andere ' +
        'Richtung ausfahren. Genau darin liegt die Falle — Ihr Programm muss die beiden Schritte ' +
        'unterscheiden können, sonst löst der zweite Geber den ersten Schritt erneut aus.\n\n' +
        'Bewährt ist eine Schrittkette: jeder Schritt setzt seinen Nachfolger frei und meldet ' +
        'sich selbst ab. Ein wiederverwendetes Zeitglied muss vorher zurückgesetzt sein.',
      'The sequence looks like the previous step: halt, wait, set the path, leave in the other ' +
        'direction. That is exactly where the trap sits — your program has to tell the two steps ' +
        'apart, otherwise the second sensor triggers the first step again.\n\n' +
        'A step chain works well: each step releases its successor and deregisters itself. A ' +
        'reused timer must have been reset beforehand.',
    ),
    ref: REF_SE,
  }),
  hint({
    level: 2,
    title: lt('Muster: Schrittkette', 'Pattern: step chain'),
    body: lt(
      `${STEP_BLOCK_DE}\n\nDanach folgt wieder Wartezeit, Stellimpuls und Fahrstufe.\n\n` +
        'Frage: Welches Zeitglied müssen Sie zurücksetzen, bevor Sie es im zweiten Schritt erneut ' +
        'starten — und was passiert, wenn Sie es vergessen?',
      `${STEP_BLOCK_EN}\n\nAfter that comes the waiting time, the pulse and the stage again.\n\n` +
        'Question: which timer must you reset before starting it again in the second step — and ' +
        'what happens if you forget?',
    ),
    ref: REF_SS,
    exampleId: 'ss-wait',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Kann der zweite Geber den ersten Schritt nicht erneut auslösen?',
        'Hat jeder Schritt einen eigenen Flankenoperanden?',
        'Ist ein wiederverwendetes Zeitglied vor dem erneuten Start zurückgesetzt?',
        'Wird wieder aus dem Stillstand heraus die Richtung gewechselt?',
        'Sind die Antriebe der Ausfahrt vollständig im Stellimpuls?',
        'Ist am Ende genau eine Fahrstufe gesetzt?',
      ],
      [
        'Is the second sensor unable to trigger the first step again?',
        'Does every step have its own edge operand?',
        'Is a reused timer reset before it is started again?',
        'Is the direction changed out of standstill again?',
        'Are the exit drives completely covered by the actuation pulse?',
        'Is exactly one traction stage set at the end?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW9: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: Blockabschnitt vorbereiten und beschleunigen',
      'Concept: prepare the block section and accelerate',
    ),
    body: lt(
      'Volle Fahrt und eine lange Fahrstraße zugleich: die Fahrstufe ist ein Zustand, der bis ' +
        'zur nächsten Änderung gilt, die Antriebe brauchen ihren kurzen Stellimpuls. Beides kann ' +
        'am selben Auslöser hängen — aber mit unterschiedlicher Zuweisungsart.\n\n' +
        'Bei hoher Geschwindigkeit ist der Vorlauf wichtig: die Antriebe müssen fertig gestellt ' +
        'sein, bevor die Lok sie erreicht.',
      'Full speed and a long route at once: the traction stage is a state that holds until the ' +
        'next change, the drives need their short actuation pulse. Both may hang on the same ' +
        'trigger — but with different kinds of assignment.\n\n' +
        'At high speed the lead time matters: the drives must have finished moving before the ' +
        'loco reaches them.',
    ),
    ref: REF_SETUP,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Fahrstufe plus Fahrstraße aus einer Flanke',
      'Pattern: stage plus route from one edge',
    ),
    body: lt(
      `${PULSE_BLOCK_DE}\n\nDie Fahrstufe wird zusätzlich statisch gesetzt, die alte gelöscht.\n\n` +
        'Frage: Setzen Sie Fahrstufe und Stellimpuls aus derselben Flanke, oder braucht die ' +
        'Fahrstufe eine eigene Bedingung? Was ändert das, wenn der Geber zweimal schließt?',
      `${PULSE_BLOCK_EN}\n\nThe stage is additionally set statically, the old one cleared.\n\n` +
        'Question: do you set the stage and the pulse from the same edge, or does the stage need ' +
        'its own condition? What difference does that make if the sensor closes twice?',
    ),
    ref: REF_SV,
    exampleId: 'weichenstrasse-template',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Sind alle Antriebe des Blockabschnitts enthalten?',
        'Ist die höchste Fahrstufe gesetzt und die vorherige gelöscht?',
        'Reicht der Vorlauf zwischen Auslöser und erster Weiche bei dieser Geschwindigkeit?',
        'Endet jeder Stellimpuls nach der Stellzeit?',
        'Ist der Timer nicht gleichzeitig anderweitig belegt?',
      ],
      [
        'Are all drives of the block section included?',
        'Is the highest traction stage set and the previous one cleared?',
        'Is the lead time between trigger and first point enough at this speed?',
        'Does every actuation pulse end after the actuation time?',
        'Is the timer not occupied elsewhere at the same time?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW10: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt(
      'Konzept: derselbe Kontakt, zweite Vorbeifahrt',
      'Concept: the same contact, second pass',
    ),
    body: lt(
      'Der Geber wurde in einem früheren Netzwerk schon benutzt — jetzt soll er etwas anderes ' +
        'bewirken. Ohne zusätzliche Information kann das Programm die beiden Vorbeifahrten nicht ' +
        'unterscheiden; es braucht ein Gedächtnis: einen Zähler oder einen Zustandsmerker, der ' +
        'den erreichten Abschnitt festhält.\n\n' +
        'Die Anleitung nennt genau diese Aufgabe im Vorgehen (V.3) und weist darauf hin, dass ' +
        'Zähler und Zeiten je nach Verwendung zurückgesetzt werden müssen.',
      'The sensor was already used in an earlier network — now it is meant to do something else. ' +
        'Without extra information the program cannot tell the two passes apart; it needs a ' +
        'memory: a counter, or a state flag recording the section reached.\n\n' +
        'The manual names exactly this task in its working steps (V.3) and points out that ' +
        'counters and timers may have to be reset depending on how they are used.',
    ),
    ref: REF_COUNTER,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Vorbeifahrten zählen und unterscheiden',
      'Pattern: count passes and tell them apart',
    ),
    body: lt(
      `${COUNT_BLOCK_DE}\n\n` +
        'Alternativ trägt ein Zustandsmerker die Information, welcher Abschnitt schon absolviert ' +
        'ist — dann fragt dieses Netzwerk diesen Merker zusätzlich ab.\n\n' +
        'Frage: Welche der beiden Varianten ist robuster, wenn der Geber beim Anhalten mehrfach ' +
        'schließt? Und wo wird der Zähler bzw. der Merker zurückgesetzt?',
      `${COUNT_BLOCK_EN}\n\n` +
        'Alternatively a state flag carries the information which section has been completed — ' +
        'this network then also queries that flag.\n\n' +
        'Question: which of the two is more robust if the sensor closes several times while ' +
        'stopping? And where is the counter or flag reset?',
    ),
    ref: REF_COUNTER,
    exampleId: 'counter-rounds',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Unterscheidet Ihr Programm die erste von der zweiten Vorbeifahrt eindeutig?',
        'Wird pro Vorbeifahrt genau einmal gezählt (Flanke)?',
        'Ist der Zähler bzw. Merker zu Beginn des Programmlaufs definiert?',
        'Hat die Weiche einen Stellimpuls von 300 ms?',
        'Ist die neue Fahrstufe gesetzt und die alte gelöscht?',
        'Schließen sich die Zweige für erste und zweite Vorbeifahrt gegenseitig aus?',
      ],
      [
        'Does your program distinguish the first from the second pass unambiguously?',
        'Is the count incremented exactly once per pass (edge)?',
        'Is the counter or flag defined at the start of the program run?',
        'Does the point get a 300 ms actuation pulse?',
        'Is the new traction stage set and the old one cleared?',
        'Are the branches for the first and second pass mutually exclusive?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

const B_NW11: readonly HintSpec[] = [
  hint({
    level: 1,
    title: lt('Konzept: Endhalt speichern', 'Concept: latching the final halt'),
    body: lt(
      'Der letzte Halt ist ein Zustand, der bleiben soll: nach dem Anhalten darf kein Netzwerk ' +
        'den Zug wieder anfahren lassen. Ein dynamisch zugewiesener Halt hält nur, solange die ' +
        'Bedingung ansteht — der Geber ist aber nach einer Sekunde wieder offen.\n\n' +
        'Auch hier gilt: derselbe Geber wurde früher schon benutzt, das Programm braucht also ' +
        'die Information, dass es diesmal der letzte Abschnitt ist.',
      'The final halt is a state that is meant to persist: after stopping, no network may let the ' +
        'train start again. A dynamically assigned halt only holds while its condition is ' +
        'present — but the sensor is open again a second later.\n\n' +
        'Here too: the same sensor was used before, so the program needs the information that ' +
        'this time it is the final section.',
    ),
    ref: REF_SR,
  }),
  hint({
    level: 2,
    title: lt(
      'Muster: Endhalt setzen und Fahrzustände löschen',
      'Pattern: set the final halt and clear the motion states',
    ),
    body: lt(
      `${FINAL_BLOCK_DE}\n\n` +
        'Frage: Bleibt der Endhalt gesetzt, wenn der Geber beim Ausrollen ein zweites Mal ' +
        'schließt? Und ist danach sichergestellt, dass kein anderes Netzwerk wieder eine ' +
        'Fahrstufe setzt?',
      `${FINAL_BLOCK_EN}\n\n` +
        'Question: does the final halt stay set if the sensor closes a second time while rolling ' +
        'out? And is it then guaranteed that no other network sets a traction stage again?',
    ),
    ref: REF_SR,
    exampleId: 'pump-selfhold',
  }),
  hint({
    level: 3,
    title: CHECKLIST,
    body: checklist(
      [
        'Ist der Endhalt gespeichert und nicht dynamisch zugewiesen?',
        'Sind alle Fahrzustände beim Endhalt zurückgesetzt?',
        'Erkennt das Programm, dass es die letzte Vorbeifahrt an diesem Geber ist?',
        'Kann kein früheres Netzwerk danach wieder eine Fahrstufe setzen?',
        'Stört ein mehrfaches Schließen des Gebers beim Ausrollen?',
      ],
      [
        'Is the final halt latched rather than dynamically assigned?',
        'Are all motion states reset at the final halt?',
        'Does the program recognise that this is the last pass over this sensor?',
        'Can no earlier network set a traction stage again afterwards?',
        'Does a repeated closure of the sensor while rolling out cause trouble?',
      ],
    ),
    ref: REF_TIPS,
  }),
];

// ───────────────────────────────────────── the library ────────────────────────────────────

/**
 * Network id → its three hints. Ids follow §5.5 (`"A-NW1"` … `"B-NW11"`); a network absent
 * here simply has no built-in hints (the loader then keeps whatever exercises.json provides).
 */
export const HINT_LIBRARY: Readonly<Record<string, readonly HintSpec[]>> = {
  'A-NW1': FAILSAFE_HALT_HINTS,
  'A-NW2': RESTART_HINTS,
  'A-NW3': A_NW3,
  'A-NW4': A_NW4,
  'A-NW5': A_NW5,
  'A-NW6': A_NW6,
  'A-NW7': A_NW7,
  'A-NW8': A_NW8,
  'A-NW9': A_NW9,
  'A-NW10': A_NW10,
  'A-NW11': A_NW11,
  'B-NW1': FAILSAFE_HALT_HINTS,
  'B-NW2': RESTART_HINTS,
  'B-NW3': B_NW3,
  'B-NW4': B_NW4,
  'B-NW5': B_NW5,
  'B-NW6': B_NW6,
  'B-NW7': B_NW7,
  'B-NW8': B_NW8,
  'B-NW9': B_NW9,
  'B-NW10': B_NW10,
  'B-NW11': B_NW11,
};

/** The 22 network ids the library covers, in exercise order. */
export const HINT_LIBRARY_NETWORK_IDS: readonly string[] = Object.keys(HINT_LIBRARY);

export function hintsForNetwork(networkId: string): readonly HintSpec[] {
  return HINT_LIBRARY[networkId] ?? [];
}

/** Example ids referenced by the library — cross-checked against examples.json in tests. */
export function referencedExampleIds(): string[] {
  const ids = new Set<string>();
  for (const hints of Object.values(HINT_LIBRARY)) {
    for (const hint_ of hints) {
      if (hint_.exampleId !== undefined) ids.add(hint_.exampleId);
    }
  }
  return [...ids];
}
