/**
 * English dictionary (ARCHITECTURE.md §5.6) — source of truth for the MsgKey type.
 * English is the default locale (§1). Add keys here first; tsc then forces the German
 * dictionary (de.ts) to stay total.
 *
 * Placeholders use {name} and are filled by t(key, params).
 */
export const en = {
  // ── shell ────────────────────────────────────────────────────────────────
  'app.title': 'MAT2 SPS 3D Simulator',
  'app.subtitle': 'AWL (STL) emulator with a 3D model railway plant',
  'app.subtitlePump': 'AWL (STL) emulator with the manual’s 3D pump plant',
  'app.loading': 'Loading…',
  'lang.label': 'Language',
  'lang.en': 'EN',
  'lang.de': 'DE',
  'lang.switchTo': 'Switch interface language to {lang}',

  // ── experiment switcher ──────────────────────────────────────────────────
  'experiment.label': 'Experiment',
  'experiment.railway': 'Model railway',
  'experiment.pump': 'Pump',
  'experiment.switchTo': 'Switch to the {name} experiment — the page reloads; each experiment keeps its own program',

  // ── status line ──────────────────────────────────────────────────────────
  'status.ready': 'Ready',
  'status.running': 'Running',
  'status.paused': 'Stopped',
  'status.simTime': 'Sim time {value} s',
  'status.cycle': 'Cycle {value}',
  'status.scan': 'Scan {value} ms',
  'status.noProgram': 'No program loaded',
  'status.programLoaded': 'Program loaded ({count} instructions)',
  'status.programErrors': 'Program not loaded — {count} error(s)',
  'status.notausActive': 'EMERGENCY STOP active',
  'status.derailed': 'Train derailed — reset required',
  'status.simUnavailable': 'Simulation core unavailable: {reason}',
  'status.dataMissing': 'Plant data (src/data) not available yet — the 3D plant stays empty.',

  // ── editor ───────────────────────────────────────────────────────────────
  'editor.title': 'AWL program',
  'editor.load': 'Load into PLC',
  'editor.loadTitle': 'Parse the program and transfer it to the emulator (Ctrl+Enter)',
  'editor.dirty': 'unsaved changes',
  'editor.saved': 'in sync with PLC',
  'editor.symbols': '{count} symbols available for completion',
  'editor.symbolsNone': 'symbol list unavailable — completion limited to mnemonics',
  'editor.clear': 'Clear',
  'editor.clearTitle': 'Empty the editor',
  'editor.label': 'AWL source code',

  // ── completion / editor hints ────────────────────────────────────────────
  'completion.mnemonic': 'instruction',
  'completion.symbol': 'symbol',
  'completion.address': 'address',
  'completion.literal': 'literal',

  // ── diagnostics ──────────────────────────────────────────────────────────
  'diagnostics.title': 'Messages',
  'diagnostics.none': 'No messages.',
  'diagnostics.error': 'Error',
  'diagnostics.warning': 'Warning',
  'diagnostics.info': 'Note',
  'diagnostics.at': 'Line {line}, column {col}',
  'diagnostics.hint': 'Hint',
  'diagnostics.jumpTo': 'Show in editor',
  'diagnostics.summary': '{errors} error(s), {warnings} warning(s)',

  // ── controls ─────────────────────────────────────────────────────────────
  'controls.title': 'Controls',
  'controls.run': 'Run',
  'controls.runTitle': 'Start the cyclic scan',
  'controls.stop': 'Stop',
  'controls.stopTitle': 'Halt the scan (state is kept)',
  'controls.reset': 'Reset',
  'controls.resetTitle': 'Reset PLC memory, timers, counters and the plant',
  'controls.scan': 'Scan interval',
  'controls.scanTitle': 'Simulated PLC cycle time',
  'controls.speed': 'Time scale',
  'controls.speedTitle': 'Speed up or slow down simulated time',
  'controls.notaus': 'EMERGENCY STOP',
  'controls.notausTitle': 'Latching button: E 1.7 (NotausBit) goes to 0 — your program must stop the train',
  'controls.notausRelease': 'Release',
  'controls.startTrack': 'Start track',
  'controls.startTrackTitle': 'Where the loco stands — choosing a track resets the plant and seats the loco so the track’s reed contacts lie ahead where possible, facing the IU direction',
  'controls.startTrackFromExercise': 'currently on the start track of the assignment you opened',
  'controls.startStation': 'Station',
  'controls.startStationTitle': 'Station the loco starts in',
  'controls.startLane': 'Track',
  'controls.startLaneTitle': 'Track of that station the loco starts on',
  'controls.startLaneDeadEnd': 'dead end',
  'controls.seatMismatch': 'The loco is not on the start position of the opened assignment — a live run from here can differ from the graded checks. Open the network again to re-seat it.',
  'controls.camera': 'Camera',
  'controls.labels': 'Labels',
  'controls.labelsTitle': 'Show the white xW…/xR… name plates in the 3D view',

  // ── resizable layout (§5.7) ──────────────────────────────────────────────
  'layout.title': 'Layout',
  'layout.reset': 'Reset layout',
  'layout.resetTitle': 'Restore the default panel sizes',
  'layout.splitterHint': 'Drag, or use the arrow keys (Shift = larger step). Double-click, Home or End restores the default.',
  'layout.splitter.toolsCentre': 'Resize: exercises column / program column',
  'layout.splitter.centreRight': 'Resize: program column / 3D view column',
  'layout.splitter.editorMessages': 'Resize: AWL program / messages',
  'layout.splitter.viewportWatch': 'Resize: 3D plant / watch table',

  // ── "Try it" input forcing (§10.3) ───────────────────────────────────────
  'inputs.title': 'Try it: inputs',
  'inputs.note': 'Click to force an input bit of the loaded program, click again to release. A forced bit keeps its value even when a reed contact would drive it — that is how the manual’s timer and edge examples run without the railway.',
  'inputs.toggleTitle': 'Force {address} in the process image (PAE) — click again to release',
  'inputs.notePump': 'Click to force an input bit of the loaded program, click again to release. A forced bit keeps its value even when a level switch or a button would drive it — handy for trying a branch the tanks are not in right now.',

  // ── the plant’s own controls, as keyboard-reachable DOM (§ Experiments) ───
  'plant.title': 'Plant controls',
  'plant.note': 'The same controls as on the 3D console, operable with Tab and the keyboard. S1 and S0 are momentary: they stay pressed only while you hold them. The switches and the hand valves latch.',
  'plant.holdTitle': 'Hold to press {name} — mouse button or Space; it releases as soon as you let go',
  'plant.toggleTitle': 'Switch {name} on or off',
  'plant.valve.inA': 'Refill valve → tank A',
  'plant.valve.outB': 'Drain valve ← tank B',

  // ── course-template normalization (§5.1.5 I-TPL-001 / W-TPL-001) ─────────
  'template.detected': 'Course template recognized: {networks} network(s) found, {instructions} instruction(s) compiled, {ignored} line(s) of task text ignored. Your file stays exactly as you wrote it — only the sections after "--Bitte hier programmieren--" are loaded into the PLC.',
  'template.cleaned': 'Loaded {instructions} instruction(s). {ignored} template line(s) — separator rules, bare "Netzwerk n" headers, point totals — were not compiled as instructions.',
  'template.stray': 'Line ignored: "{text}" looks like an instruction but lies outside a "--Bitte hier programmieren--" section and was not loaded.',
  'template.strayHint': 'Move this line below the "--Bitte hier programmieren--" marker of its network, or delete the separator line above it.',

  // ── runtime warnings raised by the coordination layer ────────────────────
  'runtime.unplacedSwitch': 'Switch {switchId} is not placed on this board model — the coil command ({coil} coil) has no effect.',
  'runtime.unplacedSwitchHint': 'The symbol exists in the Variablenliste, but the track plan has no such switch. Use a switch that is present on the board.',

  // ── cameras (§5.4) ───────────────────────────────────────────────────────
  'camera.orbit': 'Orbit',
  'camera.bird': 'Bird',
  'camera.cab': 'Cab',
  'camera.trackside': 'Trackside',

  // ── viewport ─────────────────────────────────────────────────────────────
  'viewport.title': '3D plant',
  'viewport.unavailable': '3D view unavailable: {reason}',

  // ── watch table (§10.4) ──────────────────────────────────────────────────
  'watch.title': 'Watch table',
  'watch.name': 'Symbol',
  'watch.address': 'Address',
  'watch.value': 'Value',
  'watch.empty': 'No rows.',
  'watch.unavailable': 'Watch values unavailable: {reason}',
  'watch.filter': 'Filter',
  'watch.filterPlaceholder': 'Symbol or address…',
  'watch.section.inputs': 'Inputs E (reeds, emergency stop)',
  'watch.section.output': 'Output word (Fahrstrom)',
  'watch.section.system': 'System flags (speed / STOP / Notaus edge)',
  'watch.section.coils': 'Switch coils M 100 – M 111',
  'watch.section.student': 'Student flags M 10 – M 20',
  'watch.section.timers': 'Timers T 10 – T 20',
  'watch.section.counters': 'Counter Z 1',
  'watch.section.pumpInputs': 'Inputs E (buttons, level switches, toggles)',
  'watch.section.pumpOutputs': 'Outputs A (pump, indicator lamps)',
  'watch.section.pumpFlags': 'Flags M 0 – M 20 (manual uses M 0.0)',
  'watch.timer': '{remaining} / {preset} ms',
  'watch.counter': 'count {value}',
  'watch.q': 'Q',
  'watch.bitsHint': 'bit 7 … bit 0',

  // ── plant details ────────────────────────────────────────────────────────
  'switch.assumedMapping': 'Assumed wiring: G/R → branch mapping is not documented for this switch, so it was chosen consistently. G and R never imply a route direction.',

  // ── side tabs ────────────────────────────────────────────────────────────
  'tabs.exercises': 'Exercises',
  'tabs.hints': 'Hints',
  'tabs.examples': 'Examples',
  'tabs.parameters': 'Parameters',

  // ── static task document (pump experiment) ───────────────────────────────
  'task.title': 'Task',
  'task.note': 'This experiment is not graded. It is the manual’s teaching example, so every instruction can be tried on a live plant — start, stop, refill and drain by hand in the 3D view.',

  // ── plant parameters (pump experiment) ───────────────────────────────────
  'params.title': 'Plant parameters',
  'params.unavailable': 'Plant parameters unavailable: {reason}',
  'params.note': 'Rates, thresholds and the dry-run delay take effect immediately. The two initial levels apply on the next Reset.',
  'params.reset': 'Reset to defaults',
  'params.resetTitle': 'Put every parameter back to its documented default',
  'params.range': 'allowed {min} – {max} {unit}',
  'params.sliderLabel': '{label} (slider)',
  'params.valueLabel': '{label} (value)',
  'params.applyLive': 'live',
  'params.applyOnReset': 'on reset',
  'params.field.pumpRatePctS': 'Pump rate A → B',
  'params.field.refillRatePctS': 'Refill rate (valve into A)',
  'params.field.drainRatePctS': 'Drain rate (valve out of B)',
  'params.field.llsThresholdPct': 'LLS threshold (empty signal)',
  'params.field.hlsThresholdPct': 'HLS threshold (full signal)',
  'params.field.dryRunDelayS': 'Dry-run delay',
  'params.field.initialVolAPct': 'Initial level tank A',
  'params.field.initialVolBPct': 'Initial level tank B',
  'params.unit.pctPerS': '%/s',
  'params.unit.pct': '%',
  'params.unit.s': 's',

  // ── exercise browser (§10.1) ─────────────────────────────────────────────
  'exercise.title': 'Exercises',
  'exercise.unavailable': 'Exercise data unavailable: {reason}',
  'exercise.points': '{points} P',
  'exercise.status.untouched': 'new',
  'exercise.status.attempted': 'attempted',
  'exercise.status.passed': 'passed',
  'exercise.back': '← All networks',
  'exercise.taskDe': 'Task (original, German)',
  'exercise.taskEn': 'Translation (English)',
  'exercise.symbolNotes': 'Symbol note',
  'exercise.runChecks': 'Run checks',
  'exercise.runChecksTitle': 'Load your program into a fresh PLC + plant and replay this network’s check scenario (deterministic, 50 ms scan)',
  'exercise.runningChecks': 'Running checks…',
  'exercise.noProgram': 'No program loaded — write your solution in the editor and press "Load into PLC" first.',
  'exercise.checkError': 'Check run failed: {reason}',
  'exercise.results': 'Check results',
  'exercise.resultSummary': '{passed} passed · {failed} failed · {pending} not exercised',
  'exercise.result.pass': 'Pass',
  'exercise.result.fail': 'Fail',
  'exercise.result.pending': 'Not exercised',
  'exercise.allPassed': 'All checks passed — network complete!',
  'exercise.runInfo': 'The check run happens on a separate, deterministic simulation (seed fixed, scan 50 ms) — the 3D view is not affected.',

  // ── hints (§10.2) ────────────────────────────────────────────────────────
  'hints.title': 'Hints',
  'hints.noNetwork': 'Select a network in the Exercises tab to see its hints.',
  'hints.forNetwork': 'Hints for {network}',
  'hints.level': 'Hint {level} of {total}',
  'hints.levelName.1': 'Concept',
  'hints.levelName.2': 'Pattern',
  'hints.levelName.3': 'Checklist',
  'hints.show': 'Show hint',
  'hints.locked': 'Locked',
  'hints.lockedInfo': 'Unlocks after a failed check run, 5 minutes on this network, or "I’m stuck".',
  'hints.stuck': 'I’m stuck — unlock next hint',
  'hints.reference': 'Reference: {label}',
  'hints.openExample': 'Open the matching example',
  'hints.none': 'No hints available for this network.',

  // ── examples library (§10.3) ─────────────────────────────────────────────
  'examples.title': 'Examples',
  'examples.unavailable': 'Examples library unavailable: {reason}',
  'examples.source': 'Source: {source}',
  'examples.load': 'Insert into editor',
  'examples.loadTitle': 'Replace the editor content with this runnable snippet',
  'examples.copy': 'Copy',
  'examples.copyTitle': 'Copy the snippet to the clipboard',
  'examples.confirmReplace': 'Replace the current editor content with this example? Your current program will be overwritten (it stays in the browser’s undo history, Ctrl+Z).',

  // ── scene editor (owner tool, DESIGN_SCENE_EDITOR.md — activated via ?editor=1) ──
  'editor3d.title': 'Scene editor',
  'editor3d.hint': 'Click a switch in the 3D view to select it.',
  'editor3d.none': 'No switch selected.',
  'editor3d.source': 'Mapping source: {source}',
  'editor3d.mapping': 'G → {g}, R → {r}',
  'editor3d.fixed': 'This switch has no coils (fixed) — nothing to flip.',
  'editor3d.flip': 'Flip G/R mapping',
  'editor3d.flipTitle': 'Swap which branch the G and R coils throw to — in the draft only',
  'editor3d.noFlips': 'No flips yet.',
  'editor3d.flipped': 'Flipped: {list}',
  'editor3d.downloadPlan': 'Download patched trackplan.json',
  'editor3d.downloadPlanTitle': 'Full drop-in replacement for src/data/trackplan.json — review and commit it together with the expectation note',
  'editor3d.downloadNote': 'Download expectation note',
  'editor3d.downloadNoteTitle': 'Which pinned oracle-expectation entries each flip would move (double-edit discipline)',
} as const;
