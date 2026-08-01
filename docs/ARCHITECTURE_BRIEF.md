# Architecture Brief (orchestrator decisions — input for detailed design)

Date: 2026-07-26. These decisions are fixed unless the detailed design uncovers a blocker; justify any deviation explicitly.

## Stack (decided)
- **Web application, no backend.** TypeScript (strict), **Vite** build, **Three.js** for 3D, **CodeMirror 6** for the AWL editor (with autocompletion fed by the Variablenliste — deliberately mirroring the real practicum's Atom+variablen.txt workflow), **vitest** for tests.
- Runs fully client-side; `npm run build` → static `dist/` that can be opened from any static host or `npx serve`. Easy install for students = open a URL or double-click a local build. Node 24 present on dev machine.
- **i18n from day one: English default, German toggle** (runtime switch, persisted in localStorage). All UI strings via a typed dictionary; exercise texts shown in original German with EN translation panel.

## Module layout (decided)
```
src/
  core/      AWL tokenizer, parser, symbol table, S7 emulator (NO DOM imports)
  plant/     railway plant model: track graph, train, switches, reeds, Fahrstrom (NO DOM imports)
  scene/     Three.js rendering of the plant (reads plant state, never mutates it)
  ui/        panels, editor, controls, i18n
  pedagogy/  exercises (Gruppe A/B networks), hints, examples, progress checks
  data/      trackplan.json, variables.json (generated from Variablenliste.txt), exercises.json
```
Core and plant are pure logic — testable headless. One-way data flow: ui → core/plant → scene.

## Emulator semantics (from reference/research — binding)
- Cyclic scan: read process image of inputs → run user program → write outputs. Fixed simulated cycle (default 50 ms, configurable 10–200 ms), decoupled from render loop.
- VKE model with first-check (Erstabfrage) semantics; `L`/`T` VKE-neutral; two 32-bit accus.
- Instructions for **M1** (superset of what the solutions use): `U UN O ON X XN`, `= S R`, `L T`, S5 timers `SI SV SE SS SA` + `R T`/`FR`, `FP FN`, counters `ZV ZR S Z R Z FR`, compares `==I <>I >I >=I <I <=I`, jumps `SPA SPB SPBN` + labels, `NOP`; `S5T#…` and `C#…` literals; quoted symbolic operands; `//` comments. Case-sensitivity trap: `XW03CR`, `XW05BH1G3R`.
- Student resources: T10–T20, Z1…, M10.0–M20.0; system symbols per Variablenliste (STOP/Speed M120.x, NotausBit E1.7 0-active, NotausNF M121.0).
- Plant behaviors: 42 switches, coil pulse via M100–111 with 300 ms actuation; reeds = momentary closures while the loco magnet passes (+ optional bounce for the Entprellen exercise); speeds map to AW 6 word like FahrstromFB; Notaus button in UI.

## Track geometry
- Source of truth: `data/trackplan.json` — node/edge graph with 2D coordinates derived from the Gleisplan PDF overlays (960×540 pt space; switch/reed coordinates already extracted in reference/research/weichen_video.md §7). 3D scene extrudes from this plan; landscape (MFD mountains + tunnel over Gleis C/K area, Badesee, buildings) is decorative and approximate per reference/research/video_design.md.
- Per-switch G/R → geometric branch mapping is an explicit data field; derive from exercise route requirements (routes in solutions.md §8 tables); mark derived-vs-unknown per switch. Unknown mappings default to a consistent choice, flagged in data.

## Testing policy (binding)
- Unit tests: every instruction's semantics incl. edge cases (SS retrigger/reset, SV retrigger, FP one-cycle pulse, ZV same-cycle read, S/R on VKE=0).
- **Oracle tests:** scenario runner drives the plant along the Aufgabe A and B scripts; the AWL solutions are loaded **from `reference/Claude_work/` at test time only, skipped if absent, never bundled or committed** (path stays gitignored). Assertions: event sequences (speed changes, switch pulses, stops with durations) match solutions.md §8.
- Pedagogy layer must not reveal the solutions; hints reference concepts (Anleitung sections, patterns like the 300 ms SV Weichenstraße template with neutral operands) — never task-specific full solutions.

## Milestone roadmap
- **M1**: everything above, 3D scene with 4 cameras (orbit + bird + cab + trackside), exercise browser with hints, EN/DE.
- **M2**: broader AWL (arithmetic, more data ops, FB/FC/DB user blocks, OB structure), diagnostics (cycle inspector, watch table).
- **M3**: scene/track editor (edit trackplan.json in-app, place switches/reeds, save/load).
