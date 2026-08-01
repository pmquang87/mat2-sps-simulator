/**
 * Assembly of the pump experiment's simulation stack — the one call `main.ts` needs for its
 * pump bootstrap, and the same object the tests drive. Everything here is headless: the
 * clock and the RAF driver stay with the host (`app/SimClock`, `app/RafDriver`), which is
 * what keeps this module free of wall-clock access.
 */
import { Emulator } from '../core';
import type { SymbolTable } from '../core';
import { PumpCoordinator } from './coordinator';
import type { PumpCoordinatorConfig } from './coordinator';
import { PumpPlant } from './model';
import type { PumpParams } from './params';
import { PumpEventBus } from './types';
import { buildPumpSymbols } from './variables';
import { PUMP_RESOURCE_POLICY, buildPumpWiring } from './wiring';
import type { PumpWiring } from './wiring';

export interface PumpStackConfig extends PumpCoordinatorConfig {
  /** Initial parameter patch; missing fields take the documented defaults. */
  params?: Partial<PumpParams>;
}

export interface PumpStack {
  symbols: SymbolTable;
  emulator: Emulator;
  plant: PumpPlant;
  wiring: PumpWiring;
  bus: PumpEventBus;
  coordinator: PumpCoordinator;
}

export function createPumpStack(cfg: PumpStackConfig = {}): PumpStack {
  const symbols = buildPumpSymbols();
  const wiring = buildPumpWiring(symbols);          // validates against the Anleitung map
  const emulator = new Emulator(symbols, PUMP_RESOURCE_POLICY);
  const plantCfg = cfg.params === undefined ? {} : { params: cfg.params };
  const plant = new PumpPlant(plantCfg);
  const bus = new PumpEventBus();
  const coordinatorCfg: PumpCoordinatorConfig = {};
  if (cfg.scanIntervalMs !== undefined) coordinatorCfg.scanIntervalMs = cfg.scanIntervalMs;
  if (cfg.trace !== undefined) coordinatorCfg.trace = cfg.trace;
  const coordinator = new PumpCoordinator(emulator, plant, wiring, bus, coordinatorCfg);
  return { symbols, emulator, plant, wiring, bus, coordinator };
}
