# Start-seat guard (D19) — design, all three guards shipped

**Status:** guards 1 and 2 shipped with the first draft of this document; guard 3 was
held back as an owner decision (it changes chooser semantics that
`tests/plant/startTracks.test.ts` and §10.1 pinned) and was **accepted by the owner on
2026-08-01** — "also do guard (a), ignore the 'middle of the track'". All three are now
built ✅; the binding rule lives in ARCHITECTURE.md §10.1, this file keeps the decision
history.

## The trap (user report 2026-08-01, diagnosed the same day — REVIEW_SCENE.md D19)

Report: with the Gruppe B solution loaded, "the train does not turn into BH3 G2 at the
start, goes direct to BH2". The solution and the simulator are both correct; the seat was
wrong, and two UX traps put it there:

1. **The start-track chooser seats mid-lane, past the lane's own trigger reed.** On
   BH1 G4 (edge `e43`, 1222.6 mm) the middle is 611.3 mm — beyond reed `xR03BH1G4` at
   346.8 mm, the B-NW3 trigger. Seated there, networks 3/4 never fire on lap 1 and the
   train runs through the C area directly to BH2 G3. Measured with a three-seat experiment
   through `tests/oracle/scenarioRunner.ts`; the pinned exercise seat (`e43` @ 100 mm) is
   the control that behaves correctly.
2. **A reload silently reverts the seat.** The editor buffer comes back from
   `localStorage`, but `seatedExerciseId` was runtime-only, so F5 put the loco back on the
   §7.1 default start (Gruppe A's seat) while the student kept working on Gruppe B.

## Constraints

- **D13 single-state rule** (§10.1): the chooser renders the seat the HOST reports, never
  its own click, and the live plant must not disagree with what the graded check runs
  replay. Any guard must go through the existing host paths, not around them.
- **§7.1 exercise seats stay pinned**: opening a network seats `exerciseStarts` exactly —
  that is what "Run checks" and the oracle suites replay. No guard may move them.
- `tests/plant/startTracks.test.ts` and §10.1 pin the chooser's "middle of the lane"
  semantics; changing them is an owner decision, not a patch.

## Guard 1 ✅ — visible mismatch note (ControlPanel)

When an exercise network is OPEN and the host-reported seat does not carry that exercise's
provenance, the chooser shows a visible note: the live run can differ from the graded
checks; re-open the network to re-seat.

- Derived state only: note = f(host-reported `SeatedTrack.exerciseId`, open exercise id).
  The panel never concludes anything from its own clicks — the D13 rule extended to one
  more pixel. It also covers the sneaky same-lane case: a chooser pick of BH1 G4 shows the
  same "BH1 G4" as the pinned Gruppe B seat, but its provenance is gone, so the note fires.
- Appears when: exercise open ∧ (seat provenance ≠ that exercise ∨ seat on plain line).
  Hidden when no exercise is open (e.g. after a reload, or "All networks").
- `.start-note[hidden] { display: none }` counter-rule pinned in the stylesheet test half —
  the WatchPanel filter lesson (a class display rule silently beats the UA `[hidden]`).

## Guard 2 ✅ — the seat survives a reload (`mat2sps.seat.v1`)

The last seat-changing action is persisted and re-applied at boot **through the same
pinned resolutions** the live actions use:

- `host.setExercise` success → `{ "kind": "exercise", "exerciseId": … }`;
  `host.setStartTrack` success → `{ "kind": "track", "stationKey": …, "laneKey": … }`.
- Boot restore resolves `exercise` via `startForExercise` (the §7.1 pinned offset — byte
  for byte what a check run replays, so D13 cannot be violated by construction) and
  `track` via `startSpecForTrack` (the same deterministic chooser spec the student chose —
  since guard 3 that is the upstream-of-first-wired-reed seat, not the mid-lane one).
- Reading is total (`parseStoredSeat`): a malformed entry costs the restore, never the
  boot — same contract as `parsePumpParams` (§13.4). An exercise id the trackplan does
  not pin is REJECTED rather than resolved to the default: `startForExercise` would seat
  Gleis 1 while the chooser claimed the stored id as provenance — a lying display.
- No debounce: seat changes are rare, discrete actions (unlike parameter drags).

## Guard 3 ✅ — chooser seats upstream of the lane's first wired reed (accepted 2026-08-01)

Proposal (as accepted): `startSpecForTrack` seats at `min(length/2, firstReedOffsetIU −
margin)` instead of blindly `length/2`, where `firstReedOffsetIU` is the first WIRED reed
of that lane in the IU travel direction; floored 100 mm from the lane end (the §7.1 seat
convention). Margin = 100 mm = 20× the reed closure radius. Shipped values for all 12
lanes, plus the driven-plant no-skip measurement and the retired-mid-seat control, are
pinned in `tests/plant/startTracks.test.ts`; the survey and the trade-offs below are the
decision record.

**Pro:** removes trap 1 at the source, for every lane — a chooser seat can then never sit
past the trigger reed of its own lane, whatever exercise is loaded.

**Contra / open questions (why this needs the owner):**

- It changes semantics that are pinned three ways: `tests/plant/startTracks.test.ts`
  ("middle of the lane edge, 0,5 mm"), §10.1 ("seats the loco in the MIDDLE"), and the
  DE/EN chooser title strings ("Mitte des Gleises" / "middle of it") that students read.
- "First reed" must be direction-aware and surveyed across all 12 lanes before the rule
  is trusted (reed offsets near a lane end would push the seat toward the edge boundary;
  the margin must respect `Plant.setStart` validation and switch clearance).
- The margin is a new magic number with no plant reality behind it.
- Students lose the simplest possible mental model — "the loco stands in the middle of
  the track I picked" — for a rule they cannot see.
- **Variant worth weighing instead:** only when the chosen lane IS a §7.1 exercise lane,
  seat the pinned exercise offset (BH1 G4 → `e43` @ 100 mm) instead of the middle.
  Smaller blast radius and it kills the reported trap exactly, but the "middle" contract
  and the provenance rules still change, and BH1 G1 (default/Gruppe A) would need the
  same treatment for symmetry.

**Recommendation at draft time was to hold; the owner took it anyway** (2026-08-01),
resolving the contra points as follows: the pinned tests were rewritten as a deliberate
double edit (literal per-lane offsets + independent raw-json re-derivation + driven-plant
measurement); the 12-lane survey ran and found no seat that spawns inside a reed window
(tightest case BH2 G3: 13,4 mm gap vs 5 mm closure radius); the margin/floor reuse the
§7.1 seat convention (100 mm) rather than inventing a new constant; and the "middle of
the track" wording in the chooser titles (EN/DE) was replaced. The variant (pin exercise
lanes to their §7.1 offsets) was NOT taken — the uniform rule needs no per-lane cases.

## What each guard addresses

| | Trap 1 (mid-lane past reed) | Trap 2 (reload reverts seat) |
|---|---|---|
| Guard 1 note ✅ | makes it visible while an exercise is open | — (no exercise open after reload) |
| Guard 2 persistence ✅ | — | removes it |
| Guard 3 chooser change ✅ | removes it | — |
