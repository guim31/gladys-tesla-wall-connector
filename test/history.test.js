// -----------------------------------------------------------------------------
// What reaches the history of Gladys: the measurements on a significant change
// only (plus once an hour), and the charging state when the car leaves.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  HISTORY_REFRESH_MS,
  HISTORY_THRESHOLDS,
  WALL_CONNECTOR_FEATURES as F,
  isSignificantChange,
} from '../src/devices/wallConnector.js';
import { createRuntime, WALL_CONNECTOR_POLL_MS } from '../src/runtime.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createMemoryStore } from './helpers/memoryStore.js';
import { WC_HOSTS, createFakeWallNetwork } from './helpers/fakeWallConnector.js';

const silent = createLogger({ level: 'silent' });
const EU = 'ext:wall-connector:wall-connector:TESTWC0000EU01';
const sequences = JSON.parse(
  readFileSync(new URL('./fixtures/single-phase/sequences.json', import.meta.url), 'utf8'),
);
const vitalsOf = (step) => ({ ...sequences.base, ...step.vitals });

async function setup() {
  const gladys = createFakeGladys();
  const net = createFakeWallNetwork();
  net.set(WC_HOSTS.EU, { vitals: vitalsOf(sequences.tesla[0]) });
  const clock = { t: Date.parse('2026-10-11T00:00:00Z') };
  const runtime = createRuntime({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    wallClientFactory: net.factory,
    now: () => clock.t,
  });
  await runtime.start(normalizeConfig({ wall_connectors: WC_HOSTS.EU }));
  gladys.createAll();
  for (const device of gladys.devices) await runtime.deviceCreated(device);
  const read = async (vitals, ms = WALL_CONNECTOR_POLL_MS) => {
    net.set(WC_HOSTS.EU, { vitals });
    clock.t += ms;
    await runtime.pollWallConnectors();
  };
  const count = (key) =>
    gladys.published.filter((p) => p.featureExternalId === `${EU}:${key}`).length;
  return { gladys, runtime, read, count };
}

// --- Charging state ---------------------------------------------------------------

test('unplugged after a charge: the charging state says "idle", not "charging"', async () => {
  // A real test: the text said "Vehicle not connected", the connector
  // "Available", and the charging state still "Charging".
  const { gladys, runtime, read } = await setup();
  const [, outside, , charging, , , , , unplugged] = sequences.tesla.map(vitalsOf);
  await read(outside);
  await read(charging);
  assert.equal(gladys.last(`${EU}:charging-state`), 0, 'charging');
  await read(unplugged);
  assert.equal(gladys.last(`${EU}:connector-status`), 0, 'available');
  assert.deepEqual(gladys.last(`${EU}:status`), { text: 'Vehicle not connected' });
  assert.equal(gladys.last(`${EU}:charging-state`), 4, 'idle');
  // Straight from charging to unplugged too (the non-Tesla car went 10 → 13 → 1).
  await read(charging);
  await read({ ...charging, evse_state: 1, vehicle_connected: false, contactor_closed: false });
  assert.equal(gladys.last(`${EU}:charging-state`), 4);
  await runtime.stop();
});

// --- Thresholds -------------------------------------------------------------------

test('the thresholds: ±50 W (2 % in a charge), ±0.5 A, ±2 V, ±1 °C, and the return to 0', () => {
  assert.deepEqual(HISTORY_THRESHOLDS, {
    [F.POWER]: { step: 50, relative: 0.02, zero: true },
    [F.CURRENT]: { step: 0.5, zero: true },
    [F.VOLTAGE]: { step: 2 },
    [F.HANDLE_TEMPERATURE]: { step: 1 },
  });
  assert.equal(HISTORY_REFRESH_MS, 60 * 60 * 1000);
  const significant = (key, previous, next, unit) =>
    isSignificantChange(key, previous, next, { temperatureUnit: unit });
  assert.equal(significant(F.POWER, 1000, 1049), false);
  assert.equal(significant(F.POWER, 1000, 1050), true);
  assert.equal(significant(F.POWER, 7400, 7547), false, '2 % of 7.4 kW: 148 W');
  assert.equal(significant(F.POWER, 7400, 7548), true);
  assert.equal(significant(F.POWER, 7400, 7252), true);
  assert.equal(significant(F.POWER, 30, 0), true, 'back to 0');
  assert.equal(significant(F.POWER, 0, 30), false, 'idle noise');
  assert.equal(significant(F.CURRENT, 16, 16.4), false);
  assert.equal(significant(F.CURRENT, 16, 16.5), true);
  assert.equal(significant(F.CURRENT, 15.5, 16), true, 'float rounding');
  assert.equal(significant(F.CURRENT, 0.3, 0), true, 'back to 0');
  assert.equal(significant(F.VOLTAGE, 230, 231.9), false);
  assert.equal(significant(F.VOLTAGE, 230, 228), true);
  assert.equal(significant(F.VOLTAGE, 230, 0), true, 'no zero rule, but 230 V of change');
  assert.equal(significant(F.HANDLE_TEMPERATURE, 20, 20.9, 'celsius'), false);
  assert.equal(significant(F.HANDLE_TEMPERATURE, 20, 21, 'celsius'), true);
  assert.equal(significant(F.HANDLE_TEMPERATURE, 68, 69.7, 'fahrenheit'), false);
  assert.equal(significant(F.HANDLE_TEMPERATURE, 68, 69.8, 'fahrenheit'), true);
  // Every other feature: any change.
  assert.equal(significant(F.SESSION_ENERGY, 1.2, 1.21), true);
  assert.equal(significant(F.STATUS, { text: 'a' }, { text: 'a' }), false);
});

test('a small wobble is not published; a drift, a step and the hourly refresh are', async () => {
  const { runtime, read, count } = await setup();
  const base = vitalsOf(sequences.tesla[0]);
  const before = count(F.VOLTAGE);
  // ±1 V around the first value for 10 minutes: nothing.
  for (let i = 0; i < 40; i += 1) await read({ ...base, grid_v: base.grid_v + (i % 2 ? 1 : -1) });
  assert.equal(count(F.VOLTAGE), before);
  // A slow drift of 0.1 V per read gets through once it reaches 2 V.
  for (let i = 1; i <= 20; i += 1) await read({ ...base, grid_v: base.grid_v + i / 10 });
  assert.equal(count(F.VOLTAGE), before + 1);
  // Nothing moves for an hour: the value is sent again, once.
  const steady = { ...base, grid_v: base.grid_v + 2 };
  for (let i = 0; i < 240; i += 1) await read(steady);
  assert.equal(count(F.VOLTAGE), before + 2);
  await runtime.stop();
});

test('during a charge: the power follows by 2 % and comes back to 0 at the end', async () => {
  const { gladys, runtime, read, count } = await setup();
  const charging = vitalsOf(sequences.tesla[3]);
  await read(charging);
  const power = () => gladys.last(`${EU}:power`);
  const first = power();
  assert.ok(first > 1000, 'charging');
  const published = count(F.POWER);
  await read({ ...charging, currentA_a: charging.currentA_a + 0.5 }); // +116 W of 7.4 kW
  assert.equal(count(F.POWER), published);
  await read({ ...charging, currentA_a: charging.currentA_a + 0.7 }); // +162 W
  assert.equal(count(F.POWER), published + 1);
  await read({
    ...charging,
    evse_state: 9,
    contactor_closed: false,
    currentA_a: 0,
    vehicle_current_a: 0,
  });
  assert.equal(power(), 0);
  assert.equal(gladys.last(`${EU}:current`), 0);
  await runtime.stop();
});

test('a day on a real-looking charger: a bounded history', async () => {
  // 24 h of reads every 15 s (5,760 reads): a grid voltage wandering by
  // ±4 V over the day with ±1 V of noise, a handle temperature following the
  // day, and a 3-hour charge at 32 A with ±0.3 A of noise. Published as read,
  // that is up to 5,760 states per measurement.
  const { runtime, read, count } = await setup();
  const base = vitalsOf(sequences.tesla[0]);
  const charging = vitalsOf(sequences.tesla[3]);
  let seed = 42;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5; // -0.5 … 0.5
  };
  const before = Object.fromEntries(
    [F.VOLTAGE, F.CURRENT, F.POWER, F.HANDLE_TEMPERATURE].map((key) => [key, count(key)]),
  );
  const reads = (24 * 60 * 60 * 1000) / WALL_CONNECTOR_POLL_MS;
  for (let i = 0; i < reads; i += 1) {
    const hour = (i * WALL_CONNECTOR_POLL_MS) / 3600000;
    const volts =
      Math.round((232 + 4 * Math.sin((hour / 24) * 2 * Math.PI) + 2 * noise()) * 10) / 10;
    const handle =
      Math.round((17 + 5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + 0.4 * noise()) * 10) / 10;
    const inCharge = hour >= 1 && hour < 4;
    const amps = inCharge ? Math.round((32 + 0.6 * noise()) * 10) / 10 : 0;
    const vitals = inCharge ? charging : base;
    await read({
      ...vitals,
      grid_v: volts,
      voltageA_v: volts,
      currentA_a: amps,
      vehicle_current_a: amps,
      handle_temp_c: inCharge ? handle + 8 : handle,
    });
  }
  const perDay = Object.fromEntries(
    Object.entries(before).map(([key, n]) => [key, count(key) - n]),
  );
  // Each one at least the hourly refresh (24), far below the 5,760 reads.
  if (process.env.HISTORY_REPORT) console.log(perDay);
  for (const [key, n] of Object.entries(perDay)) {
    assert.ok(n >= 24, `${key}: ${n}`);
    assert.ok(n <= 150, `${key}: ${n} states in a day`);
  }
  await runtime.stop();
});
