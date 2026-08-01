/**
 * Pump scene dev harness (manual viewing only — `src/pump/scene/dev/harness.html`).
 *
 * Not part of the application bundle: `index.html` never imports it, so it is dropped from
 * `dist/`. Its purpose is the one thing the unit tests cannot judge — whether the glass, the
 * liquid columns and the falling water actually LOOK right — and it does so against the real
 * stack: `createPumpStack` (emulator + plant + wiring + coordinator) driving the real
 * `PumpScene`, with the demo program below running in the emulator.
 *
 * This file is the HOST in the layering sense, which is why it owns the rAF loop and the
 * only wall clock in `pump/` (the shipped app uses `app/RafDriver` + `app/SimClock` for
 * exactly this role). Everything below the scene stays clock-free.
 */
import { createPumpStack } from '../..';
import type { PumpSnapshot } from '../..';
import { PumpScene } from '../PumpScene';

/** The Anleitung's pump task, spelled absolutely like the manual's own snippets. */
const DEMO_PROGRAM = [
  'U E 0.0',        // S1 start
  'O A 0.1',        // Selbsthaltung
  'UN E 0.6',       // S0 stop
  'UN E 0.4',       // HLS Tank B: voll
  'UN E 0.1',       // LLS Tank A: leer
  'U E 0.5',        // LS: benetzt
  '= A 0.1',        // Pumpe
  'U E 1.0',
  '= A 0.2',
  'U E 1.1',
  '= A 0.3',
].join('\n');

const PHYSICS_STEP_MS = 10;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const stack = createPumpStack({ scanIntervalMs: 50 });
const loaded = stack.emulator.load(DEMO_PROGRAM);
const loadNote = loaded.ok
  ? 'program: pump self-hold (Anleitung IV.2.5.2)'
  : `program FAILED: ${loaded.diagnostics.map((d) => d.message.en).join('; ')}`;

const scene = new PumpScene({
  canvas,
  callbacks: {
    onButton: (id, pressed) => stack.coordinator.setButton(id, pressed),
    onToggle: (id, value) => stack.coordinator.setToggle(id, value),
    onValve: (id, open) => stack.coordinator.setValve(id, open),
  },
});

let paused = false;
let labelsOn = true;
let accMs = 0;
let lastFrameMs: number | null = null;

function resize(): void {
  scene.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (ev) => {
  const key = ev.key.toLowerCase();
  if (key === 'p') paused = !paused;
  else if (key === 'r') {
    stack.coordinator.reset();
    accMs = 0;
  } else if (key === 'l') {
    labelsOn = !labelsOn;
    scene.setLabelsVisible(labelsOn);
  } else if (key === 'a') {
    stack.coordinator.setValve('inA', !stack.coordinator.snapshot().valves.inA);
  } else if (key === 'b') {
    stack.coordinator.setValve('outB', !stack.coordinator.snapshot().valves.outB);
  } else if (key === '1') stack.coordinator.pressS1(true);
  else if (key === '0') stack.coordinator.pressS0(true);
});
window.addEventListener('keyup', (ev) => {
  if (ev.key === '1') stack.coordinator.pressS1(false);
  else if (ev.key === '0') stack.coordinator.pressS0(false);
});

function bits(snapshot: PumpSnapshot): string {
  const on = (v: boolean): string => (v ? '1' : '0');
  return [
    `E0.0 S1=${on(snapshot.buttons.S1)}  E0.6 S0=${on(snapshot.buttons.S0)}`,
    `E0.1 LLS_A=${on(snapshot.sensors.llsA)}  E0.2 HLS_A=${on(snapshot.sensors.hlsA)}`,
    `E0.3 LLS_B=${on(snapshot.sensors.llsB)}  E0.4 HLS_B=${on(snapshot.sensors.hlsB)}`,
    `E0.5 LS=${on(snapshot.sensors.ls)}   A0.1 Pumpe=${on(snapshot.actuators.pump)}`,
  ].join('\n');
}

function frame(nowMs: number): void {
  window.requestAnimationFrame(frame);
  if (lastFrameMs === null) lastFrameMs = nowMs;
  const deltaMs = Math.min(250, nowMs - lastFrameMs);
  lastFrameMs = nowMs;

  if (!paused) {
    accMs += deltaMs;
    while (accMs >= PHYSICS_STEP_MS) {
      stack.coordinator.advanceSteps(1);
      accMs -= PHYSICS_STEP_MS;
    }
  }

  const snapshot = stack.coordinator.snapshot();
  scene.update(snapshot, paused ? 0 : accMs);
  scene.render();

  hud.textContent = [
    loadNote,
    `t = ${(snapshot.timeMs / 1000).toFixed(2)} s${paused ? '  [PAUSED]' : ''}`,
    `A = ${snapshot.volAPct.toFixed(1)} %   B = ${snapshot.volBPct.toFixed(1)} %`,
    `flow pump/refill/drain = ${snapshot.flowPctS.pump.toFixed(2)} / `
      + `${snapshot.flowPctS.refill.toFixed(2)} / ${snapshot.flowPctS.drain.toFixed(2)} %/s`,
    bits(snapshot),
  ].join('\n');
}

window.requestAnimationFrame(frame);
