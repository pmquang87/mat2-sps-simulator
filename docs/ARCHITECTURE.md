# MAT2 SPS 3D-Simulator — Implementation Architecture

Date: 2026-07-26. Detailed design within the constraints of `docs/ARCHITECTURE_BRIEF.md`
(binding). Implementation agents follow this file literally; deviations require an explicit
note in the PR description and an update to this file.

Source documents (read before implementing your module):
`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE_BRIEF.md`, `reference/research/anleitung.md`,
`reference/research/weichen_video.md` (gitignored, local only — it contains verbatim
solution-derived AWL and the per-network route tables for both groups; it must never be
committed, and must be purged from history if it ever was),
`reference/research/solutions.md` (gitignored, local only),
`reference/research/video_design.md`, `reference/research/hinweise.md`.

---

## 1. Constraints recap (binding, from the brief)

- Web app, **no backend**. TypeScript `strict`, Vite, Three.js, CodeMirror 6, vitest.
  `npm run build` → static `dist/` whose `index.html` must open directly from `file://`
  (the double-click install path): the build inlines all JS/CSS via
  `vite-plugin-singlefile`, because plain ES-module builds are CORS-blocked on `file://`
  even with `base: './'`. Fallback for served use: `npx serve dist`. Acceptance check:
  open `dist/index.html` from Explorer. Node 24.
- i18n from day one: **English default, German toggle**, persisted in `localStorage`.
- `core/` and `plant/` are **pure logic — no DOM, no Three.js, no wall clock, no
  `Math.random`**. One-way data flow: `ui → core/plant → scene`.
- Milestone 1 = AWL subset below, 3D scene with 4 cameras, exercise browser with hints, EN/DE.
- `reference/Claude_work/` solutions are **test oracles only** — loaded at test time from the
  filesystem, skipped if absent, never imported from `src/`, never bundled, never committed
  (path is gitignored).

---

## 2. System overview

```
                ┌────────────────────────── ui/ ──────────────────────────┐
                │ EditorPanel (CodeMirror6)   ExercisePanel   ControlPanel │
                │ DiagnosticsPanel  ExamplesPanel  WatchPanel(M2) i18n     │
                └───────┬──────────────────────────────┬──────────────────┘
       load(source)     │ commands (run/pause/Notaus)  │ reads results/state
                        ▼                              ▼
                ┌─────────────── app/ SimCoordinator (fixed-step loop) ────┐
                │  SimClock · Wiring (symbol↔plant binding) · EventBus     │
                └──┬────────────────────────────────────────────────┬──────┘
   PAE write / PAA+M read                                 actuators / sensors
                   ▼                                                ▼
        ┌───── core/ ─────┐                              ┌───── plant/ ─────┐
        │ tokenizer parser│                              │ TrackGraph Train │
        │ SymbolTable     │                              │ Switches Reeds   │
        │ Emulator (S7)   │                              │ Fahrstrom  PRNG  │
        └─────────────────┘                              └───────┬──────────┘
                                                    PlantSnapshot│ (read-only)
                                                                 ▼
                                                        ┌───── scene/ ─────┐
                                                        │ Three.js render  │
                                                        │ 4 camera modes   │
                                                        └──────────────────┘
        pedagogy/  ←  SimEvents from EventBus (BehaviorChecker), exercises.json
        data/      →  trackplan.json · variables.json · exercises.json · examples.json

        pump/  ── the SECOND experiment (§13), a parallel stack behind the same shell ──
        │ PumpPlant · PumpCoordinator · pump wiring/variables · PumpEventBus │
        │ pump/scene/ (PumpScene, picking, orbit)                            │
        └ imports core/ only; ui/ selects it through SimProfile ────────────┘
```

Data flow rules (enforced by review + an ESLint `no-restricted-imports` config):

1. `core/` imports **nothing** from other `src/` modules.
2. `plant/` imports only `core/` *types* (`BitAddress` for reed wiring) — no core runtime.
3. `scene/` imports `plant/` types (`PlantSnapshot`, trackplan types) — never mutates plant.
4. `ui/` and `app/` may import public APIs (`index.ts`) of everything.
5. `pedagogy/` imports `core/` + `plant/` types and the `SimEvent` union — no DOM except
   through `ui/` rendering its data.
6. `data/` contains JSON only — no TypeScript. Types for each JSON file live in the
   consuming module (§7 names the owner of each schema type).
7. Deep imports (`core/parser` from outside `core/`) are forbidden; every module exposes its
   entire public surface via `src/<module>/index.ts`. `pump/index.ts` therefore re-exports its
   own renderer (`pump/scene/index.ts`) as well, so the bootstrap needs no deep path. The price
   is stated rather than hidden: `import … from '../pump'` now pulls Three.js into the module
   graph. That costs the bundle nothing (the app draws either way, and both experiments are in
   one `dist/index.html`); it is paid only by the node suites, which load a renderer they do
   not use.
8. `pump/` (§13) is the second experiment's plant layer. It imports **`core/` only** — in
   particular not `plant/`, so the two experiments cannot entangle — and the §6.3 determinism
   rules apply to it exactly as to `core/` and `plant/`. `pump/scene/**` is the one part that
   renders: it may additionally use Three.js, the DOM and `scene/`'s public index (it reuses
   the railway's `LabelFactory`, `deconflictPlates` and `SceneQuality` rather than forking
   them). All of this is enforced in `.eslintrc.cjs` — with the measured caveat recorded
   there and in `reference/HANDOFF.md`: the `!(index)` extglob form matches nothing under ESLint 8,
   so the deep-import half of rule 7 is currently a review rule.

Deviation note (required by the brief's fixed module layout): `src/app/` is a seventh
top-level module beyond the brief's six. Justification: the coordination layer
(SimCoordinator, SimClock, Wiring, EventBus, RafDriver) is exactly what keeps `core/` and
`plant/` free of DOM and wall-clock access (§6); folding it into `ui/` would tie the
deterministic loop to DOM code, and folding it into `core/` or `plant/` would break their
purity rules.

---

## 3. Repository layout (complete)

Every planned file with a one-line purpose. Folder = ownership unit (§4).

```
mat2_sps/
├─ index.html                       Vite entry HTML; app shell mount point, canvas element
├─ package.json                     deps: three, codemirror packages, vitest, typescript, vite
├─ tsconfig.json                    strict: true, noUncheckedIndexedAccess: true, ES2022
├─ vite.config.ts                   build config, JSON imports, vite-plugin-singlefile (file:// support, §1)
├─ vitest.config.ts                 node environment for core/plant, jsdom only where needed
├─ .eslintrc.cjs                    import-boundary rules from §2 (no-restricted-imports)
├─ .gitignore                       (exists) reference/Claude_work/, dist/, node_modules/, solutions.md, weichen_video.md, DOMAIN_MODEL.md (§9.4)
├─ public/
│  └─ favicon.svg                   app icon
├─ tools/
│  ├─ gen-variables.ts              parse ../Variablenliste.txt → src/data/variables.json (run via tsx)
│  └─ validate-trackplan.ts         graph checker: edge continuity, switch arity, reed refs, orientation
├─ src/
│  ├─ main.ts                       entry: ROUTES on readStoredExperiment(), then bootstrapRailway() — data JSONs, coordinator + scene + ui, RAF
│  ├─ pumpBootstrap.ts              the pump experiment's entry path (§13.3): storage, PumpScene, RafDriver, SimHost
│  ├─ app/
│  │  ├─ index.ts                   public re-exports of app module
│  │  ├─ SimCoordinator.ts          master fixed-step loop: plant.step + PLC scan + I/O ferrying
│  │  ├─ SimClock.ts                deterministic accumulator clock, time scale, pause
│  │  ├─ Wiring.ts                  builds symbol↔plant binding tables from SymbolTable + trackplan
│  │  ├─ EventBus.ts                typed pub/sub for SimEvent (plant/emulator → ui/pedagogy)
│  │  └─ RafDriver.ts               requestAnimationFrame driver; real-time → SimClock feed (DOM ok here)
│  ├─ core/                         ── pure, headless, deterministic ──
│  │  ├─ index.ts                   public API surface of core
│  │  ├─ address.ts                 Address model (E/A/M bits, EW/AW/MW words, T, Z), parse/format
│  │  ├─ symbols.ts                 SymbolTable: case-sensitive lookup, case-insensitive suggestions
│  │  ├─ s5time.ts                  S5TIME encode/decode/parse/format (16-bit base+BCD)
│  │  ├─ tokenizer.ts               AWL lexer: mnemonics, quoted symbols, literals, labels, // comments
│  │  ├─ ast.ts                     Program/Instruction/Operand types, Mnemonic union (M1 set)
│  │  ├─ parser.ts                  tokens → Program; static checks (symbols, operand types, labels)
│  │  ├─ diagnostics.ts             Diagnostic type, DE+EN message catalog, code registry
│  │  ├─ memory.ts                  MemoryAreas: Uint8Array E/A/M, bit+word (big-endian) access
│  │  ├─ timers.ts                  S5 timer bank: SI/SV/SE/SS/SA semantics, per-timer edge memory
│  │  ├─ counters.ts                Z bank: ZV/ZR/S/R/FR, 0..999 saturating, edge memories
│  │  ├─ exec.ts                    instruction dispatch: VKE/ERAB status, accus, per-op semantics
│  │  └─ emulator.ts                Emulator facade: load/step/reset/inspection, scan cycle driver
│  ├─ plant/                        ── pure, headless, deterministic ──
│  │  ├─ index.ts                   public API surface of plant
│  │  ├─ types.ts                   TrackplanFile schema types, Vec2, shared plant types
│  │  ├─ geometry.ts                polyline length, point/tangent at offset, unit conversion
│  │  ├─ trackGraph.ts              TrackGraph: nodes/edges, adjacency, route lookup through switches
│  │  ├─ occupiedPath.ts            OccupiedPath: recorded track under the consist, published as ConsistPath
│  │  ├─ train.ts                   Train: edge+offset+direction state, accel model, node transitions
│  │  ├─ switches.ts                Switch: G/R coil inputs, 300 ms actuation, coilToBranch mapping
│  │  ├─ reeds.ts                   Reed: magnet-window closure, latch-until-consumed, bounce generator
│  │  ├─ fahrstrom.ts               M120 bits → AW6 word (FB1 sim) and AW6 → speed mm/s + command (IU/GU/STOP)
│  │  ├─ random.ts                  mulberry32 seeded PRNG (only randomness source in plant)
│  │  └─ plant.ts                   Plant facade: step(dt), actuator/sensor API, snapshot(), events
│  ├─ scene/
│  │  ├─ index.ts                   public API surface of scene
│  │  ├─ SceneManager.ts            Three.js setup, render loop hook, snapshot → scene update
│  │  ├─ trackMesh.ts               extrude track ribbons + sleepers + ballast from trackplan polylines
│  │  ├─ switchMesh.ts              switch points geometry, blade animation from SwitchState
│  │  ├─ trainMesh.ts               loco (BR119-like, dark red) + 2 coaches, position/heading from snapshot
│  │  ├─ reedMesh.ts                glass-tube reed markers between rails, closure flash
│  │  ├─ labels.ts                  white label sprites (xW…/xR… names) — didactically central
│  │  ├─ landscape.ts               decorative: MFD mountains + tunnel over C/K, Badesee, buildings
│  │  ├─ cameras.ts                 orbit / bird / cab / trackside camera rigs + switching
│  │  └─ materials.ts               shared materials/palette (model-railway look per video_design.md)
│  ├─ pump/                         ── second experiment (§13); pure + deterministic, imports core/ only ──
│  │  ├─ index.ts                   public API surface of pump (incl. the scene re-export, §2 rule 7)
│  │  ├─ types.ts                   sensor/button/toggle/actuator/valve ids, PumpEvent, PumpEventBus
│  │  ├─ params.ts                  PumpParams, ranges, documented defaults, clampPumpParams (never throws)
│  │  ├─ paramsStorage.ts           parse/serialize the stored parameter patch (pure; the host owns storage)
│  │  ├─ task.ts                    PUMP_TASK — the Anleitung's task text for this plant, DE + EN
│  │  ├─ model.ts                   PumpPlant: fixed-step physics, hysteresis level bits, dry-run guard
│  │  ├─ variables.ts               PUMP_VARIABLES → SymbolTable.fromVariables
│  │  ├─ wiring.ts                  plant id ↔ address, VERIFIED against the Anleitung's map
│  │  ├─ coordinator.ts             PumpCoordinator — the §5.2 loop order, parallel to SimCoordinator
│  │  ├─ stack.ts                   createPumpStack() — the one call the bootstrap needs
│  │  └─ scene/                     PumpScene, scene graph, picking, orbit rig, pedestal, tanks, piping, water
│  │     └─ dev/                    standalone harness for the pump scene (never reaches dist/)
│  ├─ ui/
│  │  ├─ index.ts                   public API surface of ui
│  │  ├─ App.ts                     layout shell: 3D viewport + side panels, DE/EN toggle, experiment switcher
│  │  ├─ experiment.ts              ExperimentId, storage key, editorStorageKeyFor, switchExperiment (§13.1)
│  │  ├─ pumpProfile.ts             buildPumpProfile / parameter host / plant-control strip / watch layout (§13)
│  │  ├─ editor/
│  │  │  ├─ EditorPanel.ts          CodeMirror 6 instance, load-to-PLC button, dirty state
│  │  │  ├─ bufferStore.ts          debounced localStorage mirror of the buffer + explicit flush (§13.1)
│  │  │  ├─ awlLanguage.ts          CM6 language: AWL tokens, highlighting
│  │  │  ├─ completion.ts           autocompletion fed by SymbolTable (mirrors Atom+variablen.txt)
│  │  │  └─ lint.ts                 CM6 lint source adapter over core Diagnostics
│  │  ├─ panels/
│  │  │  ├─ ControlPanel.ts         run/pause/reset, start track (Gruppe A/B), time scale, scan interval, Notaus button, camera mode
│  │  │  ├─ ExercisePanel.ts        exercise browser, network list, task text DE/EN, check results
│  │  │  ├─ HintPanel.ts            progressive hint reveal (level gating, "show next hint")
│  │  │  ├─ ExamplesPanel.ts        examples library browser (read-only AWL snippets, copy button)
│  │  │  ├─ DiagnosticsPanel.ts     parse/runtime diagnostics list (localized), click → editor line
│  │  │  ├─ TaskPanel.ts            static bilingual task document (§13.2; the pump's Exercises tab)
│  │  │  ├─ ParametersPanel.ts      labelled slider + number field per plant parameter (§13.4)
│  │  │  ├─ WatchPanel.ts           (M2) watch table: symbol rows, live values, input forcing
│  │  │  └─ CycleInspectorPanel.ts  (M2) per-instruction stepping view: VKE/ERAB/accus per line
│  │  ├─ i18n/
│  │  │  ├─ i18n.ts                 t(), lt(), setLocale/getLocale/onLocaleChange, localStorage persist
│  │  │  ├─ en.ts                   English dictionary (source of truth for MsgKey type)
│  │  │  └─ de.ts                   German dictionary (Record<MsgKey, string>, checked by tsc)
│  │  ├─ layout/                    (added, §5.7) user-resizable panels
│  │  │  ├─ layoutModel.ts          pure: weights, drag clamping, floor repair, grid track lists, persist format
│  │  │  └─ LayoutController.ts     DOM: role="separator" splitters, pointer/arrow-key resize, "mat2sps.layout.v1"
│  │  └─ styles.css                 layout + panel styling (dark, lab-like)
│  ├─ pedagogy/
│  │  ├─ index.ts                   public API surface of pedagogy
│  │  ├─ types.ts                   ExerciseSpec, NetworkSpec, HintSpec, BehaviorCheck, EventPattern
│  │  ├─ exerciseLoader.ts          exercises.json → validated ExerciseSpec[]
│  │  ├─ behaviorCheck.ts           BehaviorChecker: SimEvent stream → per-check pass/fail/pending
│  │  ├─ hints.ts                   hint unlock policy (attempt/time gated), no-solution guard rules
│  │  ├─ examplesLoader.ts          examples.json → ExampleSpec[] for ExamplesPanel
│  │  └─ progress.ts                per-exercise progress + hint state (injected KeyValueStore; ui supplies localStorage)
│  └─ data/
│     ├─ trackplan.json             track graph, switches (with coilToBranch), reeds, landscape, meta
│     ├─ variables.json             generated from Variablenliste.txt by tools/gen-variables.ts
│     ├─ exercises.json             Gruppe A/B networks: task texts DE/EN, hints, behavior checks
│     └─ examples.json              examples library (Anleitung pump/timer/edge/jump patterns, DE+EN)
└─ tests/
   ├─ core/
   │  ├─ address.test.ts            parse/format all address forms, invalid inputs
   │  ├─ symbols.test.ts            case-sensitive lookup, XW03CR/XW05BH1G3R traps, suggestions
   │  ├─ s5time.test.ts             encode/decode/parse/format, bases, rounding, range errors
   │  ├─ tokenizer.test.ts          all token classes, comments, quoted symbols, error positions
   │  ├─ parser.test.ts             AST shape, operand typing, label resolution, diagnostics DE+EN
   │  ├─ bitlogic.test.ts           U/UN/O/ON/X/XN, Erstabfrage, = / S / R (incl. VKE=0 no-op)
   │  ├─ loadtransfer.test.ts       L/T accu shift, VKE-neutrality, word big-endian
   │  ├─ timers-si.test.ts          SI: start edge, early VKE drop kills Q
   │  ├─ timers-sv.test.ts          SV: full duration, retrigger, R T abort
   │  ├─ timers-se.test.ts          SE: delayed Q, requires VKE held, drop aborts
   │  ├─ timers-ss.test.ts          SS: latch after expiry, retrigger, mandatory R T reset
   │  ├─ timers-sa.test.ts          SA: immediate Q, off-delay on falling edge
   │  ├─ counters.test.ts           ZV edge + same-cycle L Z read, ZR, S Z, R Z, 0..999 saturation
   │  ├─ compare.test.ts            all six ==I..<=I, signed 16-bit, VKE replacement + chaining
   │  ├─ jumps.test.ts              SPA/SPB/SPBN fwd+back, label errors, post-jump VKE
   │  ├─ edges.test.ts              FP/FN single-cycle pulse, operand update, string continuation
   │  └─ scancycle.test.ts          PAE/PAA latching, cycle count, reset(), timer advance ordering
   ├─ plant/
   │  ├─ geometry.test.ts           lengths, point-at-offset, tangents
   │  ├─ trackgraph.test.ts         adjacency, traversal through switch positions
   │  ├─ train.test.ts              motion, accel/decel lag, edge transitions, reversal
   │  ├─ switches.test.ts           coil edge → 300 ms actuation, conflict, mapping application
   │  ├─ reeds.test.ts              window closure, latch-until-consume, bounce determinism (seeded)
   │  ├─ fahrstrom.test.ts          M120 bit priority → AW6 → speed/direction, conflict warning
   │  └─ plant.test.ts              facade step ordering, snapshot integrity, event emission
   ├─ app/
   │  ├─ coordinator.test.ts        scan/physics interleaving, I/O ferry, wiring correctness
   │  └─ determinism.test.ts        two identical seeded runs → byte-identical event logs
   ├─ pump/                         ── second experiment (§13.7) ──
   │  ├─ harness.ts                 the REAL stack via createPumpStack + an event log
   │  ├─ model.test.ts              physics, hysteresis level bits, dry-run guard, determinism
   │  ├─ params.test.ts             defaults, clamping, live-vs-on-reset, the separated end conditions
   │  ├─ paramsStorage.test.ts      write exact / read total; a corrupted payload still boots
   │  ├─ wiring.test.ts             the Anleitung's address map, coverage and uniqueness
   │  ├─ scan.test.ts               end-to-end scans driven by the manual's own snippets
   │  ├─ examples.test.ts           every pump example compiles against the pump symbol table
   │  ├─ shellSmoke.test.ts         headless end-to-end of the bootstrap path
   │  └─ scene/                     built-graph metrics: geometry, label placement, picking, orbit
   ├─ pedagogy/
   │  ├─ behaviorCheck.test.ts      event pattern matching, ordering, time windows, invariants
   │  └─ hints.test.ts              unlock gating; guard: no hint text contains plant operand names
   ├─ data/
   │  ├─ variables.test.ts          variables.json ↔ documented invariants (42 switches, R=G+6 bytes)
   │  ├─ trackplan.test.ts          schema validity, graph consistency, all wired reeds present
   │  └─ exercises.test.ts          schema validity, all referenced symbols/reeds/switches exist
   └─ oracle/                       ── TEST TIME ONLY, skipped cleanly if reference/Claude_work/ absent ──
      ├─ loadOracle.ts              fs read of reference/Claude_work/*.txt, existence check, describe.skip logic
      ├─ scenarioRunner.ts          headless full sim: emulator+plant+coordinator, event log capture
      ├─ expectations/
      │  ├─ gruppeA.json            expected event sequence (from Aufgabenstellung A, shippable text)
      │  └─ gruppeB.json            expected event sequence (from Aufgabenstellung B)
      ├─ gruppeA.oracle.test.ts     run solution A through sim, assert event sequence + timings
      ├─ gruppeB.oracle.test.ts     run solution B through sim, assert event sequence + timings
      ├─ exerciseChecks.oracle.test.ts  (added in integration, §9.4) every exercises.json BehaviorCheck passes for both solutions
      └─ no-bundle.test.ts          guard: src/ + committed docs/ free of solution content; dist/ clean (§9.4)
```

---

## 4. Module ownership (disjoint, for parallel agents)

| Agent | Owns (exclusive write access) | Depends on (read-only contracts) |
|---|---|---|
| **core** | `src/core/**`, `tests/core/**` | §5.1 interfaces only |
| **plant** | `src/plant/**`, `tests/plant/**` | `core` types (`BitAddress`), §5.3 |
| **scene** | `src/scene/**` | `plant` types (`PlantSnapshot`, `TrackplanFile`) |
| **ui-app** | `src/ui/**`, `src/app/**`, `src/main.ts`, `index.html`, root configs (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.eslintrc.cjs`), `public/` | all public APIs |
| **pedagogy** | `src/pedagogy/**`, `tests/pedagogy/**` | `SimEvent` union (pedagogy itself OWNS and exports `LocalizedText`; ui imports it — §5.5) |
| **data** | `src/data/**`, `tools/**`, `tests/data/**` | schemas in §7 (authoritative) |
| **tests-integration** | `tests/app/**`, `tests/oracle/**` | everything, via public APIs |

Sequencing: **ui-app** lands the root scaffolding (configs, empty module `index.ts` stubs
re-exporting the §5 types) first; all other agents then work in parallel against the §5
contracts. Cross-module type changes go through this file (edit §5, then implement).

---

## 5. Public TypeScript interfaces

These are the module contracts. Symbol names are binding; bodies are illustrative.
All are exported from the owning module's `index.ts`.

### 5.1 core/

#### 5.1.1 Address model (`core/address.ts`)

```ts
/** Bit-addressable areas: Eingänge, Ausgänge, Merker. */
export type BitArea = 'E' | 'A' | 'M';
/** Word areas (16 bit, big-endian: high byte at `byte`, low byte at `byte + 1`). */
export type WordArea = 'EW' | 'AW' | 'MW';

export interface BitAddress  { kind: 'bit';  area: BitArea;  byte: number; bit: number /* 0..7 */; }
export interface WordAddress { kind: 'word'; area: WordArea; byte: number; }
export interface TimerAddress   { kind: 'timer';   n: number; }   // T 0..127
export interface CounterAddress { kind: 'counter'; n: number; }   // Z 0..127
export type Address = BitAddress | WordAddress | TimerAddress | CounterAddress;

export interface BlockRef { kind: 'block'; blockType: 'FB' | 'FC' | 'DB' | 'OB' | 'UDT'; n: number; }

/** "M 100.4" | "M100.4" | "AW 6" | "T 10" | "Z 1" → Address; null if malformed. */
export function parseAddress(text: string): Address | null;
/** Canonical formatting: "M 100.4", "AW 6", "T 10", "Z 1". */
export function formatAddress(a: Address): string;
export function bitAddressEquals(a: BitAddress, b: BitAddress): boolean;
```

Memory bounds (M1): `E` bytes 0–15, `A` bytes 0–15 (AW 6 lives here), `M` bytes 0–255,
`T` 0–127, `Z` 0–127. Out-of-range operands are parse-time errors (`E-ADR-002`).

#### 5.1.2 Symbol table (`core/symbols.ts`)

```ts
export type S7DataType = 'BOOL' | 'BYTE' | 'WORD' | 'INT' | 'TIMER' | 'COUNTER' | 'BLOCK';

export interface SymbolEntry {
  symbol: string;                    // exact spelling incl. case, e.g. "XW03CR"
  target: Address | BlockRef;
  dataType: S7DataType;
  comment?: string;                  // German comment from Variablenliste
  commentEn?: string;                // English translation (optional)
}

export class SymbolTable {
  /** Build from parsed variables.json content (type in §7.2). */
  static fromVariables(doc: VariablesFile): SymbolTable;
  /** Case-SENSITIVE — "xW03CR" does NOT find "XW03CR". This is the practicum trap. */
  lookup(symbol: string): SymbolEntry | undefined;
  /** For diagnostics: entries whose lowercase form matches → "did you mean XW03CR?" */
  suggest(symbol: string): SymbolEntry[];
  byAddress(a: Address): SymbolEntry | undefined;   // reverse lookup (watch table, wiring)
  all(): readonly SymbolEntry[];
}
```

#### 5.1.3 S5TIME (`core/s5time.ts`)

16-bit S5TIME: bits 13–12 = time base (`0b00`=10 ms, `0b01`=100 ms, `0b10`=1 s,
`0b11`=10 s), bits 11–0 = BCD value 000–999. Range 10 ms … 9 990 s (2 h 46 min 30 s).

```ts
/** ms → S5TIME word. Picks the smallest base that fits; TRUNCATES ms toward zero to the
 *  chosen base's tick (STEP 7 semantics — non-multiples are cut off ("abgeschnitten"),
 *  never rounded up). 0..9 ms clamps to the 10 ms minimum. Throws RangeError above
 *  9_990_000 ms or below 0. */
export function encodeS5Time(ms: number): number;
export function decodeS5Time(word: number): number;              // → ms
/** "S5T#4S500MS", "S5T#300MS", "S5T#1H10M" (order H,M,S,MS; parts optional) → ms; null if malformed. */
export function parseS5TimeLiteral(text: string): number | null;
export function formatS5Time(ms: number): string;                // canonical "S5T#4S500MS"
```

#### 5.1.4 AST + instruction set (`core/ast.ts`)

```ts
/** Milestone-1 mnemonics — superset of everything used by the Gruppe A/B solutions. */
export type Mnemonic =
  | 'U' | 'UN' | 'O' | 'ON' | 'X' | 'XN'          // bit logic
  | '=' | 'S' | 'R'                                // assignment; S/R also on T (R), Z (S/R)
  | 'L' | 'T'                                      // load/transfer (VKE-neutral)
  | 'SI' | 'SV' | 'SE' | 'SS' | 'SA' | 'FR'        // S5 timers (FR also on Z)
  | 'FP' | 'FN'                                    // edge evaluation
  | 'ZV' | 'ZR'                                    // counters
  | '==I' | '<>I' | '>I' | '>=I' | '<I' | '<=I'    // integer compares
  | 'SPA' | 'SPB' | 'SPBN'                         // jumps
  | 'NOP';

export type Operand =
  | { kind: 'bit';     address: BitAddress;  symbol?: string }   // symbol = as written in source
  | { kind: 'word';    address: WordAddress; symbol?: string }
  | { kind: 'timer';   n: number }
  | { kind: 'counter'; n: number }
  | { kind: 'int';     value: number }                            // L 3   (signed 16-bit)
  | { kind: 's5time';  ms: number; raw: string }                  // L S5T#300MS
  | { kind: 'zaehler'; value: number; raw: string }               // L C#010 (BCD counter preset)
  | { kind: 'label';   name: string };                            // SPA M001

export interface Instruction {
  op: Mnemonic;
  operand?: Operand;
  label?: string;            // "M001:" prefix on this line (1–4 alphanumeric, starts with letter)
  line: number;              // 1-based source line
  col: number;
}

export interface NetworkMarker { line: number; index: number; title?: string; }

export interface Program {
  instructions: Instruction[];
  /** Informational only (cycle inspector grouping): derived from comment lines matching
   *  /^\/\/\s*(Netzwerk|Network)\s+(\d+)/i. Execution semantics ignore networks entirely —
   *  the program is one linear list, exactly like the real practicum txt upload. */
  networks: NetworkMarker[];
  labels: ReadonlyMap<string, number>;   // label name → instruction index
  source: string;
}
```

#### 5.1.4a Source normalizer (`core/template.ts`)

The practicum does not hand out an empty file: the students fill in a **course template**
(`Gruppe_A_Aufgabe_SS2026.txt`, `Gruppe_B_Aufgabe_SS2026.txt` — both committed and usable as
fixtures). Per network it carries a `_______` rule, a bare `Netzwerk n` header, German task
text, `Erreichbare Punktzahl: 2P`, the marker `--Bitte hier programmieren--`, then the AWL,
and closes with `Gesamt 27P`. Handing that straight to the tokenizer is hundreds of correct
but useless `E-LEX-001` errors, so ingest normalizes first:

```ts
export function detectTemplate(source: string): boolean;
export function normalizeSource(source: string): NormalizedSource;
export function mapDiagnostics(
  diagnostics: readonly Diagnostic[], lineMap: readonly number[],
): Diagnostic[];

export interface NormalizedSource {
  program: string;        // program sections only, with '// Netzwerk n' grouping comments
  isTemplate: boolean;
  lineMap: number[];      // lineMap[i] = 1-based ORIGINAL line of program line i + 1
  notes: TemplateNote[];  // structured facts; the localized text lives in ui/i18n
  stats: TemplateStats;   // networks, sections, programLines, ignoredLines, scaffoldLines
}
```

Rules:

- **Template mode** collects only the text after each marker, up to the next `_______` rule /
  `Gesamt` / EOF, and rewrites the bare `Netzwerk n` header into the parser's `// Netzwerk n`
  grouping comment (§5.1.4), anchored on the header's ORIGINAL line.
- **Plain AWL** keeps every line; only scaffolding a student pasted along (separator runs of
  ≥ 3 `= _ -`, bare `Netzwerk n` headers, `Erreichbare Punktzahl: nP`, `Gesamt nP`, the marker
  itself) is neutralized, so none of it can produce a lexer error. The line map is then the
  identity. Everything else stays strict — an unknown token inside real AWL is still
  `E-LEX-001`.
- **Plain-AWL fallback** (guarded): when template mode extracts NOTHING
  (`stats.programLines === 0` — the student typed over the markers, deleted them, or pasted
  only the middle of the file) **and** the ignored text is predominantly instruction-shaped
  (`notes.length > 0 && notes.length * 2 >= stats.ignoredLines`), the extraction is re-run in
  plain-AWL mode so an essentially-AWL buffer still compiles. Otherwise template mode STAYS in
  force and every stray line is reported as `W-TPL-001`. The ratio guard is load-bearing: a
  real course template with its markers typed over holds ~20 instruction lines against ~98
  lines of German task text, and recompiling that whole buffer would reproduce the very
  `E-LEX-001` flood this step exists to remove.
- **`lineMap` is load-bearing**: `mapDiagnostics` re-anchors every parser diagnostic onto the
  line the student sees, which is what the editor gutter and the message list show. The editor
  buffer is never rewritten. Runtime diagnostics pass through `ui/templateNotice`'s
  `mapRuntimeDiagnostics`, which re-anchors only the codes that carry a program position
  (`R-RUN-001`, `R-RUN-002`); the position-less UI-raised ones (`W-SWI-001`, `R-RUN-000`) keep
  line 1 rather than being given a fabricated position inside the student's task text.
- **Safety net** (pedagogically essential): an ignored line whose first word is within edit
  distance 1 of an M1 mnemonic **and** whose remainder is an AWL-shaped operand (quoted
  symbol, `E/A/M n.n`, `T nn`, `Z n`, `S5T#…`, `C#…`, integer, jump label) yields a
  `strayInstruction` note → `W-TPL-001`. Both halves must agree: the task text is full of
  quoted symbols and of addresses like `E 1.7`, so either test alone flags ordinary prose.
  Prose is counted (`stats.ignoredLines`), never flagged line by line. Refinements that keep
  code from being swallowed silently without letting prose in:
  - a leading label definition (`M001:`) is stripped before the head token is picked, so the
    valid form `M001: U "xR01A"` is tested as an instruction instead of as a label; a bare
    `M001:` counts as a stray on its own;
  - a trailing `;`/`.`/`:` no longer bails out before the mnemonic test — a line ending like a
    sentence is kept when (and only when) its head is an **exact** mnemonic, so `U "xR01A";`
    is code while `Not-Aus HALT!` and `Anmerkungen:` stay prose;
  - a bare unquoted word is accepted as the sole operand behind an **exact** mnemonic only
    (`U xR01A`), never behind a fuzzy head (`zu stellen` stays quiet);
  - fuzzy head matching skips German function words (`und`, `an`, `so`, `zu`, `mit`, …), which
    are within distance 1 of `UN`/`ON`/`S`/`ZV` but never of an exact mnemonic.
- `normalizeSource` is idempotent on its own output, and `ast.ts` owns the mnemonic list
  (`MNEMONICS` / `WORD_MNEMONICS`) that both the parser and the safety net read.

The extraction previously existed ONLY in test code (`tests/oracle/loadOracle.ts`), which is
precisely why the product could not ingest its own course format; that loader now delegates
here (verified byte-identical on both local solution files before the switch).

#### 5.1.5 Diagnostics (`core/diagnostics.ts`)

```ts
export type Severity = 'error' | 'warning' | 'info';
export interface Diagnostic {
  code: string;                       // registry below
  severity: Severity;
  line: number; col: number; length?: number;
  message: { de: string; en: string };
  hint?:   { de: string; en: string };   // e.g. suggestion for case-mismatch
}
```

Code registry (extend, never renumber):

| Code | Severity | Meaning (EN) / Bedeutung (DE) |
|---|---|---|
| `E-LEX-001` | error | Unknown token / Unbekanntes Zeichen |
| `E-LEX-002` | error | Unterminated quoted symbol / Nicht geschlossener Symbolname |
| `E-SYN-001` | error | Unknown instruction / Unbekannte Anweisung |
| `E-SYN-002` | error | Missing/extra operand for instruction / Fehlender oder überzähliger Operand |
| `E-SYN-003` | error | Malformed literal (S5T#, C#, int) / Fehlerhafte Konstante |
| `E-ADR-001` | error | Malformed address / Fehlerhafte Adresse |
| `E-ADR-002` | error | Address out of range / Adresse außerhalb des Bereichs |
| `E-SYM-001` | error | Unknown symbol / Unbekanntes Symbol |
| `E-SYM-002` | error | Case mismatch, with suggestion ("Meinten Sie \"XW03CR\"?") |
| `E-TYP-001` | error | Operand type not valid for instruction / Operandtyp passt nicht zur Anweisung |
| `E-JMP-001` | error | Unknown jump label / Unbekannte Sprungmarke |
| `E-JMP-002` | error | Duplicate label / Doppelte Sprungmarke |
| `W-LOG-001` | warning | Assignment with never-set VKE (dead store after string end) |
| `W-TIM-001` | warning | Timer started without preceding L S5T# in same string / Timerstart ohne Zeitwert |
| `W-RES-001` | warning | Write target outside the allowed resource whitelist (see below) / Schreibziel außerhalb der erlaubten Ressourcen |
| `W-SWI-001` | warning (runtime, **UI-raised**) | Coil command to a switch that is not placed on this board model (§7.1 `unplacedSwitches`) / Spulenbefehl an eine auf diesem Anlagenmodell nicht vorhandene Weiche. Not produced by `core/`: the coordinator records the structured fact (`SimCoordinator.unplacedCoilCommands`, §5.2), `main.ts` renders it through `ui/i18n` (§5.6) — so the message catalog stays in the layer that owns UI strings |
| `I-TPL-001` | info (ingest, **UI-raised**) | Summary of what the source normalizer did to the loaded buffer (§5.1.4a): template detected, networks found, instructions compiled, task-text lines ignored / Zusammenfassung der Vorlagen-Erkennung. Not produced by `core/`: `core/template.ts` returns structured counts, `ui/templateNotice.ts` renders them through `ui/i18n` (§5.6) — same split as `W-SWI-001` |
| `W-TPL-001` | warning (ingest, **UI-raised**) | A line OUTSIDE a `--Bitte hier programmieren--` section looks like an instruction and was not loaded (§5.1.4a safety net) / Zeile sieht wie eine Anweisung aus, liegt aber außerhalb eines Programmabschnitts. Never a silent drop |
| `R-RUN-000` | error (runtime, **UI-raised**) | Bootstrap/command failure surfaced in the message list (`main.ts#runtimeDiagnostic`); carries the caught error text in both languages |
| `R-RUN-001` | error (runtime) | Accu1 does not hold a valid S5TIME on timer start |
| `R-RUN-002` | error (runtime) | Instruction budget exceeded: > 10 000 instructions in one scan (runaway-loop guard) / Anweisungsbudget überschritten (Endlosschleifen-Schutz) |

`W-RES-001` is pedagogy-critical: it is how the simulator teaches the real practicum's
resource discipline without hard-failing. It is a **whitelist over write targets** (`=`,
`S`, `R` on bits, `FP`/`FN` edge operands, timer starts and `R T`, `ZV`/`ZR`/`S Z`/`R Z`,
`T` transfers). Every CORRECT program must write the plant interface addresses — those
never warn. Allowed write targets:

- `M 10.0` – `M 20.0` — student Merker area;
- `M 100.0` – `M 111.7` — switch coils (written with `=`);
- `M 120.0` – `M 120.6` — speed bits + STOP (written with `S`/`R`);
- `M 121.0` — NotausNF edge operand (`FP` physically writes its edge operand);
- `T 10` – `T 20` and `Z 1` (the student timer/counter range, §10.4).

Warn ONLY on writes outside this list: any `E` address, any other `M` byte (e.g. `M 0.x`,
`M 130.0`), `T` outside T10–T20, `Z` outside Z 1. A solution-shaped program (`=` on
coils, `S`/`R` on M 120.x, `FP M 121.0`) must produce **zero** W-RES-001 warnings —
pinned by a dedicated test case in `parser.test.ts` (§9.1).

The whitelist above is the RAILWAY's — it is course content, not emulator semantics, so it
lives in a `ResourcePolicy` handed to the `Emulator` (railway = default). The pump
experiment (§13) supplies `PUMP_RESOURCE_POLICY` (`src/pump/wiring.ts`): the Anleitung's
own pump snippets write `A 0.1`, `M 0.0` and `T 1`, and what the manual demonstrates
cannot warn on the plant it was written for (user report 2026-08-01; pinned by
`tests/pump/resourcePolicy.test.ts` — every pump-visible example loads warning-free, the
railway default still warns for the same operands).

#### 5.1.6 Memory / process image (`core/memory.ts`)

```ts
export class MemoryAreas {
  readonly inputs:  Uint8Array;   // E  0..15  — process image of inputs (PAE)
  readonly outputs: Uint8Array;   // A  0..15  — process image of outputs (PAA), AW 6 here
  readonly flags:   Uint8Array;   // M  0..255 — Merker (incl. switch coils M100–111, speeds M120)
  getBit(a: BitAddress): boolean;
  setBit(a: BitAddress, v: boolean): void;
  getWord(a: WordAddress): number;          // unsigned 0..0xFFFF, big-endian byte pair
  setWord(a: WordAddress, v: number): void;
  reset(): void;                            // all zero
}
```

Process image semantics: the **coordinator** writes physical input states into `inputs`
*before* calling `Emulator.step()` (that write is the PAE latch) and reads `outputs` +
relevant `flags` *after* the scan (PAA + wired Merker). The emulator itself performs no I/O.

#### 5.1.7 Emulator (`core/emulator.ts`)

```ts
export interface LoadResult { ok: boolean; diagnostics: Diagnostic[]; program?: Program; }

export interface StatusView { vke: boolean; erab: boolean; accu1: number; accu2: number; }
export interface TimerView {
  n: number; kind?: 'SI' | 'SV' | 'SE' | 'SS' | 'SA';
  q: boolean; running: boolean; remainingMs: number; presetMs: number;
}
export interface CounterView { n: number; value: number /* 0..999 */; q: boolean /* value ≠ 0 */; }
export interface TraceEntry { instrIndex: number; line: number; statusAfter: StatusView; }
export interface ScanResult { cycle: number; diagnostics: Diagnostic[]; trace?: TraceEntry[]; }

export class Emulator {
  constructor(symbols: SymbolTable);
  /** Parse + static checks. On error keeps the previously loaded program (if any). */
  load(source: string): LoadResult;
  /** Clear memory, timers, counters, edge memories, cycle counter. Keeps program. */
  reset(): void;
  /** Execute exactly ONE scan cycle. dtMs = simulated time elapsed since the previous scan;
   *  running timers advance by dtMs BEFORE the program executes. Set trace=true to record
   *  a per-instruction TraceEntry list (cycle inspector, M2). */
  step(dtMs: number, trace?: boolean): ScanResult;

  // ── inspection (read-only views; UI/watch table) ─────────────────────────
  readonly memory: MemoryAreas;
  readonly cycleCount: number;
  getStatus(): StatusView;
  getTimer(n: number): TimerView;
  getCounter(n: number): CounterView;
  peekBit(ref: string | BitAddress): boolean;      // symbol name or address
  peekWord(ref: string | WordAddress): number;

  // ── peripheral side (coordinator only — not for UI) ──────────────────────
  setInputBit(a: BitAddress, v: boolean): void;    // write into PAE before step()
  hasProgram(): boolean;
}
```

#### 5.1.8 Execution semantics (binding spec for `core/exec.ts`)

Status model: `VKE` (RLO) + `ERAB` (Erstabfrage/first-check flag, true while inside a logic
string) + two 32-bit accus.

| Instruction | Semantics |
|---|---|
| `U/UN/O/ON/X/XN <bit\|T\|Z>` | `v` = operand state (T→timer Q, Z→value≠0), negated for `*N`. If `ERAB=false`: `VKE ← v` (for `UN`/`ON`/`XN`: `¬v`), `ERAB ← true`. Else `VKE ← VKE ∧ v` (U), `∨` (O), `⊻` (X). M1 has no nesting/brackets and no operand-less `O`. |
| `=` | Writes `VKE` to bit operand **every cycle**. `ERAB ← false`. VKE preserved. |
| `S` / `R` on bit | Only if `VKE=1`: set/clear operand. `VKE=0` → **no-op**. `ERAB ← false`. |
| `R T n` | If `VKE=1`: timer n → stopped, Q=0, remaining=0. `ERAB ← false`. |
| `S Z n` | On rising edge of VKE (per-counter edge memory): counter ← BCD preset from accu1 (`C#…`). `ERAB ← false`. |
| `R Z n` | If `VKE=1` (level): counter ← 0. `ERAB ← false`. |
| `L <src>` | accu2 ← accu1; accu1 ← value (int literal sign-extended 16→32, `S5T#` encoded word, `C#` BCD, `T n` current time value, `Z n` current count). **VKE and ERAB unchanged** (VKE-neutral). |
| `T <dst>` | dst ← accu1 low word (AW/MW/EW). VKE-neutral. |
| `SI/SV/SE/SS/SA T n` | Timer start. Uses per-timer stored previous start-VKE for edge detection; preset ← `decodeS5Time(accu1)` at start edge (invalid → `R-RUN-001`). `ERAB ← false`. Per-type behavior in table below. |
| `FR T n` / `FR Z n` | On rising edge of VKE: clears the timer's/counter's internal edge memory (allows restart without a new input edge). `ERAB ← false`. Rarely used; parsed + implemented minimally. |
| `FP <bit>` / `FN <bit>` | Edge evaluation *inside* the string: `result = (stored=0 ∧ VKE=1)` for FP, `(stored=1 ∧ VKE=0)` for FN, where `stored` = value of the edge-operand bit. Then operand ← VKE, `VKE ← result`. **ERAB stays true** — the string continues (`U "xR01D" / FP M11.0 / UN T14 / = M11.1` must work). |
| `ZV Z n` / `ZR Z n` | On rising edge of VKE (separate edge memories for ZV and ZR per counter): value ±1, saturating at 0/999. The new value is visible to `L Z n` **in the same cycle** (Gruppe A/B NW 3 relies on it). `ERAB ← false`. |
| `==I <>I >I >=I <I <=I` | Compare accu2 vs accu1 as **signed 16-bit INT** (low words). `VKE ← result` (replaces VKE), `ERAB ← true` — a following `U` chains with AND (`L Z1 / L 3 / <I / U "xR01BH1G1"`). Accus unchanged. |
| `SPA lbl` | Unconditional jump. VKE/ERAB unchanged. |
| `SPB lbl` | If `VKE=1`: jump. In both cases afterwards `VKE ← 1`, `ERAB ← false` (per S7-300 STL manual). |
| `SPBN lbl` | If `VKE=0`: jump. Afterwards `VKE ← 1`, `ERAB ← false`. |
| `NOP 0` | No effect (label anchor). |

S5 timer types (`core/timers.ts`), state per timer
`{ kind, presetMs, remainingMs, running, q, latched, prevStartVke }`:

| Type | Start edge (VKE 0→1) | While running | VKE falls (1→0) | On expiry | Retrigger (new 0→1 during run) |
|---|---|---|---|---|---|
| `SI` Impuls | start; Q=1 | Q=1 | **Q=0, timer stops** | Q=0 | restart |
| `SV` verlängerter Impuls | start; Q=1 | Q=1 regardless of VKE | no effect | Q=0 | **restart from full preset** |
| `SE` Einschaltverzögerung | start; Q=0 | Q=0 | **abort, Q=0** | Q=1 iff VKE still 1; Q follows VKE afterwards (falls with VKE) | restart |
| `SS` speichernde EV | start; Q=0 | Q=0 | no effect | **Q=1 latched** until `R T n` | restart from full preset |
| `SA` Ausschaltverzögerung | — (VKE=1 ⇒ Q=1 immediately, timer cleared) | Q=1 | **start timer**, Q stays 1 | Q=0 | VKE returns to 1 during run → timer cleared, Q stays 1 |

Timer advancement happens once per `step(dtMs)` **before** program execution; expiry
timestamps are exact in simulated time, observed at the next scan. `R T n` clears Q,
remaining and the SS latch.

### 5.2 app/ (coordination layer)

```ts
// app/SimClock.ts
export class SimClock {
  readonly physicsStepMs: 10;                 // fixed
  timeScale: number;                          // 0 (paused) … 8 — SimClock is the SOLE owner of time scaling
  /** Feed RAW real elapsed ms (unscaled — SimClock applies timeScale internally);
   *  returns how many whole physics steps to run now. */
  accumulate(realDtMs: number): number;
  readonly simTimeMs: number;                 // integer, advances only in 10 ms steps
  reset(): void;
}

// app/Wiring.ts — binds symbolic world to plant ids. Built once at startup, validated.
export interface Wiring {
  /** reedId ("xR01A") → E-address of its input, for the 23 wired reeds. */
  reedInput: ReadonlyMap<string, BitAddress>;
  /** switchId ("xW02D") → { G: M-address, R: M-address } of its coil bits. */
  switchCoils: ReadonlyMap<string, { G: BitAddress; R: BitAddress }>;
  /** switchId → coil bits of the switches the Variablenliste commands but this board model
   *  does not have (trackplan `unplacedSwitches`, §7.1). They drive nothing; the coordinator
   *  watches them so a pulse yields W-SWI-001 instead of a silent no-op. Built tolerantly:
   *  an unplaced switch without both coil symbols is skipped, not an error. */
  unplacedCoils: ReadonlyMap<string, { G: BitAddress; R: BitAddress }>;
  notausInput: BitAddress;                    // E 1.7
  fahrstromWord: WordAddress;                 // AW 6
  speedBits: { stop: BitAddress; s1iu: BitAddress; s2iu: BitAddress; s3iu: BitAddress;
               s1gu: BitAddress; s2gu: BitAddress; s3gu: BitAddress };  // M 120.x
}
export function buildWiring(symbols: SymbolTable, plan: TrackplanFile): Wiring; // throws on mismatch; switches with coilToBranch: null (§5.3) are skipped, not errors

/** May the §10.3 "Try it" mini-mode force this bit? Every E bit EXCEPT `notausInput`, which
 *  has its own latching button. Wired reed inputs are deliberately included: on this board
 *  every bit of E 0 – E 2 is a reed input or Notaus, while the Anleitung example snippets
 *  address exactly those bytes — a "non-reed bits only" rule would leave the mini-mode with
 *  nothing to toggle. The force mask below is what keeps that safe. */
export function isForcibleInput(wiring: Wiring, address: BitAddress): boolean;
/** The forcible E bits a loaded Program addresses — deduplicated, in address order. The
 *  ControlPanel renders one toggle per entry, so a plant program shows none. */
export function forcibleProgramInputs(wiring: Wiring, program: Program): BitAddress[];

// app/EventBus.ts
export type Unsubscribe = () => void;
export class EventBus {
  emit(e: SimEvent): void;
  on(cb: (e: SimEvent) => void): Unsubscribe;
}

// app/SimCoordinator.ts
export interface CoordinatorConfig {
  scanIntervalMs?: number;      // default 50; allowed 10..200, multiple of physicsStepMs (10)
  seed?: number;                // plant PRNG seed, default 1
  trace?: boolean;              // per-instruction trace (M2 cycle inspector)
}
export class SimCoordinator {
  constructor(emulator: Emulator, plant: Plant, wiring: Wiring, bus: EventBus,
              cfg?: CoordinatorConfig);
  /** Advance simulation by n physics steps (n*10 ms simulated). Deterministic. */
  advanceSteps(n: number): void;
  /** Deterministic stimulus playback for check runs and record/replay (§5.5
   *  ScenarioAction, §6.3): each action is applied immediately before the first physics
   *  step whose post-step simTimeMs is ≥ atMs (notaus → plant.setNotaus). Cleared by
   *  reset(). */
  loadScenario(actions: readonly ScenarioAction[]): void;
  setScanInterval(ms: number): void;
  reset(): void;                              // emulator.reset + plant.reset + clock 0 + force mask + W-SWI-001 record
  snapshot(): PlantSnapshot;                  // pass-through of plant.snapshot()
  /** §10.3 "Try it" input forcing. `true` writes the bit AND registers it in the force mask,
   *  which step 2a' below re-asserts after every peripheral PAE write; `false` releases the
   *  force and clears the bit (a wired reed input thereby returns to the plant). Returns
   *  false, writing nothing, unless `isForcibleInput` accepts the address. */
  forceInputBit(address: BitAddress, value: boolean): boolean;
  clearForcedInputs(): void;
  isInputForced(address: BitAddress): boolean;
  /** Coil commands that went to switches this board model does not have (§7.1) — recorded
   *  ONCE per coil, not per scan, so the UI warns once per program run (W-SWI-001). */
  readonly unplacedCoilCommands: readonly { switchId: string; coil: 'G' | 'R' }[];
  clearUnplacedCoilCommands(): void;          // called by the UI when a program is loaded
  /** Most recent ScanResult — DiagnosticsPanel polls this for runtime diagnostics
   *  (R-RUN-001/002); those are NOT SimEvents (§6.3). */
  readonly lastScan: ScanResult | null;
  readonly simTimeMs: number;
}
```

Coordinator loop, executed inside `advanceSteps` for each 10 ms physics step
(**this ordering is binding** — determinism and the oracle depend on it):

1. Apply due scenario actions (`loadScenario`, §5.5 `ScenarioAction`), then
   `plant.step(10)` — physics: train motion, switch actuation timers, reed closure
   sampling. After the step for physics step k (k = 0, 1, …), `simTimeMs = (k + 1) · 10`.
2. If `simTimeMs % scanIntervalMs === 0` — the scan phase is pinned POST-step: the first
   scan runs at t = scanIntervalMs, never at t = 0 before any physics. Every oracle
   timestamp depends on this; `coordinator.test.ts` encodes it (§9.3). Then:
   a. **PAE write**: for each wired reed, `emulator.setInputBit(addr, plant.consumeReedLatch(id))`;
      `emulator.setInputBit(E1.7, !plant.notausActive)`.
   a′. **Forced inputs win**: every entry of the §10.3 force mask is re-asserted *after* step a
      (insertion order, deterministic). The reed latches are still consumed in a, so the plant
      evolves identically whether an input is forced or not; an empty mask — every check run,
      every oracle run — leaves the loop byte-identical to the pre-forcing behaviour.
   b. `emulator.step(scanIntervalMs)` — one full PLC scan.
   c. **Actuator read** (simulates system blocks FB1/FB2):
      - FB2 sim: for each switch, read coil bits from `emulator.memory.flags` → `plant.setSwitchCoil(id, 'G'|'R', level)`.
      - Unplaced switches (§7.1): nothing to ferry — a high coil bit is recorded once per coil
        in `unplacedCoilCommands` (W-SWI-001).
      - FB1 sim: read M120 speed bits → `word = fahrstrom.bitsToWord(m120)` →
        write `AW 6` back into `emulator.memory` (so students can watch it) →
        `plant.setFahrstromWord(word)`; if > 1 M120 bit is set, the coordinator queues a
        `speedConflict` event (emitted in step 3 — `bitsToWord` itself stays pure).
3. Emit accumulated events to the `EventBus` in deterministic order: plant events first
   (sorted by (timeMs, stable index)), then coordinator-emitted events (`speedConflict`
   from step 2c). M1 has NO emulator-derived SimEvents — runtime diagnostics
   (R-RUN-001/002) travel exclusively via `ScanResult.diagnostics`, exposed to the UI
   through `coordinator.lastScan`.

`RafDriver` (browser only): `requestAnimationFrame` → `clock.accumulate(realDt)` (RAW
real ms — `SimClock` alone applies `timeScale`; the driver never pre-scales, otherwise
scaling would be applied twice)
→ `coordinator.advanceSteps(n)` → `scene.update(coordinator.snapshot(), interpAlpha)`.
Head­less (tests): call `advanceSteps` directly. **No wall-clock anywhere below app/.**

### 5.3 plant/

```ts
// plant/types.ts
export interface Vec2 { x: number; y: number; }

export interface TrackNodeSpec { id: string; pt: Vec2; kind: 'plain' | 'switch' | 'buffer'; }
export interface TrackEdgeSpec {
  id: string;
  from: string; to: string;          // node ids
  pts: Vec2[];                       // polyline in plan units, incl. both endpoints
  /** Orientation convention (DATA, not physics — §8): from→to is the direction the
   *  documented IU route walks pass this edge. The Train derives its per-edge travel
   *  sign from node-transition continuity, never from a global command↔geometry rule. */
}
export interface SwitchSpec {
  id: string;                        // base name without coil suffix, e.g. "xW02BH1G4"
  nodeId: string;
  toeEdgeId: string;                 // single edge on the facing side
  branchEdgeIds: [string, string];   // the two diverging edges; index = SwitchPosition
  /** Which coil throws to which branch index. `null` = non-commandable switch (no
   *  Variablenliste symbols — only the unlabeled "(xW)"): fixed at initialPosition
   *  ("fest liegend" per weichen_video.md), excluded from Wiring (§5.2) and from the
   *  42-switch/84-coil-bit invariants (§7.2); trailing it still follows the normal
   *  switch rules. */
  coilToBranch: { G: 0 | 1; R: 0 | 1 } | null;
  mappingSource: 'derived' | 'assumed';        // §8
  mappingEvidence?: string;          // e.g. "A-NW5: route BH2 via G3 ⇒ R = branch to G3"
  initialPosition: 0 | 1;
}
export interface ReedSpec {
  id: string;                        // "xR01A"
  edgeId: string; offsetMm: number;  // along edge from its 'from' node
  wired: boolean;                    // only 23 of 43 reed positions have an E input
  bounce?: boolean;                  // participates in debounce exercise (xR01D)
}
export interface TrackplanFile { /* full schema §7.1; parsed shape of trackplan.json */ }

// plant/train.ts
export interface TrainState {
  edgeId: string;
  offsetMm: number;                  // 0..edge length, measured from edge.from
  /** Travel sign RELATIVE to the current edge's from→to orientation. Owned by the Train
   *  and re-derived at every node transition from geometric continuity — NOT a global
   *  IU/GU mapping (§8: commands are decoupled from geometry). */
  direction: 1 | -1;
  command: 'IU' | 'GU' | 'STOP';     // last traction command driving the motion
  speedMmS: number;                  // current magnitude ≥ 0 (first-order lag toward target)
  targetSpeedMmS: number;
}

// plant/switches.ts
export type SwitchPosition = 0 | 1;  // index into branchEdgeIds
export interface SwitchState {
  id: string;
  position: SwitchPosition;
  moving: boolean;
  movingToward?: SwitchPosition;
  remainingMs?: number;              // of the 300 ms actuation
  coilG: boolean; coilR: boolean;    // current commanded coil levels
}

// plant/reeds.ts
export interface ReedState {
  id: string;
  closed: boolean;                   // instantaneous (magnet inside window / bounce pattern)
  latched: boolean;                  // closed at any physics step since last consume
}

// plant/fahrstrom.ts
export interface FahrstromState { word: number; level: 0 | 1 | 2 | 3; direction: 'IU' | 'GU' | 'STOP'; }
/** FB1 simulation: M120 byte → AW6 word. Priority when multiple bits set (ASSUMPTION,
 *  §12): STOP > Speed1IU > Speed2IU > Speed3IU > Speed1GU > Speed2GU > Speed3GU. The
 *  'speedConflict' warning event is emitted by the SimCoordinator during its FB1 sim
 *  step (§5.2 step 2c) whenever >1 bit is set — bitsToWord itself is pure. */
export function bitsToWord(m120Byte: number): number;
/** AW6 encoding (our definition — real value unknown, §12): 0 = stop;
 *  low byte = level 1..3; bit 8 set = GU. Returns the COMMAND, not a geometric sign —
 *  the Train maps command → per-edge travel sign at node transitions (§8). */
export function wordToTarget(aw6: number, meta: TrackplanMeta): { speedMmS: number; command: 'IU' | 'GU' | 'STOP' };

// plant/plant.ts
export interface PlantConfig {
  trackplan: TrackplanFile;
  seed?: number;                     // PRNG for bounce; default 1
  bounceEnabled?: boolean;           // default false; true for the Entprellen exercise/oracle A
  strictDerail?: boolean;            // default false: trailing a switch = warning, not derail
}

export interface PlantSnapshot {
  timeMs: number;
  train: TrainState & { worldPos: Vec2; headingRad: number };
  switches: SwitchState[];           // stable order = trackplan order
  reeds: ReedState[];
  fahrstrom: FahrstromState;
  notausActive: boolean;
  derailed: boolean;
}

export class Plant {
  constructor(cfg: PlantConfig);
  step(dtMs: number): void;                    // fixed-step physics; deterministic
  // actuator side (coordinator):
  setSwitchCoil(switchId: string, coil: 'G' | 'R', level: boolean): void;
  setFahrstromWord(aw6: number): void;
  setNotaus(active: boolean): void;            // UI Notaus button (latching toggle)
  // sensor side (coordinator):
  consumeReedLatch(reedId: string): boolean;   // returns latched, then clears latch
  readonly notausActive: boolean;
  // state:
  snapshot(): PlantSnapshot;
  drainEvents(): SimEvent[];                   // events since last drain, chronological
  reset(): void;                               // train to start pos, switches to initial, PRNG reseed
}
```

Plant behavior rules (binding):

- **Switch actuation**: rising edge on a coil starts a 300 ms actuation toward
  `branchEdgeIds[coilToBranch[coil]]` (value `switchActuationMs` from trackplan meta). At
  completion, `position` changes and `switchMoved` is emitted. A rising edge on the *other*
  coil during actuation restarts actuation toward the other branch. Both coils high →
  `coilConflict` warning event; actuation continues toward the most recent edge. Actuation
  while the train occupies the switch node → `switchMovedUnderTrain` warning
  (+ `derail` and train stop if `strictDerail`).
- **Coil pulse measurement**: the plant measures each coil's high-time and emits
  `switchPulse {durationMs}` on the falling edge (used by behavior checks: "≈300 ms, not
  permanent"). A coil held > 5 s emits `coilHeld` warning (teaches the `=`-with-SV rule).
- **Reed closure**: instantaneous `closed` = magnet center within `windowMm/2` of the reed
  position (magnet is at loco center). `latched` = OR of `closed` over all physics steps
  since last consume — guarantees a scan never misses a crossing (models input electronics
  latch; deterministic).
- **Bounce** (only if `bounceEnabled` and `reed.bounce`): on window entry, the closure
  signal follows a seeded pattern: 2–4 alternating closed/open bursts of 10–30 ms in the
  first 100 ms, then solid closed until window exit. Because the reed latch ORs closures
  between consumes, those sub-scan bursts are INVISIBLE to the PLC at the default 50 ms
  scan (§12 #9) — so the pattern additionally guarantees one PLC-visible re-closure:
  250–400 ms after window exit (seeded within that range) the reed closes again for
  150 ms, with the open gap and the re-closure each ≥ 2× the default scan interval.
  Every program therefore sees a second rising edge on the input; an un-debounced
  program double-triggers, which is what the A-NW8 Entprellen check detects (a `never`
  pattern: no second route action — switchPulse/speedCommand — within the debounce
  lockout window after the first `reedClosed` of the bounce reed). All values drawn from
  the seeded PRNG (`random.ts`) — reproducible per seed.
- **Train motion**: `speedMmS` approaches `targetSpeedMmS` with constant acceleration
  `meta.trainAccelMmS2` (default 150 mm/s²) — the train glides past reeds, reproducing the
  "kein zielgenaues Bremsen" behavior including multiple crossings while stopping.
  Direction change requires passing through speed 0. At a node, the next edge is chosen:
  plain node → the unique other edge; switch node from toe side → current
  `position` branch; from branch side → toe edge, with `switchTrailed` warning if the
  position does not match the branch being left (`derail` in strict mode). Buffer node →
  hard stop + `bufferHit` event.
- **Notaus**: `setNotaus(true)` ⇒ E 1.7 reads 0 (drahtbruchsicher, 0-active). The plant
  itself does NOT stop the train — the *student program* must (that is exercise NW 1).

```ts
// SimEvent union (plant/index.ts re-exported by app/) — the currency of the oracle
// and of pedagogy behavior checks. Times are simulated ms.
export type SimEvent =
  | { t: number; type: 'speedCommand'; level: 0 | 1 | 2 | 3; direction: 'IU' | 'GU' | 'STOP'; word: number }
  | { t: number; type: 'speedConflict'; m120: number }
  | { t: number; type: 'switchPulse'; switchId: string; coil: 'G' | 'R'; durationMs: number }
  | { t: number; type: 'switchMoved'; switchId: string; position: SwitchPosition }
  | { t: number; type: 'coilConflict'; switchId: string }
  | { t: number; type: 'coilHeld'; switchId: string; coil: 'G' | 'R'; heldMs: number }
  | { t: number; type: 'switchTrailed'; switchId: string }
  | { t: number; type: 'switchMovedUnderTrain'; switchId: string }
  | { t: number; type: 'reedClosed'; reedId: string }               // rising edge of closed
  | { t: number; type: 'trainStopped' }
  | { t: number; type: 'trainStarted'; direction: 'IU' | 'GU' }
  | { t: number; type: 'segmentEntered'; edgeId: string }
  | { t: number; type: 'bufferHit'; nodeId: string }
  | { t: number; type: 'derail'; switchId?: string }
  | { t: number; type: 'notaus'; active: boolean };
```

### 5.4 scene/

```ts
export type CameraMode = 'orbit' | 'bird' | 'cab' | 'trackside';

export interface SceneConfig {
  canvas: HTMLCanvasElement;
  trackplan: TrackplanFile;
  quality?: 'low' | 'high';          // low: no shadows/decor detail (weak GPUs)
}

export class SceneManager {
  constructor(cfg: SceneConfig);
  /** Apply a plant snapshot. alphaMs = real-time ms since the snapshot's sim step, used to
   *  interpolate the train pose between fixed steps (scene-side smoothing only — never
   *  feeds back into plant). */
  update(snapshot: PlantSnapshot, alphaMs: number): void;
  render(): void;
  setCameraMode(m: CameraMode): void;
  getCameraMode(): CameraMode;
  setLabelsVisible(v: boolean): void;                    // white xW…/xR… label sprites
  highlight(kind: 'switch' | 'reed', id: string | null): void;   // UI hover/selection glow
  resize(width: number, height: number): void;
  dispose(): void;
}
```

Scene notes (from `video_design.md`, decorative accuracy is approximate by design):
TT-scale look; loco = dark-red BR119-like body + 2 red/white coaches; grey switch motors
beside the track with white labels; reeds = small glass tubes between the sleepers; MFD
mountains with tunnel portals over the Gleis C/K area (train hidden inside tunnel edges
flagged `tunnel: true`), Badesee with island, Lokschuppen, station buildings, lookout tower.
Camera rigs: `orbit` (OrbitControls, default), `bird` (top-down orthographic),
`cab` (attached to loco front, looks along heading), `trackside` (nearest of 4 fixed
tripods, auto-switching to the one closest to the train).

### 5.5 pedagogy/

```ts
/** OWNED by pedagogy (single declaration in the codebase); ui/i18n imports it for lt()
 *  (§5.6). The §4 table's dependency cell reflects this direction: ui → pedagogy. */
export interface LocalizedText { de: string; en: string; }

export interface HintSpec {
  level: 1 | 2 | 3;
  /** 1 = concept pointer (names the concept + Anleitung/Hinweise section),
   *  2 = generic pattern with NEUTRAL operands (E 0.0, M 10.x, T 1x — never plant symbols),
   *  3 = checklist / common-pitfall list for this network type.
   *  NEVER task operands, never a complete task solution. */
  title: LocalizedText;
  body: LocalizedText;               // markdown-lite: paragraphs + fenced awl blocks
  /** Citation into the German-only Anleitung. `section` is the manual's numbering;
   *  `label` is the localized display text so default-locale (EN) users get a
   *  translated reference, e.g. { de: "Anleitung IV.2.6.4 (SS)",
   *  en: "Manual IV.2.6.4 (retentive on-delay, SS)" }. */
  anleitungRef?: { section: string; label: LocalizedText };
  exampleId?: string;                // link into examples library
}

export interface EventPattern {
  type: SimEvent['type'];
  switchId?: string; coil?: 'G' | 'R';
  reedId?: string;
  nodeId?: string; edgeId?: string;                  // bufferHit / segmentEntered payloads
  /** notaus payload constraint — WITHOUT it, {type:'notaus'} matches both the press
   *  (active:true) and the release (active:false). Checks almost always want it pinned. */
  active?: boolean;
  level?: 0 | 1 | 2 | 3; direction?: 'IU' | 'GU' | 'STOP';
  minDurationMs?: number; maxDurationMs?: number;    // for switchPulse / stop durations
}
// Matching rule: every field present must strictly equal the event's payload field;
// absent fields are wildcards.

export type BehaviorCheck =
  | { kind: 'seq';       id: string; description: LocalizedText;
      /** ordered subsequence that must appear in the event stream */
      events: EventPattern[];
      /** optional: all events must occur within `ms` after the first match */
      windowMs?: number }
  | { kind: 'after';     id: string; description: LocalizedText;
      trigger: EventPattern; expect: EventPattern; withinMs: number; minDelayMs?: number;
      /** The trigger only ARMS while the derived motion state matches. BehaviorChecker
       *  derives it from trainStarted/trainStopped events (initial state: stationary).
       *  Prevents false fails when the expected state already holds — e.g. notaus
       *  pressed while the train is already stopped emits no trainStopped event. */
      armWhile?: 'trainMoving' | 'trainStationary' }
  | { kind: 'never';     id: string; description: LocalizedText; event: EventPattern }
  | { kind: 'invariant'; id: string; description: LocalizedText;
      /** exclusiveSpeedBit — no speedConflict event, ever;
       *  noCoilHeld — no coilHeld event, ever;
       *  notausForcesStop — STRICTLY "no train movement while notaus is active": no
       *  trainStarted (and no motion carried into the window) between a notaus
       *  active:true event and its matching active:false. It asserts NOTHING about STOP
       *  staying latched after release — the mandatory NW2 clears STOP in the very cycle
       *  E 1.7 returns, so a post-return latch check would fail correct programs
       *  (§10.1). */
      invariant: 'exclusiveSpeedBit' | 'noCoilHeld' | 'notausForcesStop' };

/** One timed stimulus for a check run. Single-variant union — extend additively (M2). */
export type ScenarioAction =
  | { atMs: number; action: 'notaus'; active: boolean };

export interface NetworkSpec {
  id: string;                        // "A-NW1"
  index: number; points: number;
  title: LocalizedText;
  task: LocalizedText;               // the official Aufgabenstellung text (DE) + EN translation
  symbolNotes?: LocalizedText;       // e.g. "task says Speed2U — the symbol is Speed2IU"
  hints: HintSpec[];
  checks: BehaviorCheck[];
  /** Deterministic stimulus script for "Run checks" (§10.1): the SimCoordinator plays it
   *  via loadScenario (§5.2). This schema doubles as the record/replay format for "UI
   *  actions with sim-time stamps" that §6.3 presumes. Absent/empty = plain free-run. */
  scenario?: ScenarioAction[];
  /** Check run ends (and pending checks resolve, §10.1) at this simulated time.
   *  Default 120_000. */
  runTimeoutMs?: number;
}

export interface ExerciseSpec {
  id: string;                        // "gruppeA" | "gruppeB" | future custom
  title: LocalizedText; intro: LocalizedText;
  bounceEnabled: boolean;            // true for Gruppe A (xR01D debounce network)
  networks: NetworkSpec[];
}

export interface CheckResult {
  checkId: string; status: 'pass' | 'fail' | 'pending';
  detail?: LocalizedText;            // e.g. "switch pulse lasted 4820 ms — expected ≈300 ms"
}

export class BehaviorChecker {
  constructor(checks: BehaviorCheck[]);
  onEvent(e: SimEvent): void;        // subscribe via EventBus
  results(): CheckResult[];
  reset(): void;
}

export interface ExampleSpec {
  id: string; category: 'binary' | 'memory' | 'timer' | 'edge' | 'counter' | 'compare' | 'jump' | 'pattern';
  title: LocalizedText; body: LocalizedText;   // explanation
  awl: string;                                 // runnable snippet with NEUTRAL operands
  source: string;                              // "Anleitung IV.2.5.6" — provenance
}

export function loadExercises(json: unknown): ExerciseSpec[];   // validates, throws on schema error
export function loadExamples(json: unknown): ExampleSpec[];

/** pedagogy/ has no DOM and no wall-clock access (§2 rule 5; §9 runs its tests in the
 *  node environment, where localStorage does not exist). Storage and time are therefore
 *  INJECTED: ui/ supplies the browser implementations (localStorage + Date.now); tests
 *  supply an in-memory store and a fake clock. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
export type NowFn = () => number;               // real-time ms (epoch), injected

export class HintGate {
  /** Unlock policy: level 1 always available; level n+1 unlocks after (a) a failed check
   *  run OR (b) 5 minutes on the network OR (c) explicit "I'm stuck" click — whichever
   *  first. The 5-minute window is REAL time, measured with the injected now() (NOT sim
   *  time). Persisted per network in progress.ts. */
  constructor(networkId: string, progress: ProgressStore);
  availableLevels(): number[];
  reveal(level: number): void;
}

export class ProgressStore {                    // persisted under key "mat2sps.progress.v1"
  constructor(kv: KeyValueStore, now: NowFn);
  networkStatus(id: string): 'untouched' | 'attempted' | 'passed';
  setNetworkStatus(id: string, s: 'attempted' | 'passed'): void;
  hintState(id: string): { revealed: number[] };
  export(): string; import(s: string): void;    // JSON blob for backup
}
```

### 5.6 ui/i18n

```ts
export type Locale = 'en' | 'de';
export type MsgKey = keyof typeof en;            // en.ts is the source of truth

/** UI string lookup with {param} interpolation. de.ts is a TOTAL Record<MsgKey, string>
 *  checked by tsc — a missing key is a compile error, so there is deliberately NO
 *  runtime EN-fallback path. */
export function t(key: MsgKey, params?: Record<string, string | number>): string;
/** Same lookup for an EXPLICIT locale — needed wherever a string must exist in BOTH
 *  languages at once, e.g. a UI-raised Diagnostic's `message: { de, en }` (§5.1.5). */
export function tIn(
  locale: Locale, key: MsgKey, params?: Record<string, string | number>,
): string;
/** Pick from a LocalizedText (exercise/hint content) by current locale.
 *  LocalizedText is imported from pedagogy — its single owner (§4, §5.5). */
export function lt(text: LocalizedText): string;
export function setLocale(l: Locale): void;      // persists "mat2sps.locale"; default 'en'
export function getLocale(): Locale;
/** Returns an unsubscribe callback. Typed inline as `() => void` on purpose — the
 *  `Unsubscribe` alias stays app-internal (single owner, §5.2); no shared name. */
export function onLocaleChange(cb: (l: Locale) => void): () => void;
```

Rules: every user-visible string in `ui/` goes through `t()`; exercise/hint/example content
carries both languages inline (`LocalizedText`) and goes through `lt()`. Core diagnostics
already carry `{de, en}` — UI picks by locale. A UI-**raised** diagnostic that is built once
and then cached (`I-TPL-001`, `W-TPL-001`, §5.1.5) fills both languages with `tIn`, otherwise
it would freeze the locale it was created in and survive the EN/DE toggle unchanged. Number
formatting: `de` locale uses decimal comma (`Intl.NumberFormat`).

Key blocks added by the second experiment (§13): `experiment.*`, `task.*`, `params.*`,
`plant.*`, `tabs.parameters`, `app.subtitlePump`, `inputs.notePump`, `watch.section.pump*`.

---

### 5.7 ui/ shell layout (user-resizable panels)

**Deviation note (added after M1).** The original spec fixed the shell proportions in
`styles.css`. Students resize the window, not the panels, and on a 13″ display the editor and
the 3D view compete for the same pixels, so all five panels are now user-resizable. Two new
files (listed in §3) and one new `localStorage` key; no other module is involved.
(Numbering note: this section is §5.7 because §5.2 is `app/` — the layout is a `ui/` concern
and sits next to §5.6, the other `ui/` section.)

**Three split groups.** Track order is DOM order.

| group | tracks | splitters | drag floors (px) |
|---|---|---|---|
| `columns` | tools ǀ centre (editor+messages) ǀ right (3D+watch) | 2, vertical | 260 / 320 / 360 |
| `centreRows` | AWL editor ǀ messages | 1, horizontal | 180 / 120 |
| `rightRows` | 3D viewport ǀ watch table | 1, horizontal | **360** / 140 |

**Weights, not pixels.** A group's state is a weight vector that becomes a grid track list
`minmax(<cssFloor>px, <weight>fr) 10px minmax(…)`, published as a custom property on
`.app-main` (`--layout-cols`, `--layout-rows-centre`, `--layout-rows-right`,
`--layout-rows-right-stacked`) and inherited by the columns. Consequences that are load-bearing:

- a resized layout keeps its **proportions** across window sizes, so it cannot silently become
  a pixel layout that no longer fits;
- the `var()` fallback in `styles.css` **is** the shipped default, so the shell is identical
  before any JS runs and with storage blocked;
- the CSS floors are unchanged from the pre-feature stylesheet, and the *stacked* row list
  keeps the **360 px viewport floor of the D2 fix** (`docs/REVIEW_SCENE.md`) — a drag or a
  restored layout can redistribute the `fr` share but can never lower a floor;
- a finished drag writes the measured pixel sizes back as the group's weights (ratios are the
  meaning, the unit is irrelevant), which is why a persisted record contains numbers like
  `471.75`.

The 10 px splitter tracks **replace** the former 10 px grid gap (`column-gap: 0`,
`.app-column { row-gap: 0 }`), so every geometry the D2 fix measured still holds — the stacked
right column is 360 + 10 + 140 = 510 px, matching the `minmax(510px, 62vh)` row.

**Stacked layouts.** At ≤ 1380 px the media queries own the column arrangement, so the column
splitters are `display: none` there (a `display: none` grid item is not laid out at all, so
auto-placement of the columns is exactly as before). `LayoutController.isLive()` reads the same
zero offsets and makes drag, keyboard **and layout repair** skip that group, instead of
measuring a three-track group inside a two-column grid and persisting weights for a layout the
user never saw. The row splitters keep working in every layout.

**Persistence.** `mat2sps.layout.v1` (same convention as `mat2sps.locale`, §5.6):
`{"v":1,"columns":[…3],"centreRows":[…2],"rightRows":[…2]}`. `parseLayout` is total — anything
unusable (non-JSON, wrong version, wrong arity, zero/negative/NaN weight) falls back to the
default, per group, so one stale group cannot cost the student the other two. Writing happens
on drag END and on each keyboard step; a layout equal to the default (up to a scalar) **removes**
the record rather than storing it.

**Repair on restore (not blind apply).** `mount()` measures what this display actually offers
and runs `repairLayout`: any track that would fall below its drag floor is pinned AT the floor
and the remainder redistributed, repeatedly. A layout saved on a 4K display therefore cannot
crush the 3D view on a laptop (measured: stored viewport share 2 % → repaired to 360 px). If
the floors do not fit at all, the weights are left alone — no distribution could satisfy them
and the CSS floors decide. The repair is deliberately **not** written back to storage: it is
display-specific, so opening the app on a small screen must not overwrite the desktop layout.

**Accessibility.** Each splitter is a `role="separator"` with `aria-orientation`
(vertical for the column splits, horizontal for the row splits), an i18n `aria-label`,
`tabIndex=0` and a live `aria-valuenow` (the first neighbour's share in percent, refreshed by a
`ResizeObserver` so a window change updates it too). Arrow keys resize by 16 px (Shift: 64 px);
`Home`, `End` and a double-click restore that split's default; the control bar carries a
localized **"Reset layout" / "Layout zurücksetzen"** button that restores all three groups and
is never disabled — the layout stays usable when the simulation core failed to build.

**Canvas + clock.** A resize is one style write on `.app-main`. `LayoutController` imports only
`i18n`, `dom` and `layoutModel` — it cannot call into `app/` or `scene/`, so it cannot disturb
the `SimClock` or the `RafDriver`. The canvas' drawing buffer follows its CSS size through the
paths that already existed: the App's `ResizeObserver` on the viewport panel and, as the
backstop for frames the observer never saw, the per-frame `clientWidth/clientHeight` check in
`main.ts`.

**Tests.** `tests/ui/layout.test.ts` (node environment, no jsdom) pins the pure model: floor
clamping, delta → new sizes, non-adjacent tracks untouched, "never snap an already-undersized
track up", track-list emission incl. the 360 px stacked floor, serialize/parse totality, reset
and `splitPercent`. The DOM half is verified in the running app.

---

## 6. Timing model & determinism

### 6.1 Three clocks, one master

| Layer | Step | Driven by |
|---|---|---|
| Plant physics | **fixed 10 ms** simulated | `SimCoordinator.advanceSteps` |
| PLC scan | **fixed `scanIntervalMs`** simulated (default **50 ms**, range 10–200, multiple of 10) | coordinator, every `scanIntervalMs / 10` physics steps |
| Rendering | `requestAnimationFrame`, variable | `RafDriver` (browser only) |

The RAF driver converts real elapsed time × `timeScale` into whole physics steps via the
accumulator in `SimClock`; leftover fractional time becomes the scene interpolation alpha.
Pausing = `timeScale 0`. Slow motion/fast forward = 0.25×–8×. **Simulated time is always an
integer number of ms** and advances identically in browser and headless tests.

### 6.2 Scan cycle anatomy (one `Emulator.step(dt)`)

1. Advance all running timers by `dt` (expiries land exactly; SS latches set).
2. Execute the program linearly (PAE was written by the coordinator before the call).
3. Increment cycle counter. (PAA/flags are read by the coordinator after the call.)

Consequences the tests pin down: an input pulse shorter than one scan is still seen exactly
once (reed latch, §5.3); `FP` fires in the first scan that reads the changed input; a timer
that expires between scans shows `Q` at the next scan; `ZV` + `L Z` in the same scan reads
the incremented value.

### 6.3 Determinism requirements (binding)

- `core/` and `plant/` never call `Date.now`, `performance.now`, `Math.random`,
  `requestAnimationFrame`, or read any global mutable state. Enforced by ESLint
  (`no-restricted-globals`/`no-restricted-properties`) + code review.
- All randomness (reed bounce) flows from `plant/random.ts` (mulberry32) seeded via
  `PlantConfig.seed`.
- All iteration over collections uses insertion order of the trackplan arrays (stable).
- Event emission order within one physics step: plant events in detection order, then
  coordinator-emitted events (`speedConflict`); ties broken by array index (§5.2 step 3).
  There are no emulator-derived SimEvents in M1 — runtime diagnostics stay in
  `ScanResult` (§5.2).
- Given (program source, trackplan, seed, scanIntervalMs, scenario action script — the
  §5.5 `ScenarioAction[]` schema, which IS the record/replay format for "UI actions with
  sim-time stamps"), the full `SimEvent` log is byte-identical across runs and platforms.
  `tests/app/determinism.test.ts` asserts this with two seeded runs.
- Floating point: train offsets/speeds are float64; identical operation order ⇒ identical
  results (IEEE 754). No `Math.sin/cos` in state-affecting code paths with
  platform-variant implementations — geometry uses them only for *rendering* tangents;
  arc-length stepping uses precomputed cumulative polyline lengths.

---

## 7. Data schemas (JSON)

All files live in `src/data/`, are imported statically by `main.ts` (Vite JSON import), and
are validated at startup (`plant`/`core`/`pedagogy` loaders throw with a clear message).
Schema types live with the consumer: `TrackplanFile` in `plant/types.ts`, `VariablesFile`
in `core/symbols.ts`, exercise/example schemas in `pedagogy/types.ts`.

### 7.1 `trackplan.json` (consumer: plant, scene)

```jsonc
{
  "version": 1,
  "meta": {
    "units": "gleisplanPt",            // 960×540 pt space of Gleisplan SPS.pdf overlays
    "mmPerUnit": 3.5,                  // ASSUMPTION (§12): plate ≈ 3.36 m × 1.89 m (TT scale)
    "speedsMmS": { "1": 80, "2": 160, "3": 280 },   // ASSUMPTION (§12), tunable
    "trainAccelMmS2": 150,             // ASSUMPTION (§12)
    "switchActuationMs": 300,          // Anleitung V.1 (binding)
    "reedWindowMm": 10,                // ASSUMPTION (§12): magnet closure window
    "magnetOffsetMm": 0                // magnet at loco center
  },
  "nodes": [
    { "id": "n-bh1g1-w1", "pt": { "x": 168, "y": 322 }, "kind": "switch" },
    { "id": "n-a-1",      "pt": { "x": 141, "y": 46  }, "kind": "plain"  }
  ],
  "edges": [
    { "id": "e-bh1g1-a", "from": "n-bh1g1-w1", "to": "n-a-1",
      "pts": [ { "x": 168, "y": 322 }, { "x": 120, "y": 250 }, { "x": 141, "y": 46 } ],
      "tunnel": false }
  ],
  "switches": [
    { "id": "xW01BH1G1", "nodeId": "n-bh1g1-w1",
      "toeEdgeId": "e-bh1g1-in",
      "branchEdgeIds": [ "e-bh1g1-a", "e-bh1g1-g2" ],
      "coilToBranch": { "G": 0, "R": 1 },
      "mappingSource": "derived",
      "mappingEvidence": "A-NW3: xW01BH1G1G commanded for exit onto Gleis A ⇒ G = branch 0 (to A)",
      "initialPosition": 1 }
  ],
  "reeds": [
    { "id": "xR01BH1G1", "edgeId": "e-bh1g1-main", "offsetMm": 410, "wired": true,  "bounce": false },
    { "id": "xR01D",     "edgeId": "e-d-2",        "offsetMm": 950, "wired": true,  "bounce": true  },
    { "id": "xR02A",     "edgeId": "e-a-1",        "offsetMm": 300, "wired": false, "bounce": false }
  ],
  "start": { "edgeId": "e-bh1g1-main", "offsetMm": 100, "direction": 1 },
  /* Integration deviation note (2026-07-27, amended 2026-07-27 for D13): optional top-level
   * field `exerciseStarts` ({ [exerciseId]: { edgeId, offsetMm, direction, note } }). The two
   * Aufgabenstellungen place the loco differently (A: Bahnhof 1 Gleis 1 = the default `start`;
   * B: Bahnhof 1 Gleis 4 — B-NW10 "auf das ursprüngliche Gleis 4"), but §7.1 has a single
   * `start`. Consumers that only know the §7.1 schema ignore the extra field.
   *
   * ONE resolution rule for everything that seats a train: `startForExercise(plan, id)` in
   * src/plant/exerciseStart.ts (falls back to §7.1 `start` for an id without an entry).
   * Three consumers, two shapes:
   *   - live stack: `Plant.setStart` re-seats the running plant in place (host `setExercise`,
   *     called from the ExercisePanel selection) — the plant/coordinator/scene identities and
   *     the loaded program survive, and a plain `reset()` keeps the seat, since TrackGraph's
   *     start spec is what `Plant.init()` reads;
   *   - check runner (main.ts) and tests/oracle/scenarioRunner.ts: `trackplanForExercise`
   *     clones the plan and substitutes `start` before building a throwaway Plant.
   * D13 was the missing first bullet: only the headless paths honoured the field, so the
   * visible loco stood on Gleis 1 whichever Aufgabenstellung the student had open, while the
   * graded check run for the same network started it on Gleis 4. */
  /* Optional top-level field `unplacedSwitches`: `[{ id, note }]`. Seven Variablenliste
   * switches (xW01C, xW01BH1G3/G4, xW04BH1G3/G4, xW01BH3G2, xW04BH3G2) have a G/R coil pair
   * but no label on the Gleisplan, so the board model has no node for them (assumption W1).
   * They are NOT in `switches` — the plant never sees them, and the 36-placed/35-commandable
   * invariants stay as they are. `buildWiring` resolves their coil bits into
   * `Wiring.unplacedCoils` and the coordinator records a command on them once per coil
   * (§5.2), so pulsing such a coil produces the localized W-SWI-001 warning in the message
   * list instead of silently doing nothing. Typed as optional in `plant/types.ts`
   * (`UnplacedSwitchSpec`); consumers that ignore the field keep working. */
  "landscape": {
    "tunnels":  [ { "edgeIds": ["e-c-2", "e-k-1"] } ],
    "lake":     { "center": { "x": 130, "y": 300 }, "radiusPt": 55 },
    "buildings":[ { "kind": "lokschuppen", "pt": { "x": 900, "y": 60 }, "rotDeg": 0 } ],
    "mountains":[ { "center": { "x": 220, "y": 180 }, "radiusPt": 120, "heightPt": 60 } ]
  }
}
```

Construction sources: node/edge geometry traced from the Gleisplan overlay coordinates
already extracted in `reference/research/weichen_video.md` §7.2/§7.3 (gitignored, local only —
the data agent uses it locally and ships only the derived JSON); station track y-lanes
from §7.1. `tools/validate-trackplan.ts` checks: every edge endpoint exists; every switch
node has exactly 3 incident edges (toe + 2 branches, all listed); every `wired: true`
reed id exists in `variables.json`; the 23 wired reeds are exactly the documented set;
edge orientations form a consistent IU-traversal (walk the Route A and Route B scripts —
every transition must be reachable); and **no edge is traversed in opposite directions
under the same command across the A and B route walks** (§8 — the See-Kehre consistency
proof).

### 7.2 `variables.json` (consumer: core SymbolTable; generated by `tools/gen-variables.ts`)

```jsonc
{
  "version": 1,
  "generatedFrom": "Variablenliste.txt",
  "generatedAt": "2026-07-26",
  "entries": [
    { "symbol": "xW04BH1G4G", "address": "M 100.5", "type": "BOOL", "comment": "" },
    { "symbol": "XW03CR",     "address": "M 109.7", "type": "BOOL", "comment": "",
      "note": "uppercase X exactly as in Variablenliste — case-sensitivity trap" },
    { "symbol": "xR01A",      "address": "E 1.4",  "type": "BOOL", "comment": "" },
    { "symbol": "NotausBit",  "address": "E 1.7",  "type": "BOOL",
      "comment": "Notaus", "commentEn": "Emergency stop (fail-safe: 0 = active)" },
    { "symbol": "STOP",       "address": "M 120.3", "type": "BOOL",
      "comment": "Stillstand des Zuges", "commentEn": "Train standstill" },
    { "symbol": "Fahrstrom",  "address": "AW 6",   "type": "WORD",
      "comment": "Fahrstrom der Lok", "commentEn": "Traction current word" },
    { "symbol": "Schaltzeit", "address": "T 1",    "type": "TIMER",
      "comment": "systemseitig", "commentEn": "system timer — not for students" },
    { "symbol": "FahrstromFB","address": "FB 1",   "type": "BLOCK", "comment": "" }
  ]
}
```

Generator rules: preserve exact symbol spelling (the two uppercase-X entries **must**
survive); tab-separated source lines `"Symbol"<TAB>ADDR<TAB>TYPE<TAB>comment`; tolerate the
known glitch (`"SOPhase2` missing closing quote); addresses normalized via
`core/parseAddress` formatting; block refs (`FB 1`, `DB 2`, `OB 121`, `UDT 1`,
`FC 10…80`) become `type: "BLOCK"`. `tests/data/variables.test.ts` asserts the invariants:
84 switch-coil bits, `addr(R) = addr(G) + 6 bytes` at identical bit position for all 42
switches, 23 reed inputs + `NotausBit`, the speed/STOP bit layout of MB 120.

### 7.3 `exercises.json` (consumer: pedagogy)

```jsonc
{
  "version": 1,
  "exercises": [
    {
      "id": "gruppeA",
      "title": { "de": "Aufgabenstellung Gruppe A", "en": "Assignment Group A" },
      "intro": { "de": "Rangierfahrt aufs Abstellgleis …", "en": "Shunting onto the siding …" },
      "bounceEnabled": true,
      "networks": [
        {
          "id": "A-NW1", "index": 1, "points": 2,
          "title": { "de": "Not-Aus HALT!", "en": "Emergency stop HALT!" },
          "task": {
            "de": "Der Notausstromkreis ist drahtbruchsicher verkabelt […] Wenn E 1.7 (NotausBit) logisch 0 ist, soll Merker 120.3 (STOP) den Zug immer stoppen.",
            "en": "The emergency-stop circuit is wired fail-safe […] Whenever E 1.7 (NotausBit) is logic 0, flag M 120.3 (STOP) must always stop the train."
          },
          "hints": [
            { "level": 1,
              "title": { "de": "Konzept: 0-aktive Signale", "en": "Concept: active-low signals" },
              "body":  { "de": "Ein drahtbruchsicheres Signal ist im Normalzustand 1. Abfrage des Störfalls daher negiert. Siehe Anleitung IV.2.5.5 (UN).",
                         "en": "A fail-safe signal is 1 in normal operation, so the fault case is queried negated. See Anleitung IV.2.5.5 (UN)." },
              "anleitungRef": { "section": "IV.2.5.5",
                                "label": { "de": "Anleitung IV.2.5.5 (UN)",
                                           "en": "Manual IV.2.5.5 (negated query, UN)" } } },
            { "level": 2,
              "title": { "de": "Muster: speicherndes Stoppen", "en": "Pattern: latched stop" },
              "body":  { "de": "Generisches Muster mit neutralen Operanden:\n```awl\nUN E 0.0   // Störsignal 0-aktiv\nS  M 10.0  // Zustand speichernd setzen\n```\nWarum `S` statt `=`? Überlegen Sie, was nach Rückkehr des Signals passieren darf.",
                         "en": "Generic pattern with neutral operands:\n```awl\nUN E 0.0   // fault signal, active-low\nS  M 10.0  // latch the state\n```\nWhy `S` instead of `=`? Consider what may happen once the signal returns." } },
            { "level": 3,
              "title": { "de": "Checkliste", "en": "Checklist" },
              "body":  { "de": "– Wird STOP auch OHNE Flanke gesetzt, solange Notaus anliegt?\n– Bleibt STOP nach Signalwiederkehr gesetzt?\n– Sind alle Fahrstufen rückgesetzt?",
                         "en": "– Is STOP set continuously while the emergency stop is active (no edge needed)?\n– Does STOP stay latched after the signal returns?\n– Are all speed levels reset?" } }
          ],
          "scenario": [ { "atMs": 2000, "action": "notaus", "active": true },
                        { "atMs": 6000, "action": "notaus", "active": false } ],
          "runTimeoutMs": 30000,
          "checks": [
            { "kind": "after", "id": "A-NW1-stop",
              "description": { "de": "Notaus stoppt den Zug", "en": "Emergency stop halts the train" },
              "trigger": { "type": "notaus", "active": true }, "armWhile": "trainMoving",
              "expect":  { "type": "trainStopped" }, "withinMs": 4000 },
            { "kind": "invariant", "id": "A-NW1-halt",
              "description": { "de": "Kein Losfahren bei aktivem Notaus",
                               "en": "No movement while the emergency stop is active" },
              "invariant": "notausForcesStop" }
          ]
        }
        // … A-NW2 … A-NW11, then "gruppeB" with B-NW1 … B-NW11
      ]
    }
  ]
}
```

Content rules: `task` texts are the official Aufgabenstellung wording
(`Gruppe_A_Aufgabe_SS2026.txt` / `Gruppe_B_Aufgabe_SS2026.txt` — shippable course handouts)
plus faithful EN translations; `symbolNotes` carries the documented text↔symbol mismatches
(solutions.md §12 table: `Speed2U`→`Speed2IU`, `xR02BH02G3`→`xR02BH2G3`, …). Hints are
authored per §10 rules — **no plant/system operand names in hint bodies** (enforced by
`tests/pedagogy/hints.test.ts`). The guard targets PLANT/SYSTEM operands only — the
neutral student operands that level-2 hints are REQUIRED to use (`E 0.x`, `M 10.x` –
`M 20.x`, `T 1x`) must pass. Forbidden patterns (case-sensitive, whole-word):
`/\bM\s*1[01]\d\b/` (three-digit system bytes M 100–M 119 — student Merker `M 10.x` /
`M 11.x` do NOT match), `/\bM\s*12[01]\b/` (M 120/M 121), `/\bxW\w*/`, `/\bxR\w*/`,
`XW03CR`, `XW05BH1G3R`, `/\bSpeed[123](IU|GU)\b/`, and `STOP` inside fenced awl blocks —
minus any symbol the network's own task text already prints. The example hints in this
very file (A-NW1 above) are fixture inputs of that test and must PASS the guard.

### 7.4 `examples.json` (consumer: pedagogy → ExamplesPanel)

```jsonc
{
  "version": 1,
  "examples": [
    {
      "id": "pump-selfhold", "category": "memory",
      "title": { "de": "Pumpe mit Selbsthaltung (Anleitung)", "en": "Pump with self-holding latch (manual)" },
      "body":  { "de": "Lehrbeispiel aus der Anleitung: Start-/Stopptaster mit S/R …",
                 "en": "Teaching example from the manual: start/stop buttons with S/R …" },
      "awl": "U    E    0.0   // S1 Start\nS    M    0.0\n\nO    E    0.6   // S0 Stopp\nON   E    0.5\nO    E    0.1\nO    E    0.4\nR    M    0.0\n\nU    M    0.0\n=    A    0.1   // Pumpe",
      "source": "Anleitung IV.2.5.6"
    },
    {
      "id": "sv-pulse", "category": "timer",
      "title": { "de": "Verlängerter Impuls (SV) — Treppenlicht", "en": "Extended pulse (SV) — staircase light" },
      "body":  { "de": "Kurzer Tastendruck, festes Zeitfenster, nachtriggerbar.",
                 "en": "Short press, fixed time window, retriggerable." },
      "awl": "U  E 1.1\nL  S5T#4S500MS\nSV T 2\nU  E 1.7\nR  T 2\n\nU  T 2\n=  A 0.2",
      "source": "Anleitung IV.2.6.2"
    },
    {
      "id": "weichenstrasse-template", "category": "pattern",
      "title": { "de": "Muster: Weichenstraße mit 300-ms-Impuls", "en": "Pattern: point route with 300 ms pulse" },
      "body":  { "de": "Alle Weichen einer Straße aus EINEM SV-Impuls — Operanden neutral.",
                 "en": "All switches of one route from a SINGLE SV pulse — neutral operands." },
      "awl": "U  E 0.0        // Auslöser (Reedkontakt)\nL  S5T#300MS\nSV T 10\nU  T 10\n=  A 0.0        // Weichenspule 1\nU  T 10\n=  A 0.1        // Weichenspule 2",
      "source": "Video 08:08 / Hinweise S.3"
    }
  ]
}
```

Schema addition (2026-07-27, first-run UX): an example may carry `"starter": true` — at most
one in the file, enforced by `loadExamples`. It is the buffer `main.ts` seeds the editor with
on first run (`starterExample()`, `ExampleSpec.starter`). Reason: the Anleitung snippets are
kept **verbatim**, and the manual's operands (`M 0.0`, `A 0.1`, `T 1`…) lie outside the
student resource whitelist, so seeding the editor with the first entry made the very first
"Load into PLC" report three W-RES-001 warnings before the student had written a line. The
starter example is therefore an original, didactically minimal snippet (S/R self-holding plus
an `SE` on-delay) that writes only student resources (`M 10.x`, `T 10`) and is thus
diagnostic-free; `tests/data/examples.test.ts` pins both halves of that claim — the starter
translating with zero diagnostics, and the untouched Anleitung pump example still producing
exactly its three warnings. Absent the flag, the loader/`main.ts` fall back to the first entry.

Schema addition (2026-08-01, second experiment): an example may carry
`"experiment": "railway" | "pump"`. **Absent means both**, which is the normal case — the
Anleitung's snippets are operand-neutral and teach the same thing on either plant. Only a
snippet that needs hardware the other plant does not have is tagged; in the shipped library
that is exactly one entry (`weichenstrasse-template`, which drives switch coils). Both
bootstraps go through one call, `loadExamplesForExperiment(json, experiment)` — parse and
filter welded together, because the two-step form was got wrong once and the railway shipped
the unfiltered list. `loadExamples` validates the field with the same `oneOf` guard as
`category`, so a typo is a load error rather than a silently invisible example.

Planned example set (≥ 12): pump S/R + AND/OR/negation chain (Anleitung IV.2.5.x, 4
snippets), all five timers SI/SV/SE/SS/SA with the E1.x operands verbatim from the
Anleitung, SA pump follow-up, FP/FN generic, jump example (IV.2.8), SS wait pattern
(Thementag Aufgabe 3 generic form), SV switch-route template, debounce concept pattern
(FP + lockout timer with neutral operands `E 0.0 / M 10.0 / M 10.1 / T 15` — same shape,
no plant symbols), counter + compare round-counting pattern (neutral).

---

## 8. G/R coil → geometric branch mapping

**Problem** (binding constraint from the sources): the practicum explicitly warns that G/R
carry **no** route semantics ("Aus G und R lassen sich keine logischen Zusammenhänge zum
Fahrweg ableiten"). The wiring polarity is arbitrary per switch. The simulator therefore
stores the mapping as **data per switch**, never as a naming convention.

**Storage** — `trackplan.json → switches[n]`:
```jsonc
"coilToBranch":   { "G": 0, "R": 1 },     // branch index into branchEdgeIds
"mappingSource":  "derived" | "assumed",
"mappingEvidence": "A-NW5: route passes BH2 via G3; commanded coils xW02BH2G1R … ⇒ R = branch toward G2/G3 ladder"
```

**Derivation method** (executed by the data agent, documented per switch in
`mappingEvidence`):

1. Take the route scripts: Aufgabenstellung A/B network descriptions (which name the
   commanded coil per switch per event) together with the geometric route (red route
   overlays, Gleisplan pages 1–2; summarized in solutions.md §8 event tables).
2. For every switch the route physically traverses right after a command, the commanded
   coil must select the branch the train then takes ⇒ coil→branch fixed.
3. Switches commanded but *not* traversed at that moment (flank protection, "Weichen hinter
   der Lok" in A-NW8) are resolved from the follow-up move that does traverse them (the
   push-back in A-NW8 traverses xW02D/xW01D in reverse) or from the requirement that the
   *other* route variant traverses them (cross-checking A vs B, e.g. xW02DG in A-NW7 vs
   xW02DR in B-NW5 must map to different branches — a built-in consistency check).
4. Every derivation is recorded in `mappingEvidence`. Conflicting evidence = data bug;
   `tools/validate-trackplan.ts` re-walks both route scripts through the mapped graph and
   fails if the train would not reach the documented next reed contact.

**Unknowns**: switches never commanded by either task (the Gleis-E group `xW01E`, `xW02E`,
`xW03E`, plus `xW01C`, `xW04BH1G4`, `xW04BH1G3`, `xW02BH1G3`, `xW01BH1G3`, `xW01BH1G4`,
`xW01BH2G4`, `xW04BH3G2`, and any others without route evidence) get
the **consistent default** `{"G": 0, "R": 1}` where branch 0 is the geometrically
straighter continuation, flagged `"mappingSource": "assumed"`. The unlabeled `(xW)` is
the exception: it has NO Variablenliste symbols and therefore no coil addresses, so it is
stored with `"coilToBranch": null` (§5.3) — fixed at `initialPosition` ("fest liegend"),
skipped by `buildWiring` (§5.2), and excluded from the 42-switch/84-coil-bit invariants
(§7.2). The UI shows a small
"assumed wiring" badge in the switch tooltip for these (i18n key `switch.assumedMapping`),
so students are never misled into reading G/R as meaningful. `initialPosition` of all
switches: the branch that keeps the outer mainline circuit closed (so a program-less plant
lets the train do laps).

**Reversing loop note**: commands are DECOUPLED from geometry. `wordToTarget` returns a
command (`IU`/`GU`/`STOP`, §5.3), and the Train owns a travel sign relative to its
current edge, re-derived at every node transition from geometric continuity (the sign on
the next edge is whichever continues the motion away from the shared node); a command
change IU↔GU while stationary flips the current travel sign. Edge orientation (from→to)
is thus only a data convention: edges are oriented along the documented IU route
traversals, K-circle edges along the B-route traversal direction. The ONLY consistency
claim made is what the validator's route walk proves (§7.1): both documented route
scripts replay through the mapped graph, and no edge is traversed in opposite directions
under the same command across the A and B walks. No global clockwise-ness equivalence is
asserted anywhere.

---

## 9. Test plan

Runner: vitest, `environment: 'node'` for everything except `ui/` component tests (M2+).
Coverage gate on `core/`: 95 % line coverage (it is the semantic heart).

### 9.1 core/ unit tests (file → cases)

- **address.test.ts**: parse/format round-trip for `E 1.7`, `M 100.4`, `M100.4`, `AW 6`,
  `MW 131`, `T 10`, `Z 1`; rejects `M 100.8`, `Q 0.0`, `AW 6.1`, negative bytes; range
  checks (M byte ≤ 255).
- **symbols.test.ts**: case-sensitive `lookup("xW03CR")` → undefined but
  `suggest("xW03CR")` → `XW03CR`; `XW05BH1G3R` likewise; reverse `byAddress`; 42-switch /
  23-reed counts from the real generated file.
- **s5time.test.ts**: `S5T#300MS`→ base 10 ms, value 30; `S5T#4S500MS` = 4500 ms;
  `S5T#15S300MS` = 15 300 ms; `S5T#2H46M30S` max; TRUNCATION toward the chosen base
  (305 ms → 300 ms at base 10 ms; 12 345 ms → 12 300 ms at base 100 ms — STEP 7 cuts
  off, never rounds up); 0–9 ms clamps to 10 ms; base promotion (12 s → 100 ms base);
  `> 9990 s` throws; decode∘encode idempotence on representable values; literal
  permutations `S5T#1H`, `S5T#5S`, malformed → null.
- **tokenizer.test.ts**: mnemonics vs symbols, `//` comments, quoted symbols with exact
  case, `S5T#`/`C#`/int literals, label definitions `M001:`, compare mnemonics (`==I`,
  `<>I`, also the PDF spelling `== I` with space → accepted), position tracking.
- **parser.test.ts**: full Gruppe-A-shaped snippet (neutral operands) parses; operand-type
  matrix (e.g. `SV M 10.0` → `E-TYP-001`; `U T 10` ok; `ZV T 1` error); unknown symbol
  `E-SYM-001` with DE+EN text present; case-trap `E-SYM-002` with suggestion; duplicate/
  unknown labels; network markers from `// Netzwerk n` comments; **W-RES-001 whitelist
  (§5.1.5)**: a verbatim solution-shaped pattern (`=` on a switch-coil address in
  M 100–111, `S`/`R` on M 120.x speed/STOP bits, `FP M 121.0`, `S M 10.0`, `SV T 10`)
  produces ZERO W-RES-001; `= M 0.0`, `= M 130.0`, `= E 0.0`, `SV T 5`, `ZV Z 30` each
  warn.
- **bitlogic.test.ts**: truth tables for U/UN/O/ON/X/XN chains; **Erstabfrage**: first test
  after `=`/`S`/`R`/timer-op loads VKE instead of combining; `=` writes every cycle incl.
  writing 0; `S`/`R` **no-op at VKE=0** (the brief's explicit case); S then R
  precedence by program order (Selbsthaltung).
- **loadtransfer.test.ts**: `L 7 / L 9` → accu2=7 accu1=9 (Anleitung example); `T AW 6`
  writes big-endian; L/T change **neither VKE nor ERAB** mid-string (VKE-neutral: the
  `L Z1 / L 3 / <I / U x` pattern from the solutions).
- **timers-si.test.ts**: start at VKE edge, Q=1 during run; VKE drop kills Q and timer;
  expiry ends Q with VKE still high.
- **timers-sv.test.ts**: Q high for full preset although VKE dropped after one scan
  (reed-pulse case); **retrigger restarts full duration**; `R T n` aborts immediately;
  duration accuracy ± one scan at 50 ms.
- **timers-se.test.ts**: Q only after preset **and** VKE still high; early VKE drop → never
  Q; Q falls when VKE falls.
- **timers-ss.test.ts**: Q latches after expiry although VKE dropped (5 s wait pattern);
  **retrigger during run restarts**; Q persists arbitrarily many cycles; **mandatory reset**:
  only `R T n` clears (the brief's explicit case); `U T x / R T x` self-reset idiom works
  (Q observed high for exactly the scans until the reset string runs).
- **timers-sa.test.ts**: Q=1 immediately with VKE; VKE 1→0 starts off-delay; Q falls at
  expiry; VKE returns during delay → delay cancelled, Q stays 1.
- **counters.test.ts**: ZV increments only on VKE rising edge (held VKE over many scans →
  one count); **`ZV Z1` then `L Z1` in the same cycle reads the incremented value** (the
  brief's explicit case); ZR decrement; saturation 0/999; `S Z` presets from `C#010` on
  edge; `R Z` levels; `U Z n` = value≠0.
- **compare.test.ts**: all six operators, signed semantics (−1 < 3), VKE replacement,
  chaining `U` after compare (AND); compare leaves accus unchanged.
- **jumps.test.ts**: SPA forward/backward; SPB taken/not-taken with post-VKE=1; SPBN both
  paths; jump over `=` leaves operand untouched; `E-JMP-001/2`; runaway-loop guard
  `R-RUN-002` (backward SPA, > 10 000 instructions in one scan → scan aborted with runtime
  diagnostic).
- **edges.test.ts**: **FP exactly one cycle** on 0→1 (the brief's explicit case), operand
  bit updated each evaluation, FN symmetric; FP under held input never re-fires; string
  continuation after FP (`FP` then `UN` then `=` computes conjunction); two FPs with
  distinct operands are independent.
- **scancycle.test.ts**: PAE latched (input change mid-scan invisible until next scan);
  timers advance before program (expiry visible same scan); `reset()` clears memory,
  timers, counters, edge memories, cycle count, keeps program; `load()` error keeps old
  program.

### 9.2 plant/ unit tests

- **geometry.test.ts**: polyline length; point/tangent at offset incl. vertices; mm/unit
  conversion.
- **trackgraph.test.ts**: next-edge resolution at plain/switch/buffer nodes for both
  directions; switch toe vs branch entry.
- **train.test.ts**: accel lag toward target speed; overshoot distance past a reed when
  stopping (multiple-crossing realism); direction reversal only through 0; edge transition
  conserves position continuity; tunnel flag pass-through.
- **switches.test.ts**: coil rising edge → 300 ms later `switchMoved` with the mapped
  branch; re-command during actuation; both-coils conflict event; pulse duration
  measurement (300 ms SV pattern → `switchPulse.durationMs ≈ 300 ± 10 ms`); `coilHeld`
  after 5 s; `switchTrailed` and strict-mode derail.
- **reeds.test.ts**: closure window geometry; latch survives until consume, cleared after;
  a 30 ms crossing at Speed3 is caught by the next scan; bounce pattern determinism (same
  seed → same event log; different seed → different), bounce only when enabled; the
  guaranteed trailing re-closure (§5.3) produces a second PLC-level rising edge at scan
  50 ms (open gap and re-closure each span ≥ 2 consume cycles).
- **fahrstrom.test.ts**: each single M120 bit → correct word/level/command; STOP
  dominates; multi-bit → priority (the `speedConflict` EVENT is asserted in
  coordinator.test.ts — the coordinator emits it, §5.2); word→speed/command uses meta
  table.
- **plant.test.ts**: step ordering, snapshot deep-equality/stability, `drainEvents`
  chronological + emptied, reset restores start state and reseeds PRNG.

### 9.3 app/ + pedagogy/ + data/ tests

- **coordinator.test.ts**: with scan 50 ms, exactly one `Emulator.step` per 5 physics
  steps and the FIRST scan at simTimeMs = 50 (post-step phase, §5.2 — never at t = 0);
  PAE reflects latched reed; coil levels ferried; AW 6 written back into emulator
  memory; `speedConflict` emitted by the coordinator when > 1 M120 bit is set; scenario
  playback (`loadScenario`) applies actions at their `atMs` deterministically; a trivial
  program (`UN "NotausBit" / S "STOP"`) stops a moving train end-to-end.
- **determinism.test.ts**: full Gruppe-A-shaped scripted run (a tiny built-in test program,
  not the oracle) twice with seed 7 → identical serialized event logs.
- **behaviorCheck.test.ts**: seq matching (subsequence, not contiguity), windowMs, `after`
  with min/max delay, `after` payload pinning (`{type:'notaus', active:true}` does NOT
  trigger on the release event) and `armWhile` gating (notaus pressed while already
  stationary → no false fail), `never` violation, invariants (`exclusiveSpeedBit` fires
  on double-set; `noCoilHeld` on 5 s coil; `notausForcesStop` on movement while notaus).
- **hints.test.ts**: gating (level 2 locked until fail/timeout/stuck-click — driven via
  the injected in-memory KeyValueStore and fake NowFn, §5.5; runs in the node
  environment); forbidden-operand scan over all `exercises.json` hint bodies per the
  §7.3 pattern list, with the §7.3 example hints as must-PASS fixtures.
- **variables.test.ts / trackplan.test.ts / exercises.test.ts**: schema + cross-file
  consistency as described in §7.

### 9.4 Oracle scenario tests (`tests/oracle/`) — TEST TIME ONLY

Policy (binding): the AWL solutions live in `reference/Claude_work/` (gitignored). They are read with
Node `fs` at test time. If the directory or a file is absent, the ORACLE suites **skip
cleanly** (`describe.skipIf`), they never fail. Nothing under `src/` may reference them.
`no-bundle.test.ts` (always runs): greps `src/` for `reference/Claude_work`; scans every COMMITTED
file under `docs/` (everything not matched by `.gitignore` — `solutions.md`,
`weichen_video.md` and `DOMAIN_MODEL.md` are gitignored precisely because they carry
solution-derived content) for
solution markers (`LOESUNG`, `verbatim aus der Lösung`, `reference/Claude_work`; the full pattern
list lives in the test itself, written so that this paragraph does not self-match); and
asserts the built `dist/` contains neither `reference/Claude_work` nor tell-tale solution comment
strings. The `dist/` assertion may skip only in local dev when `dist/` is absent — the
release/CI job builds `dist/` FIRST and runs the guard with `MAT2SPS_REQUIRE_DIST=1`,
under which a missing `dist/` is a FAILURE, not a skip.

```ts
// tests/oracle/loadOracle.ts
export function loadOracleSource(which: 'A' | 'B'): string | null;   // fs.readFileSync or null
// files: reference/Claude_work/gruppeA.txt, reference/Claude_work/gruppeB.txt — NEUTRAL names only: no
// personal identifiers (name, matriculation number) in committed paths. Rename the
// local source files accordingly.
```

`scenarioRunner.ts`: builds SymbolTable from `variables.json`, Emulator, Plant
(seed 42; `bounceEnabled` true for A — the solution's debounce network must survive real
bounce), Wiring, Coordinator (scan 50 ms). Scenario script: t=0 notaus active; t=2 s
release notaus (E1.7 0→1); then free-run until a final `trainStopped` with no restart for
30 s, or a 10-simulated-minutes cap (fail).

Assertions against `expectations/gruppeA.json` / `gruppeB.json` — these files encode the
**Aufgabenstellung event tables** (which reed triggers which speed change and which switch
pulses, stop durations 5 s/3 s), i.e. shippable task-derived data, not solution code:

- The `speedCommand` sequence (level+direction) matches exactly, in order.
- Every prescribed `switchPulse` (switchId+coil) occurs **strictly after its trigger
  reed's `reedClosed`, within a route-plausible window** (documented per matcher in
  `matchers.ts`), with duration 300 ms ± 1 scan asserted on EVERY pulse in the run.
  (Original "before the next speedCommand" wording was unsatisfiable: `switchPulse` is
  emitted on the coil's falling edge ~300 ms after the network ran, while that same
  network's `speedCommand` lands in the same scan; and A-NW8/A-NW10/B-NW7/B-NW8 throw
  their route after the prescribed wait, i.e. after the resume command.)
- Stop durations: measured **from the trigger reed closure** to the following
  `trainStarted` = 5 s / 3 s ± 150 ms. (`trainStopped` fires only after the deceleration
  lag, so stopped→started would systematically under-measure the prescribed wait.)
- Round counting: Gruppe A ends after the 3rd `xR01BH1G1` closure, B after the 2nd
  `xR03BH1G4` closure, with a final `trainStopped` and zero further `trainStarted`.
- No `derail`, no `coilHeld`, no `speedConflict`, no `coilConflict`, no `bufferHit`
  events in the whole run.
- The exact **`switchTrailed` multiset** matches expectations (A: xW04D ×2 + xW01D ×2
  per A-NW7's prescribed pre-setting; B: empty set).
- `assertStartsOnNotausRelease`: no `speedCommand` while Notaus is pressed; first command
  within one scan of the release edge, followed by real train motion.
- `assertBounceExercised`: the debounced reed really produces multiple rising edges per
  crossing, so the Entprellen requirement cannot silently go untested.
- Determinism: the run is executed twice; event logs must be identical.

These tests double as the integration proof for §8's coil mapping — but only for switches
the route **faces**. Trailed-only switches are invisible to the reed/speed sequence (a
mutation survey measured 8 of 26 driven mappings undetectable that way); they are pinned
by the `switchTrailed` multiset assertion instead, with permanent mutation controls (one
faced + one trailed-only switch per suite) via a test-only `mutateTrackplan` deep-clone
hook.

Added during integration and acceptance (deviations from the §3 file list, two extra
files): `exerciseChecks.oracle.test.ts` and `matchers.selftest.test.ts` (anti-vacuity
self-test: every custom matcher must reject a deliberately wrong log in both directions;
always runs, needs no solution files). The assertions above validate the sim against the
`expectations/*.json` event tables — a DIFFERENT artefact from the `exercises.json`
`BehaviorCheck` set that students actually see under "Run checks" (§10.1). A check whose
pattern is subtly wrong is therefore invisible to both suites: sim right, expectations
right, correct solution reported as failing. The new file replays each group's solution
through exactly the `main.ts#runChecks` pipeline (fresh Emulator+Plant per network, seed 1,
scan 50 ms, the exercise's `bounceEnabled`, the network's own `scenario`, finalized at
`runTimeoutMs`) and requires every check of all 22 networks to end in `pass` — `pending`
and `notExercised` count as failures, because with the reference solution loaded a check
that never triggers is unreachable. Same `describe.skipIf(!oracleAvailable(...))` policy as
the other oracle suites.

---

## 10. Pedagogy design

Goal (REQUIREMENTS): students learn to solve the exercises **independently** — the
simulator gives immediate execution feedback (the very thing the real remote practicum
lacks, per video_design.md) plus graded help, but never task answers.

### 10.1 Exercise browser (`ExercisePanel`, M1)

- Tree: Exercise (Gruppe A / Gruppe B) → 11 networks with points and status chips
  (untouched / attempted / passed from `ProgressStore`).
- Selecting a network is what chooses the LIVE start position (§7.1 `exerciseStarts`, D13):
  opening a network of the other Aufgabenstellung re-seats the loco (A → Bahnhof 1 Gleis 1,
  B → Gleis 4) via host `setExercise` and resets the simulation, exactly as the Reset button
  does; opening another network of the same Aufgabenstellung, or going back to "All networks",
  leaves a running simulation untouched. Until the first selection the plant sits on the §7.1
  default (= the Gruppe A seat). The Ziel is not configured anywhere — where the loco ends up
  is the student program's business; only the start is data.
- The seat is also directly settable through the **start-track chooser** in the ControlPanel
  (Bahnhof + Gleis, two native selects), placed next to Reset because both put the plant into
  a defined starting state. It is not restricted to the two exercise starts: it offers every
  station track the trackplan yields (`deriveStations`, i.e. BH1 G1–G4, BH2 G1–G5, BH3 G1–G3)
  and seats the loco in the MIDDLE of the chosen track via host `setStartTrack`. Exercise
  re-seats are unchanged — opening a network still seats the pinned §7.1 `exerciseStarts`
  offset, because that is what the graded check run and the oracle suites replay.
  - Seat resolution: `src/scene/startTracks.ts` (pure over the trackplan, beside
    `deriveStations` because it is the same derivation one step further). `startSpecForTrack`
    yields `{ edgeId: the lane's primary edge, offsetMm: length/2, direction: iuTravelSign }`,
    validated by the existing `Plant.setStart` — a rejected spec leaves the loco untouched.
  - Options come sorted for READING, not in reed-declaration order: stations BH1→BH3, tracks
    G1→Gn numerically (the derivation order put G2 first, so "pick a Bahnhof" seated its G2 —
    user report 2026-08-01). Two lanes are dead ends whose IU sense runs into a buffer
    (BH2 G5, BH3 G1, `stub: true`): the chooser offers them marked "(dead end)"/„(Stumpfgleis)"
    instead of hiding them or faking their facing — IU/GU are the plant's GLOBAL drive senses,
    so parking against the stops there is the real plant's behaviour, pinned as such in
    `tests/plant/startTracks.test.ts`.
  - **Facing** (`iuTravelSign`): the travel sign the loco gets is the one that makes Speed1IU
    drive it around the layout the same way round as from the delivered Gruppe A seat. Derived
    from geometry, not from a per-lane table: an edge walked `from`→`to` sweeps a signed area
    about the plan centre, and a lane gets `+1` when that sense matches the §7.1 `start` edge's
    and `-1` when it does not. §7.1 declares `from`→`to` to be the IU walk, but the shipped
    plan stores `e77` (BH1 Gleis 2) the other way round, so a constant `+1` would drive that
    seat backwards. `tests/plant/startTracks.test.ts` drives the plant from every choosable
    seat and measures the swept sense against the Gruppe A control (and against the mirrored
    sign, so the check can fail).
- The chooser renders `SimStatus.seatedTrack` rather than its own click, so opening a network
  moves the chooser (A → BH1 G1, B → BH1 G4) and a refused seat leaves the previous one on
  screen. That single-state rule is the D13 guard: the live seat can never disagree with the
  network the student is reading, nor with the check run for it. Choosing a track drops the
  exercise provenance, so re-opening that network seats its own start again.
- Network view: official DE task text with EN translation below (both always available
  regardless of UI locale — the DE text is exam-relevant); `symbolNotes` callouts for the
  documented text↔symbol mismatches; "Run checks" button arms the `BehaviorChecker` for
  this network's checks, resets plant+emulator, loads the network's `scenario` action
  script into the coordinator (§5.2 `loadScenario`, §5.5 `ScenarioAction`), and runs
  until `runTimeoutMs`. At timeout, remaining `pending` checks resolve: an unmet `seq`
  fails; an `after` whose trigger FIRED without the expected event fails; an `after`
  whose trigger never fired stays `pending` (reported as "not exercised"); unviolated
  `never`/`invariant` checks pass. Note on A-NW1: whether STOP stays latched after
  Notaus release is deliberately NOT auto-checked — the mandatory NW2 clears STOP on the
  release edge, so a post-return latch check would fail correct full programs; the
  S-vs-`=` lesson lives in the level-2/3 hints instead (§5.5 `notausForcesStop` doc).
- Check results list with localized detail strings (pass/fail/pending). Failing detail
  text is diagnostic, not prescriptive ("switch pulse lasted 4820 ms — expected ≈300 ms"),
  and links to the matching hint level-1 concept.

### 10.2 Progressive hints (`HintPanel`, M1)

Three fixed levels per network (§5.5 `HintSpec`), gated by `HintGate`:
1. **Concept pointer** — names the concept and cites the Anleitung/Hinweise section
   (deep-links the ExamplesPanel entry).
2. **Generic pattern** — runnable AWL with strictly neutral operands (`E 0.x`, `A 0.x`,
   `M 10.x`, `T 1x`, `Z 1`), plus a guiding question.
3. **Checklist** — pitfalls for this network type (reset the SS timer? edge operand unique?
   all other speed bits reset?).

Guard rails (enforced by test, §9.3): hint bodies never contain plant symbols beyond those
already printed in the task text, never a complete network solution, and never reference
`reference/Claude_work` content. Authoring source for hints: Anleitung theory chapters and the
generic patterns in `hinweise.md`/Thementag write-ups — not the solutions.

### 10.3 Examples library (`ExamplesPanel`, M1)

The `examples.json` set (§7.4): Anleitung pump examples, all five timer types, FP/FN,
jumps, counter/compare pattern, SV switch-route template, debounce concept pattern. Each
example is runnable: a "Load into editor" button inserts it into a scratch tab (never
overwriting student code); a "Try it" mini-mode wires E 0.x to clickable toggle buttons in
the ControlPanel so timer/edge behavior can be observed on the watch strip without the
railway.

"Try it" as built (2026-07-27): the toggles are not example-specific state — the ControlPanel
renders one button per entry of `forcibleProgramInputs(wiring, program)` (§5.2) whenever a
program is loaded, and hides the group when that list is empty. So an example snippet exposes
exactly its own inputs, a plant program exposes none, and a student's own code gets the same
affordance for free. Mechanism: the coordinator's **force mask**, re-asserted after the
per-scan PAE write (§5.2 step 2a′), rather than a rule that forbids forcing wired reeds — on
this board every bit of E 0 – E 2 is a wired reed input or Notaus (variables.json), so the
restrictive variant would have made the mini-mode unusable for precisely the Anleitung
snippets it exists for. The only address never forcible is `notausInput`, which keeps its own
latching button. Toggling a button off releases the force (a reed input returns to the
plant's control); loading a program or pressing Reset drops the whole mask.

### 10.4 Watch table (`WatchPanel`, M2 — interface fixed now)

Rows = symbols or raw addresses; live value per scan (bit as ●/○, words hex+dec, timers as
remaining/preset+Q, counters value+Q); student-resource rows (T10–T20, Z1, M10–M20)
pre-populated per exercise. Input forcing: wired-reed rows get a "pulse" button
(sets the plant latch for one scan — manual dry-run without driving), Notaus mirror.
Backed entirely by `Emulator` inspection API + `Plant.snapshot()` — no new core surface.

### 10.5 Cycle inspector (`CycleInspectorPanel`, M2 — interface fixed now)

Pause → single-scan mode: `Emulator.step(dt, trace=true)` returns `TraceEntry[]`; the
panel renders the source with per-line VKE/ERAB/accu columns for the last scan, network
markers as section headers, and edge/timer state deltas. Stepping granularity M2: whole
scans; per-instruction stepping is a UI affair over the trace (no emulator pause state).

### 10.6 Language policy

All pedagogy content is authored bilingually in the JSON (`LocalizedText`). German
originals are authoritative for task texts (exam relevance); English is the UI default
language. Core diagnostics ship DE+EN in the message catalog (§5.1.5). Number formatting
follows locale (`39,2` vs `39.2`).

---

## 11. Milestone 2 / 3 extension points (design now, build later)

**M2 — broader AWL + diagnostics**
- `Mnemonic` union widens (arithmetic `+I -I *I /I`, `L`/`T` on DB operands, `AUF DB`,
  `CALL FC/FB`, operand-less `O` for AND-before-OR, brackets `U( O( )`). `exec.ts` is a
  table `Record<Mnemonic, OpHandler>` from day one — adding ops = adding handlers, no
  switch-statement surgery. Status word grows (`A0/A1/OV/OS/BIE`) behind the existing
  `StatusView` (additive fields only).
- Blocks: `Program` gains `blocks: Map<BlockId, Instruction[]>`; the M1 program becomes
  `OB1` implicitly. FB instance data = DB byte arrays in `MemoryAreas`-like blocks.
  `SymbolTable` already carries `BlockRef`s.
- Cycle inspector + watch table land here (interfaces already in §5/§10).
- Diagnostics: scan-time statistics (instructions/scan, worst-case), warning lint pack.

**M3 — scene/track editor**
- `trackplan.json` is already the single source of truth; the editor mutates a draft
  `TrackplanFile` in memory, re-validates with the same `tools/validate-trackplan.ts`
  logic (extracted into `plant/validate.ts` so browser and CLI share it), hot-rebuilds
  `Plant` + `SceneManager` (both are constructed from the file and disposable).
- Editing UI: bird camera + 2D gizmos (drag nodes, insert edge points, place
  switches/reeds, edit `coilToBranch` with the assumed/derived flag). Save/load =
  download/upload JSON + localStorage slots. No new core/plant surface required beyond
  `Plant` being cheaply reconstructable (< 50 ms), which the M1 design already guarantees.

---

## 12. Assumption register (flagged unknowns)

Single place implementation agents must consult before "fixing" surprising values.

| # | Assumption | Basis / risk | Where flagged |
|---|---|---|---|
| 1 | `mmPerUnit = 3.5` (plate ≈ 3.36 m × 1.89 m) | plausible for TT layout; only affects absolute speeds vs plan size | trackplan meta |
| 2 | Speeds 80/160/280 mm/s for levels 1–3 | not documented anywhere; tuned so route timings feel like the video | trackplan meta `speedsMmS` |
| 3 | AW 6 word encoding (level in low byte, GU flag bit 8) | real FB1 encoding unknown; only the M120-bit interface is documented | `fahrstrom.ts` doc comment |
| 4 | FB1 priority STOP > 1IU > 2IU > 3IU > 1GU > 2GU > 3GU on multi-set | real FB behavior unknown; deterministic choice + `speedConflict` warning | `fahrstrom.ts` |
| 5 | Reed window 10 mm, magnet at loco center | photo shows ~14 mm tube. Was 20 mm; retuned 2026-07-27 by the integrator: with 20 mm a stop triggered AT a reed (5 s/3 s shunt halts of A-NW8/10, B-NW7/8) parks the magnet INSIDE the window — the level-read reed then re-arms the stop network every scan and the run deadlocks. 10 mm keeps every stop past the window at the §12 #2/#6 speeds while a Speed-3 crossing still spans ≥ 3 physics steps (latch capture guaranteed). Verified by both oracle runs. | trackplan meta |
| 6 | Train accel 150 mm/s² | reproduces "no precise braking"; not measured | trackplan meta |
| 7 | coilToBranch for never-commanded switches | `assumed`, G→straighter branch (§8) | per-switch `mappingSource` |
| 8 | SPB/SPBN post-instruction VKE := 1 | per S7-300 STL manual; verify against real S7 in M2 | §5.1.8 |
| 9 | Bounce pattern shape (2–4 sub-scan bursts 10–30 ms, plus one guaranteed PLC-visible re-closure: 150 ms, starting 250–400 ms after window exit) | reed physics typical values; the input latch absorbs sub-scan bursts at 50 ms scan, so ONLY the trailing re-closure makes un-debounced programs observably misbehave — without it the A-NW8 check could not discriminate (§5.3) | `reeds.ts` |
| 10 | `initialPosition` = outer-mainline-closed for all switches | lets an empty program idle safely; real power-on state unknown | trackplan |

---

## 13. Experiments (two plants, one app)

The simulator ships **two** experiments in one `dist/index.html`:

| Experiment | Plant | Purpose |
|---|---|---|
| `railway` (default) | `plant/` — the MAT2 model railway (§5.3) | the graded practicum task (Gruppe A/B, §10.1) |
| `pump` | `pump/` — Anleitung IV.2.5.2, Abbildung 4 | the manual's teaching example: every AWL instruction against a live, visible plant |

The pump experiment exists because the Anleitung introduces the **whole instruction set** on
the pump figure, while the railway can only exercise the subset the Aufgabenstellung needs.
On the pump the student can run the manual's own snippets — `U/UN/O/ON`, `S/R`, all five
timers, `FP/FN`, the jump cascade, the counter — and watch something move.

**Binding rule for this whole section:** the railway is delivered and pinned by tests and by
the solution oracle (§9.4). Every mechanism below either leaves the railway path byte-for-byte
unchanged or is a documented default that reproduces today's behaviour. The pump must never be
able to move the railway.

### 13.1 Choosing an experiment

`localStorage` key **`mat2sps.experiment`**, values `'railway' | 'pump'`; anything else — a
stale value, a hand-edited entry, blocked storage — reads back as `railway`
(`readStoredExperiment`, `src/ui/experiment.ts`). This is the first call of the whole
bootstrap, so its read is inside a `try`: some browsers expose `localStorage` and then throw
on ACCESS (Safari private mode), and a throw there would be a blank page rather than a lost
preference. `ui/i18n/i18n.ts#readStoredLocale` was hardened the same way.

The header carries a segmented switcher next to the EN/DE toggle
(`experiment.railway` / `experiment.pump`, both localized). Selecting the other experiment
**flushes, persists the key and calls `location.reload()`** — in that order, which is the
policy of `switchExperiment(...)` rather than of `App`'s DOM code, so it is testable without a
browser.

The reload is the mechanism, not a shortcut. Switching in place would mean disposing a WebGL
context, a CodeMirror view, a `ResizeObserver`, a rAF driver and a coordinator, and rebuilding
all of them against a different plant type — a disposal surface with several ways to leak and
no user-visible benefit.

The **flush** is load-bearing, and its absence was a defect: two things persist on a 500 ms
debounce — the editor buffer (`ui/editor/bufferStore.ts`) and the plant parameters
(`ui/pumpProfile.ts`) — and a reload DESTROYS a pending timer instead of running it. A student
who typed and then switched within half a second lost the keystrokes. `App.flushPendingWrites`
forces both out first; `App.dispose()` does the same on teardown.

What survives a switch, honestly stated: the **program** is kept per experiment (the editor
buffer has its own key per plant, `editorStorageKeyFor`, because the two programs address
different plants). The panel layout, the locale and the progress store are single shared
settings — they survive the reload but are not remembered per experiment. The switcher's
tooltip promises exactly that and nothing more.

Per-experiment storage keys:

| Key | Owner | Note |
|---|---|---|
| `mat2sps.experiment` | `ui/experiment.ts` | the routing decision |
| `mat2sps.editor.v1` | `EditorPanel` | railway program buffer (unchanged) |
| `mat2sps.editor.pump.v1` | `EditorPanel` | pump program buffer (`editorStorageKeyFor`) |
| `mat2sps.pump.params.v1` | `ui/pumpProfile.ts` | student-set plant parameters (§13.4) |
| `mat2sps.locale`, `mat2sps.layout.v1`, `mat2sps.progress.v1` | unchanged | shared across experiments by design |

### 13.2 `SimProfile` — what the shell learns about a plant

`src/ui/App.ts` gains one optional member on `SimHost`:

```ts
export interface SimHost {
  /** Which experiment this host drives and which controls it has; absent = the railway. */
  readonly profile?: SimProfile;
  …                                     // everything else unchanged
}

export interface SimProfile {
  readonly experiment: ExperimentId;         // 'railway' | 'pump'
  readonly subtitleKey: MsgKey;              // the sub-headline names the plant
  readonly showNotaus: boolean;              // latching Notaus button in the ControlPanel
  readonly showStartTrack: boolean;          // start-track chooser (§10.1)
  readonly cameraModes: readonly CameraMode[];   // ≤ 1 entry hides the selector
  readonly showDerailedChip: boolean;        // "Train derailed" status chip
  readonly inputsNoteKey: MsgKey;            // the railway's "Try it" note names reed contacts
  readonly plantControls: PlantControlsSpec | null;   // §13.5; null = none in the DOM
  readonly tools: readonly ToolTab[];        // tab order: exercises | hints | examples | parameters
  readonly taskDoc: TaskDoc | null;          // static task text; null = the graded browser
  readonly parameters: ProfileParameters | null;  // Parameters tab host; null = none
  readonly watchSections: readonly WatchSectionSpec[] | null;  // null = the railway default
}
```

The profile only ever **subtracts or swaps**. `RAILWAY_PROFILE` is exactly today's shell and
is also what a host that supplies no profile gets, which is what makes "the railway is
unchanged" checkable rather than merely intended —
`tests/ui/controlPanelProfile.test.ts` asserts BOTH sides (the pump shell has no Notaus
button, no start-track chooser and no camera selector; the railway shell still has all three,
and carries no plant-control strip), because either assertion alone would also pass if the
control had been removed everywhere.

`ToolTab` grows a fourth member, `'parameters'`. `ControlPanel` grows five optional options
(`showNotaus`, `showStartTrack`, `cameraModes`, `inputsNoteKey`, `plantControls`), each
defaulting to the railway behaviour.

The two profile-driven panels:

- **`ui/panels/TaskPanel.ts`** — a static, bilingual task document rendered where the railway
  shows its exercise browser. The pump has no networks, no points and no check runs, so an
  ExercisePanel there would offer a "Run checks" button that can never grade anything. Bodies
  use the same markdown-lite dialect as hints and examples (§5.5), so `contentView` renders
  them with no special case and no `innerHTML` path.
- **`ui/panels/ParametersPanel.ts`** — see §13.4.

### 13.3 The pump stack and the file map

The file list is in §3. Two placement decisions worth stating:

1. **`pumpBootstrap.ts` is a second file at `src/` root.** It introduces no module boundary —
   it is `main.ts`'s second half, split out so the railway bootstrap stays readable and its
   diff stays a *move*.
2. **`ui/pumpProfile.ts` is separate from `pumpBootstrap.ts`** and lives in `ui/` (which may
   import every module's public API, §2 rule 4). Everything in it is DOM-free, so the
   parameter round trip "edit → plant clamps → persisted → restored" is testable in the node
   environment against the REAL `PumpPlant`; `pumpBootstrap.ts` keeps only what needs a
   browser (storage, the scene, the render loop). It produces the shell's types type-only, so
   it pulls in no CodeMirror; since the `pump` barrel re-exports the pump renderer (§2 rule 7)
   Three.js does reach its module graph, which costs the node suites load time and nothing
   else — no DOM, no wall clock and no rendering happens in this file.

`PumpCoordinator` is a **parallel** loop, not a generalisation of `SimCoordinator` — same
binding step order as §5.2 (physics → PAE write → forced bits → scan → PAA read → event
emission), same scan-interval rules, same "Try it" force mask. Duplicating ~80 lines is
cheaper than any refactor that could move a railway event by one physics step. The pieces that
carry no railway behaviour — `SimClock`, `RafDriver` — are reused unchanged (`RafDriver`
already takes a structural `SteppableCoordinator`).

`PumpPlant` publishes **transitions, not calls**: `setActuator`, `setButton`, `setToggle`,
`setValve` and `setParams` all return without queueing an event when the value asked for is
the one already in force. That matters for `setParams`, which a slider drag calls once per
pointer sample: `paramsChanged` means "the probes moved, re-place them", and one per sample
would be hundreds of identical notifications per drag.

### 13.4 Student-adjustable plant parameters

The Anleitung gives the pump's **signals and start/stop conditions and no dynamics at all**,
so every rate, switch point and delay in `PumpPlant` is this simulator's model assumption
rather than course data. They therefore live in typed TS with doc comments
(`pump/params.ts`), not in `src/data/*.json` — and, because they are ours, the learner is
allowed to change them and see the effect.

| Parameter | Range | Default | Applies |
|---|---|---|---|
| `pumpRatePctS` | 0.5 – 20 %/s | 4 | live |
| `refillRatePctS` | 0.5 – 20 %/s | 6 | live |
| `drainRatePctS` | 0.5 – 20 %/s | 6 | live |
| `llsThresholdPct` | 1 – 20 % | 2 | live |
| `hlsThresholdPct` | 80 – 99 % | 98 | live |
| `dryRunDelayS` | 0 – 10 s | 2 | live |
| `initialVolAPct` | 0 – 100 % | **90** | next reset |
| `initialVolBPct` | 0 – 100 % | 0 | next reset |

`initialVolAPct = 90` is **structural, not taste**. The two tanks have one capacity and one
transfer rate, so what leaves A arrives in B: with A full and B empty the manual's two end
conditions — "Tank A leer" (≤ `llsThresholdPct` = 2) and "Tank B voll" (≥ `hlsThresholdPct`
= 98) — are reached in the SAME 10 ms step, because 100 − 2 = 98. Measured at the retired
default: both fire at t = 24 500 ms. A student could then not tell which condition stopped the
pump, and a program implementing only one of the two would look correct. At 90 %: LLS_A fires
at t = 22 000 ms and HLS_B never fires at all on a plain pump-down (B tops out at 90, eight
points below its probe); opening the refill valve by hand while the pump runs reaches HLS_B at
t = 24 500 ms. Both numbers are pinned, with the retired default kept as the control, in
`tests/pump/params.test.ts`.

Rules (binding, pinned by `tests/ui/parametersPanel.test.ts` and `tests/pump/params.test.ts`):

- Input is **clamped, never rejected**. `clampPumpParams` never throws; a non-finite or
  non-numeric field keeps the previous value, an out-of-range field lands on the range end.
  A slider or a text field can therefore not put the model into a state the scene cannot draw.
- The ranges keep `lls + hysteresis < hls − hysteresis` for every admissible combination, so
  no setting can make the level bits chatter or overlap.
- The panel displays **what the plant reports**, never the keystroke — the same rule the
  start-track chooser follows (D13). Typing `9999` visibly lands on the range end.
  A cleared field redisplays the value in force rather than sending `Number('') === 0`.
  Two consequences of that rule: a refresh that did not come from the student's own edit never
  writes into the control that currently has focus (it would move the caret and eat half-typed
  digits), and `step` is a UI granularity rather than a plant constraint — the plant clamps but
  does not snap, so the number field is the exact reading and the range input's thumb is the
  coarse one. Snapping either the value or the display would break the rule.
- The snapshot carries the active parameters, so the scene places the sensor probes AT the
  threshold heights: moving a threshold visibly moves its probe, and a threshold change
  re-seeds the level bits WITHOUT hysteresis memory so the bit flips at the level the probe
  now sits at.
- Persistence is `mat2sps.pump.params.v1`, **debounced ~500 ms** and flushed at the points in
  §13.1. Writing is exact; reading is total — `parsePumpParams` drops unusable fields and
  returns `{}` for malformed JSON, so a hand-edited entry costs a setting, never the boot.

### 13.5 Operating the plant: 3D console and DOM strip

The pump's plant inputs — the momentary buttons S1/S0, the pedestal toggles and the two hand
valves — exist twice:

- as pick targets on the 3D console (`pump/scene/pedestal.ts`, `pump/scene/picking.ts`);
- as a labelled, keyboard-reachable button strip in the `ControlPanel`
  (`SimProfile.plantControls`, built by `pumpProfile.ts#pumpPlantControls`).

The strip is not a convenience. A raycast pick target has no tab stop, no accessible name and
nothing a screen reader can announce, so without it the pump experiment cannot be operated
without a mouse at all — and with it the manual's own examples would be unreachable for a
keyboard user.

The two surfaces are one state by CONSTRUCTION, not by promise: `pumpBootstrap.ts` builds a
single `PumpPlantPort` object and hands it to the scene as its pick callbacks and to the
profile as the strip's port. Every press, switch and valve therefore goes through the same
`PumpCoordinator` call, and both surfaces render the resulting `PumpSnapshot` — the strip
re-reads it on the shell's periodic refresh, so a switch thrown in the 3D view lights up on
the button and vice versa.

Control kinds:

- **momentary** (S1, S0) — 1 on `pointerdown` / Space / Enter *down*, 0 on the matching up,
  on `pointerleave`/`pointercancel` and on `blur`. Auto-repeat cannot re-press; the key
  default is suppressed so the browser does not also synthesize a `click`. This is what the
  manual's self-hold example teaches: a program that only latches on S1 must visibly drop when
  the button is released.
- **latching** (toggles, hand valves) — flips on activation and carries `aria-pressed`, whose
  value comes from the plant rather than from the button's own history.

Buttons and toggles are labelled with the operand the student types (`S1 (E 0.0)`, `E 0.7`),
which is also what the 3D name plate carries; the valves have no PLC operand and are named
through i18n.

### 13.6 Signal map (fixed by the Anleitung, non-negotiable)

| Address | Signal | Address | Signal |
|---|---|---|---|
| E 0.0 | S1 start button (momentary) | E 0.4 | HLS tank B (1 = B full) |
| E 0.1 | LLS tank A (1 = A empty) | E 0.5 | LS dry-run guard (1 = wetted) |
| E 0.2 | HLS tank A (1 = A full) | E 0.6 | S0 stop button (momentary) |
| E 0.3 | LLS tank B (1 = B empty) | A 0.1 | pump |

Beyond the figure, so the manual's timer/edge/jump examples switch something visible:
`E 0.7`, `E 1.0`–`E 1.4` and `E 1.7` are plain pedestal toggles, `A 0.2` / `A 0.3` are
indicator lamps. `E 0.7` is not a free choice — the manual's FP/FN examples (IV.2.7) and its
jump cascade (IV.2.8) query that address literally, so without the switch those snippets
address an input nothing on the plant can drive. `PUMP_TOGGLE_IDS` is in address order and the
console lays the row out from that list, so a switch added to the plant appears on the
pedestal instead of landing at an undefined position.

Two hand valves (refill into A, drain out of B) are **plant-side user actions, not PLC
outputs**, so every sensor combination of the map is reachable live.

The dry-run guard is a SENSOR, not a cut-out: the plant never stops the pump by itself (that
is the bug the Anleitung's `U E 0.5` exists to teach). It reports 0 only after the pump has run
`dryRunDelayS` continuously against an empty tank A, and it returns to 1 **as soon as the pump
is off** or product is back — so a program that switches the pump off from E 0.5 alone, without
latching, restarts it on the next scan. `pump/task.ts` states this where it describes the
guard.

`buildPumpWiring` does not merely resolve the symbols, it **verifies** that each one still
sits on the manual's address and throws listing every problem at once: a symbol list that
drifts fails loudly at startup instead of silently rewiring the teaching example. Students may
equally write the absolute addresses, which is what the manual's own snippets do.

### 13.7 Tests

| File | Pins |
|---|---|
| `tests/ui/experiment.test.ts` | the storage contract (read-back, fallback to railway, blocked storage, per-experiment editor keys) and `switchExperiment`: flush BEFORE persist and reload, with a control showing the store stays empty without the flush |
| `tests/ui/controlPanelProfile.test.ts` | the profile drives the shipped `ControlPanel` — pump has no Notaus/start-track/camera selector, **railway still has all three and no plant strip**; and the strip itself over the REAL plant: one labelled control per button/toggle/valve, S1 momentary from pointer AND keyboard, latching `aria-pressed` read back from the plant, both locales |
| `tests/ui/parametersPanel.test.ts` | shipped panel → shipped host → REAL `PumpCoordinator`/`PumpPlant` → store: edit reaches the plant, clamping is displayed and persisted, a stored value is restored, a corrupted payload falls back to defaults, every control is labelled, 100 no-op `set()` calls queue no plant events (with a control that a real change queues exactly one), a drag writes once on flush |
| `tests/ui/taskPanel.test.ts` | the pump task document is complete in both languages and states the manual's full signal map; the panel renders it and offers no check-run affordance |
| `tests/ui/i18n.test.ts` | every key renders in BOTH locales with a distinct German text (allowlist of by-design duplicates, itself asserted to be free of stale entries) |
| `tests/pump/params.test.ts` | documented defaults, clamping at both ends, live vs on-reset, and the measured separation of the two end conditions (§13.4) |
| `tests/pump/scan.test.ts` | end-to-end scans on the manual's own snippets, incl. the SA run-on and the `E 0.7` edge example |
| `tests/pump/paramsStorage.test.ts` | write exact / read total; a corrupted payload still boots a usable plant |
| `tests/pump/shellSmoke.test.ts` | headless end-to-end of the bootstrap path: real stack + real examples + real profile, load `pump-selfhold`, press S1, assert the pump output and the levels move, S0 stops it, no runtime error |
| `tests/pedagogy/loaders.test.ts` | the `experiment` tag: schema, both filter directions, the shipped tagging decision, and `loadExamplesForExperiment` — the single call both bootstraps make |

Scope note: `App` and `EditorPanel` are not constructed in the node suites — they build a
CodeMirror `EditorView`. What they decide is therefore pinned one level down, on the panels and
the policy units they drive (`switchExperiment`, `EditorBufferStore`, `ControlPanel`,
`ParametersPanel`), plus a manual browser verification of the assembled shell (both experiments
boot, the switcher persists and reloads, the pump runs the manual's S/R program from the
control strip and from the 3D console, the railway shell returns unchanged, zero console
errors).

---

*End of architecture. Change control: edits to §5 (interfaces), §7 (schemas) or §8 (mapping
rules) require updating this file in the same PR as the code change.*
