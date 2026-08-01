# Scene editor (M3) — design DRAFT for owner review

**Status: DRAFT.** This is the proposed ARCHITECTURE.md §14. It is deliberately a separate
file: the owner reviews it, and only then does it get merged into the binding spec — the
same discipline the section itself prescribes for data changes. Nothing in here overrides
§11's M3 sketch; it refines it into buildable increments.

Increment 1 (the G/R flip slice, shipped with this draft) is marked ✅; everything else is
design-ahead and NOT built yet.

## 14.1 Why an editor, and why owner-facing

Two recorded debts can only be settled by a human with real-plant knowledge, not by more
research (owner decision 2026-07-27 — the placement hunt is CLOSED):

- **Five coin-flip G/R→branch mappings** (`xW01BH2G1`, `xW01BH2G4`, `xW01E`, `xW02E`,
  `xW03E`) plus `xW04D` (trailing evidence conflicts, pinned by the Gruppe-A expectations):
  `mappingSource: "assumed"` — G/R polarity is arbitrary per switch (§8, binding), so only a
  pulse test at the real plant can decide them.
- **Seven unplaced switches** (`xW01C`, `xW01/04BH1G3`, `xW01/04BH1G4`, `xW01/04BH3G2`):
  in the Variablenliste but not drawn on the Gleisplan; command → `W-SWI-001` warning. They
  need someone to *place* them where the real plant has them.

The editor is therefore an **owner instrument**, not a student feature: students must never
stumble into a mode that mutates the plant model they are being graded against.

## 14.2 Activation: URL flag, no persistent state

Editor mode activates only via the URL query `?editor=1`
(`readEditorFlag(location.search)`, `src/ui/editorFlag.ts` ✅). Rationale, in order:

1. **Works in the shipped `dist/index.html` without a rebuild** — the owner uses the same
   double-clickable file as everyone else (`file:///…/index.html?editor=1` works; browsers
   pass query strings on `file://`).
2. **Invisible to students by default** and not discoverable by clicking around — there is
   no UI control that turns it on.
3. **Not persistent** — unlike a `localStorage` flag it cannot leak into a later session by
   accident; closing the tab ends editor mode. (Contrast `mat2sps.experiment`, which SHOULD
   persist — the mechanisms differ because the requirements differ.)

A dev-only Vite flag was rejected: the owner's machine runs the dist build, not the dev
server, and a flag compiled out of dist would be useless exactly where it is needed.

Binding rule (inherited from §13): **with the flag off, the railway path is byte-for-byte
unchanged** — no editor DOM mounts, no listeners attach, no behavior differs. Tests pin the
flag-off control.

## 14.3 Increment 1 ✅ — flip a placed switch's G/R mapping

The smallest slice that produces a real, reviewable data change:

- **Pick**: in editor mode, clicking a switch in the 3D view selects it
  (`SceneManager.pickSwitchAt(x, y)` — a `THREE.Raycaster` over the switch meshes; pure
  geometry, headless-testable, no WebGL needed).
- **Inspect**: the editor panel shows id, node, toe/branch edges, `coilToBranch`,
  `mappingSource` and the recorded `mappingEvidence` — the §8 provenance is in front of the
  owner before they change anything.
- **Flip**: one action swaps the G/R branch indices **in an in-memory draft**
  (`flipCoilToBranch`, pure). The draft appends a fixed marker to `mappingEvidence` so a
  patched file is self-documenting; `mappingSource` is NOT silently changed — settling it
  (assumed → derived, with pulse-test evidence) is the owner's edit, prompted by the note.
  The `(xW)` stump (`coilToBranch: null`, not commandable) is rejected.
- **Export**: "Download patched trackplan.json" serializes the draft as a **drop-in
  replacement** for `src/data/trackplan.json`. The editor **never writes into `src/`** —
  the patch travels through the owner's hands, gets diffed, and lands as a reviewed commit.
- **Note**: for every flipped switch the panel shows (and offers as a download) a written
  note of which oracle-expectation entries the flip would move — see 14.4.

## 14.4 The double-edit discipline (binding)

`tests/oracle/expectations/gruppeA.json` / `gruppeB.json` are **pinned ground truth** —
task-derived event tables, hardened by a mutation survey. A `coilToBranch` flip and the
expectation tables must move **together, in one reviewed commit**:

- A **trailed-only** switch (today: `xW04D`, count 2 in Gruppe A) is constrained *only* by
  the `trailedSwitches` multiset — flip the mapping and exactly those entries move.
- A **faced, `derived`** switch contradicts recorded route evidence when flipped: the
  replayed run diverges, and reed/stop/speed entries after the first faced traversal move.
  The editor warns loudly; this is almost always a data bug, not a fix.
- A **never-referenced** switch (the five coin-flips) moves **no** expectation entry — the
  flip is oracle-invisible, which the note states explicitly (that is *why* they are
  coin-flips).

**Regenerating an expectation table requires the owner's sign-off per fix.** The editor
therefore only *reports* what would move — it never rewrites expectations. So that the
editor can know what to report without `src/` importing `tests/`, a generated index
(`src/data/oracleSwitchIndex.json`, built by `tools/gen-oracle-switch-index.ts` ✅) mirrors
the per-switch references; a consistency test regenerates it from the real expectation
files on every gate run and fails on any drift, with a mutation control — pinned
duplication, never silent.

## 14.5 Later increments (design-ahead, not built)

1. **Apply-in-place**: rebuild `Plant` + `SceneManager` from the draft (< 50 ms, §11) so a
   flip is immediately drivable in the same tab. Requires the shared validator first:
   extract `tools/validate-trackplan.ts` logic into `plant/validate.ts` (§11) and run it on
   every draft before it reaches a constructor.
2. **Place an unplaced switch**: select one of the seven from a list → click a `plain`
   node with exactly 3 incident edges (the validator's switch invariant) → choose toe edge
   and branch order → the draft gains the switch entry; same patch/note route. Placement does
   NOT touch expectations (none of the seven is commanded by either task — verified), but
   the note says so per switch, from the same generated index.
3. **Place/move a reed**: click an edge position (raycast to the nearest edge, offset in
   mm along its polyline); `wired` stays governed by `variables.json`.
4. **Node/edge geometry editing** is explicitly OUT of scope for M3 increments 1–3: §7.1
   geometry is Gleisplan-derived and D9-smoothed; the editor must not invite freehand
   redrawing of surveyed data.

## 14.6 Test obligations (per increment, project rule)

Every editor behavior ships with falsifiable tests plus controls: the flag-off control
(no editor DOM, no listeners), pick hit + miss controls, flip changes exactly one switch
(deep-equal control on the rest), zero-flip export deep-equals the source plan (identity
control), note content per constraint class (trailed / derived / invisible), and the
index-vs-expectations consistency test with a mutation control.
