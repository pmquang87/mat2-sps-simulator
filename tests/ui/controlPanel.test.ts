/**
 * Start-track chooser in the real `ControlPanel` (ARCHITECTURE.md §10.1).
 *
 * The binding rule is D13's: the chooser renders the seat the HOST reports, never its own
 * click. Opening a Gruppe A/B network re-seats the loco too (§7.1 `exerciseStarts`), and a
 * host that refuses a seat must leave the previous one on screen — so the panel may not
 * treat a click as an accomplished fact.
 *
 * Built against `tests/ui/support/fakeDom.ts` rather than jsdom (not a dependency here, see
 * tests/ui/layout.test.ts): the panel under test is the shipped one, and the options come
 * from the shipped trackplan through `startTrackOptions`, so a renamed station or a lane
 * that stops being derivable fails here too.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import trackplanJson from '../../src/data/trackplan.json';
import type { TrackplanFile } from '../../src/plant';
import { startTrackOptions } from '../../src/scene';
import { de } from '../../src/ui/i18n/de';
import { en } from '../../src/ui/i18n/en';
import { setLocale } from '../../src/ui/i18n/i18n';
import {
  choose,
  installFakeDocument,
  optionValues,
  selects,
  walk,
  type FakeElement,
} from './support/fakeDom';

const plan = trackplanJson as unknown as TrackplanFile;
const startTracks = startTrackOptions(plan);

let uninstall: (() => void) | null = null;

beforeAll(() => {
  uninstall = installFakeDocument();
});

afterAll(() => {
  uninstall?.();
  setLocale('en');
});

interface Harness {
  panel: {
    setSeatedTrack(seat: { stationKey: string; laneKey: string; exerciseId?: string } | null): void;
    setOpenExercise(exerciseId: string | null): void;
    setEnabled(enabled: boolean): void;
    retranslate(): void;
  };
  station: FakeElement;
  lane: FakeElement;
  field: FakeElement;
  /** The D19 seat-mismatch note; `undefined` until the guard is built. */
  note: FakeElement | undefined;
  chosen: { stationKey: string; laneKey: string }[];
}

/** Build the shipped ControlPanel over the stub and pick the chooser's two selects out. */
async function build(): Promise<Harness> {
  const { ControlPanel } = await import('../../src/ui/panels/ControlPanel');
  const chosen: { stationKey: string; laneKey: string }[] = [];
  const panel = new ControlPanel({
    onRun: () => undefined,
    onStop: () => undefined,
    onReset: () => undefined,
    onScanIntervalChange: () => undefined,
    onTimeScaleChange: () => undefined,
    onNotausChange: () => undefined,
    onCameraModeChange: () => undefined,
    startTracks,
    onStartTrackChange: (ref) => chosen.push({ ...ref }),
    onLabelsChange: () => undefined,
    onForceInput: () => true,
    onResetLayout: () => undefined,
  });
  const root = panel.element as unknown as FakeElement;
  const field = walk(root).find((node) => node.className.includes('field-start-track'));
  if (field === undefined) throw new Error('start-track field missing from the ControlPanel');
  const [station, lane] = selects(field);
  if (station === undefined || lane === undefined) {
    throw new Error('start-track chooser must offer a station and a track select');
  }
  const note = walk(root).find((node) => node.className.includes('start-note'));
  return { panel, station, lane, field, note, chosen };
}

beforeEach(() => {
  setLocale('en');
});

describe('start-track chooser — what it offers', () => {
  it('offers every station of the trackplan, and that station\'s tracks in numeric order', async () => {
    const { station, lane } = await build();
    expect(optionValues(station)).toEqual(['BH1', 'BH2', 'BH3']);
    expect(station.value).toBe('BH1');
    // numeric, not reed-declaration order — the student reads the Gleisplan as G1…G4
    expect(optionValues(lane)).toEqual(['G1', 'G2', 'G3', 'G4']);
  });

  it('marks dead-end tracks, where IU parks the loco against the buffer', async () => {
    const { panel, lane } = await build();
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G1' });
    const g5 = lane.childNodes.find((o) => o.value === 'G5');
    expect(g5?.textContent).toContain(en['controls.startLaneDeadEnd']);
    const g1 = lane.childNodes.find((o) => o.value === 'G1');
    expect(g1?.textContent).toBe('G1');
  });

  it('is keyboard operable and labelled (two native selects in a labelled group)', async () => {
    const { station, lane, field } = await build();
    expect(station.tagName).toBe('select');
    expect(lane.tagName).toBe('select');
    expect(field.getAttribute('role')).toBe('group');
    expect(field.getAttribute('aria-label')).toBe(en['controls.startTrack']);
  });

  it('disables both selects when the simulation core is unavailable', async () => {
    const { panel, station, lane } = await build();
    panel.setEnabled(false);
    expect(station.disabled).toBe(true);
    expect(lane.disabled).toBe(true);
    panel.setEnabled(true);
    expect(station.disabled).toBe(false);
    expect(lane.disabled).toBe(false);
  });
});

describe('start-track chooser — it renders the STATUS, not the click (D13)', () => {
  it('follows a seat the host reports', async () => {
    const { panel, station, lane } = await build();
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });
    expect(station.value).toBe('BH2');
    expect(optionValues(lane)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    expect(lane.value).toBe('G3');
  });

  it('reports a track choice to the host', async () => {
    const { panel, lane, chosen } = await build();
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });
    choose(lane, 'G5');
    expect(chosen).toEqual([{ stationKey: 'BH2', laneKey: 'G5' }]);
  });

  it('shows the OLD seat again when the host refuses the choice', async () => {
    const { panel, station, lane, chosen } = await build();
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });

    choose(lane, 'G5');                        // the click
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });  // …the host did not move

    expect(chosen).toEqual([{ stationKey: 'BH2', laneKey: 'G5' }]);
    expect(station.value).toBe('BH2');
    expect(lane.value).toBe('G3');
  });

  it('picking a station seats its first track (a station alone is not a seat)', async () => {
    const { panel, station, lane, chosen } = await build();
    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G1' });
    choose(station, 'BH3');
    expect(chosen).toEqual([{ stationKey: 'BH3', laneKey: 'G1' }]);
    expect(optionValues(lane)).toEqual(['G1', 'G2', 'G3']);
  });

  it('re-renders the OLD station when the host refuses a station pick', async () => {
    const { panel, station, lane, chosen } = await build();
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });

    choose(station, 'BH3');                    // the click (lane list flips optimistically)
    expect(chosen).toEqual([{ stationKey: 'BH3', laneKey: 'G1' }]);
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });  // …the host did not move

    expect(station.value).toBe('BH2');
    expect(optionValues(lane)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    expect(lane.value).toBe('G3');
  });

  /** Opening a network of the other Aufgabenstellung re-seats the loco — the chooser moves
   *  with it although nobody touched it (the D13 defect was that it did not). */
  it('moves when an exercise re-seat happens elsewhere', async () => {
    const { panel, station, lane, chosen } = await build();
    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G1', exerciseId: 'gruppeA' });
    expect(lane.value).toBe('G1');

    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G4', exerciseId: 'gruppeB' });

    expect(station.value).toBe('BH1');
    expect(lane.value).toBe('G4');
    expect(chosen).toEqual([]);                // the chooser was never clicked
  });

  it('deselects both selects when the loco is not on a station track', async () => {
    const { panel, station, lane } = await build();
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G4' });
    panel.setSeatedTrack(null);
    // a visibly unnamed seat — not a stale claim about a track the loco is not on
    expect(station.value).toBe('');
    expect(lane.value).toBe('');
  });
});

describe('start-track chooser — localization (§5.6)', () => {
  it('labels the two selects in the active locale, EN by default', async () => {
    const { panel, field } = await build();
    const labelTexts = (): string[] => walk(field)
      .filter((node) => node.className.includes('field-label'))
      .map((node) => node.textContent);

    expect(labelTexts()).toEqual([en['controls.startStation'], en['controls.startLane']]);

    setLocale('de');
    panel.retranslate();
    expect(labelTexts()).toEqual([de['controls.startStation'], de['controls.startLane']]);
    expect(field.getAttribute('aria-label')).toBe(de['controls.startTrack']);
  });

  it('names the exercise provenance in the field tooltip only when there is one', async () => {
    const { panel, field } = await build();
    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G1' });
    expect(field.title).toBe(en['controls.startTrackTitle']);

    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G4', exerciseId: 'gruppeB' });
    expect(field.title).toContain(en['controls.startTrackFromExercise']);
  });
});

/**
 * D19 seat-mismatch note. The trap it guards: "Run checks" always replays the OPEN
 * exercise's §7.1 pinned start, but the live plant can be seated elsewhere (a chooser
 * pick, a refused re-seat) — and the divergence used to be silent, because the chooser's
 * station/track display cannot distinguish a chooser seat from the pinned seat on the
 * SAME lane. The note derives from host-reported provenance × open exercise only — the
 * D13 single-state rule extended by one pixel; no click is ever concluded from.
 */
describe('start-track chooser — seat-mismatch note (D19)', () => {
  it('exists as a status region, hidden AND empty until an exercise is open', async () => {
    const { note } = await build();
    expect(note).toBeDefined();
    expect(note?.hidden).toBe(true);
    expect(note?.getAttribute('role')).toBe('status');
    // empty while hidden: a role="status" live region announces CONTENT changes, so the
    // text is written at show time — a bare `hidden` flip is missed by screen readers
    expect(note?.textContent).toBe('');
  });

  it('appears when the seat lost the open exercise\'s provenance — same-lane trap included', async () => {
    const { panel, note } = await build();
    panel.setOpenExercise('gruppeB');
    // the chooser pick shows the same "BH1 G4" as the pinned Gruppe B seat, but its offset
    // is the chooser's, not the pinned one, and the provenance is gone — the D19 report
    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G4' });
    expect(note?.hidden).toBe(false);
    expect(note?.textContent).toBe(en['controls.seatMismatch']);
  });

  it('stays hidden while the seat carries the open exercise\'s provenance (either order)', async () => {
    const { panel, note } = await build();
    panel.setSeatedTrack({ stationKey: 'BH1', laneKey: 'G4', exerciseId: 'gruppeB' });
    panel.setOpenExercise('gruppeB');
    expect(note?.hidden).toBe(true);
  });

  it('appears for a plain-line seat while an exercise is open', async () => {
    const { panel, note } = await build();
    panel.setOpenExercise('gruppeA');
    panel.setSeatedTrack(null);
    expect(note?.hidden).toBe(false);
  });

  it('hides again when no exercise is open — a reload or "All networks"', async () => {
    const { panel, note } = await build();
    panel.setOpenExercise('gruppeB');
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });
    expect(note?.hidden).toBe(false);
    panel.setOpenExercise(null);
    expect(note?.hidden).toBe(true);
  });

  it('retranslates without losing its visibility state', async () => {
    const { panel, note } = await build();
    panel.setOpenExercise('gruppeB');
    panel.setSeatedTrack({ stationKey: 'BH2', laneKey: 'G3' });
    setLocale('de');
    panel.retranslate();
    expect(note?.textContent).toBe(de['controls.seatMismatch']);
    expect(note?.hidden).toBe(false);
  });
});

describe('seat-mismatch note — stylesheet half (the WatchPanel filter lesson)', () => {
  it('styles.css carries the [hidden] counter-rule the note needs', () => {
    // fakeDom cannot compute styles: a class display rule beats the UA sheet's
    // `[hidden] { display: none }` (both 0-1-0, author sheet wins), so the counter-rule
    // must exist as text or the attribute half is invisible on screen.
    const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.start-note\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});
