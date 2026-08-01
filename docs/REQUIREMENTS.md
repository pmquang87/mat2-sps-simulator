# MAT2 SPS 3D-Simulation — Requirements (from user)

Recorded 2026-07-26 from the project owner's instructions.

## Product
- 3D simulation of the TU Dresden MAT2 SPS-Praktikum (model railway, Siemens S7-300, AWL/STL), **as close to the original installation as possible**.
- **Easy to install and easy to maintain.**
- **Pedagogical tool**: many hints and examples, oriented so students learn to solve the exercises independently (not a solution dispenser).

## Language / i18n
- **UI default language: English.**
- **Toggle button to switch to German.** (All UI strings must go through an i18n layer from day one; exercise texts exist in German — provide English translations where shown in-app.)

## Milestones
1. **M1**: Replicate all SPS functions used in the experiment (AWL subset from Gruppe A/B exercises + Anleitung: U, UN, O, =, S, R, FP/FN, S5 timers SE/SV…, FB/DB/OB1 cycle, E/A/M/T addressing, 300 ms switch time, speeds via M120.x → AW 6).
2. **M2**: Add further SPS support (broader instruction set).
3. **M3**: Allow the user to edit the scene.
   - **Decision 2026-07-27 (owner):** the seven switch drives that exist in the
     Variablenliste but have no position on the Gleisplan (`xW01BH1G3`, `xW04BH1G3`,
     `xW01BH1G4`, `xW04BH1G4`, `xW01BH3G2`, `xW04BH3G2`, `xW01C`) are **left out for now**
     and stay unplaced with the existing `W-SWI-001` warning. Their placement becomes an
     **M3 feature**: the scene editor lets the user place switches and reed contacts where
     they see fit. This is the right home for it — three independent evidence streams
     established that the positions cannot be recovered from any available source (see
     `reference/research/unplaced_switches.md`), so a human who has stood at the real plant is
     the only reliable authority. The editor therefore needs: placing a switch/reed onto a
     track edge, binding it to an existing Variablenliste symbol (including the seven), and
     setting the per-switch G/R → branch mapping — which also lets the user settle the five
     placed switches whose mapping is currently a documented coin flip.

## Testing policy
- Files in `reference/Claude_work\` are solutions from another session: **use as test oracles only — must NOT be included/shipped in the final program.**

## Sources
- NotebookLM notebook "SPS Railway Logic and Track Plan Variables" (12 sources = local PDFs/txt).
- Video "SPS Practicum" https://www.youtube.com/watch?v=jOShbi0qjX4 (design reference).
- Sources managed in Zotero collection "MAT2 SPS-Praktikum".
