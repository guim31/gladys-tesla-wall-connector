// -----------------------------------------------------------------------------
// Tesla Wall Connector (gen 3), read on the home network: client quirks,
// mapping of the vitals, and the runtime.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createLogger, validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  MAX_RESPONSE_BYTES,
  createWallConnectorClient,
  normalizeHost,
  parseHosts,
  parseWallConnectorJson,
} from '../src/wallConnector/client.js';
import {
  WALL_CONNECTOR_FEATURES as F,
  buildWallConnectorDevice,
  chargingPowerW,
  isFault,
  isSplitPhase,
  sessionState,
  statusText,
  wallConnectorStates,
} from '../src/devices/wallConnector.js';
import { createRuntime, WALL_CONNECTOR_POLL_MS } from '../src/runtime.js';
import { normalizeConfig } from '../src/config.js';
import { createWidgets, duration, totalEnergy } from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createMemoryStore } from './helpers/memoryStore.js';
import { SCENE_TRIGGERS, wallConnectorTransitions } from '../src/triggers.js';
import {
  WC_HOSTS,
  createFakeWallNetwork,
  wcFixture,
  wcRawFixture,
} from './helpers/fakeWallConnector.js';

const silent = createLogger({ level: 'silent' });
const EU = 'ext:wall-connector:wall-connector:TESTWC0000EU01';
const NA = 'ext:wall-connector:wall-connector:TESTWC0000NA02';

// --- Client ---------------------------------------------------------------------

test('the firmware JSON quirks are repaired: nan and a missing closing brace', () => {
  const withNan = parseWallConnectorJson(wcRawFixture('lifetime_nan.txt'));
  assert.equal(withNan.alert_count, null);
  assert.equal(withNan.energy_wh, 2566837);
  const truncated = parseWallConnectorJson(wcRawFixture('lifetime_truncated.txt'));
  assert.equal(truncated.energy_wh, 2566837);
  assert.throws(() => parseWallConnectorJson('<html>'), { kind: 'decode' });
});

test('addresses: IPs and host names only, however they are pasted', () => {
  assert.equal(normalizeHost(' http://192.168.1.50/ '), '192.168.1.50');
  assert.equal(normalizeHost('WallConnector.lan:80'), 'wallconnector.lan:80');
  assert.equal(normalizeHost('192.168.1.50/api'), null);
  assert.equal(normalizeHost('evil.com@192.168.1.50'), null);
  assert.deepEqual(parseHosts('192.0.2.10, 192.0.2.11;192.0.2.10\n bad/host'), [
    '192.0.2.10',
    '192.0.2.11',
  ]);
  assert.deepEqual(parseHosts(''), []);
});

test('the client reads http://<host>/api/1/<endpoint>, without credentials', async () => {
  const urls = [];
  const client = createWallConnectorClient({
    host: WC_HOSTS.EU,
    fetchImpl: async (url, init) => {
      urls.push(url);
      assert.equal(init.headers.Authorization, undefined);
      return new Response(wcRawFixture('lifetime_nan.txt'), { status: 200 });
    },
  });
  assert.equal((await client.lifetime()).energy_wh, 2566837);
  await client.vitals();
  await client.version();
  assert.deepEqual(urls, [
    'http://192.0.2.10/api/1/lifetime',
    'http://192.0.2.10/api/1/vitals',
    'http://192.0.2.10/api/1/version',
  ]);
  const down = createWallConnectorClient({
    host: WC_HOSTS.EU,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(down.vitals(), { kind: 'network' });
  const http = createWallConnectorClient({
    host: WC_HOSTS.EU,
    fetchImpl: async () => new Response('', { status: 500 }),
  });
  await assert.rejects(http.vitals(), { kind: 'http' });
});

test('the client refuses redirects and oversized answers', async () => {
  let init;
  const redirected = createWallConnectorClient({
    host: WC_HOSTS.EU,
    fetchImpl: async (url, options) => {
      init = options;
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    },
  });
  await assert.rejects(redirected.vitals(), { kind: 'network' });
  assert.equal(init.redirect, 'error');
  const huge = 'x'.repeat(MAX_RESPONSE_BYTES + 1);
  const streamed = createWallConnectorClient({
    host: WC_HOSTS.EU,
    fetchImpl: async () => new Response(new Blob([huge]).stream(), { status: 200 }),
  });
  await assert.rejects(streamed.vitals(), { kind: 'decode', message: /too large/ });
  const declared = createWallConnectorClient({
    host: WC_HOSTS.EU,
    fetchImpl: async () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) },
      }),
  });
  await assert.rejects(declared.vitals(), { kind: 'decode', message: /too large/ });
});

// --- Mapping --------------------------------------------------------------------

test('power: three phases in Europe, grid voltage × current on a 60 Hz supply', () => {
  const library = wcFixture('vitals_library');
  assert.equal(isSplitPhase(library), false);
  assert.equal(Math.round(chargingPowerW(library) * 10) / 10, 241.7); // the library's value
  // The library's split-phase computation, on the same answer at 60 Hz.
  const split = { ...library, grid_hz: 60.01 };
  assert.equal(Math.round(chargingPowerW(split) * 10) / 10, 114.4);
  assert.equal(Math.round(chargingPowerW(wcFixture('vitals_eu_charging'))), 11050);
  assert.equal(Math.round(chargingPowerW(wcFixture('vitals_na_charging'))), 11500);
});

test('the vitals become Gladys states', () => {
  const states = Object.fromEntries(
    wallConnectorStates(
      { vitals: wcFixture('vitals_eu_charging'), energyKwh: 386.204 },
      { language: 'fr', temperatureUnit: 'celsius' },
    ).map(({ key, value }) => [key, value]),
  );
  assert.deepEqual(states, {
    [F.CONNECTOR_STATUS]: 1, // occupied
    [F.STATUS]: { text: 'En charge' },
    [F.ENERGY]: 386.204,
    [F.CHARGING_STATE]: 0, // charging
    [F.POWER]: 11050,
    [F.SESSION_ENERGY]: 11.29,
    [F.VOLTAGE]: 228.8,
    [F.CURRENT]: 16,
    [F.HANDLE_TEMPERATURE]: 31.4,
  });
  const finished = wallConnectorStates(
    { vitals: wcFixture('vitals_eu_finished') },
    { language: 'en', temperatureUnit: 'fahrenheit' },
  );
  const byKey = Object.fromEntries(finished.map(({ key, value }) => [key, value]));
  assert.equal(byKey[F.CHARGING_STATE], 4, 'finished: idle');
  // No car: Gladys expects "idle" only with a car plugged in, so nothing.
  const unplugged = wallConnectorStates(
    { vitals: wcFixture('vitals_eu_unplugged') },
    { language: 'en', temperatureUnit: 'celsius' },
  );
  assert.equal(
    unplugged.find((st) => st.key === F.CHARGING_STATE),
    undefined,
  );
  assert.equal(unplugged.find((st) => st.key === F.CONNECTOR_STATUS).value, 0, 'available');
  assert.equal(byKey[F.POWER], 0);
  assert.equal(byKey[F.HANDLE_TEMPERATURE], 64.8);
  // Unreachable: only what is still true.
  const offline = wallConnectorStates(
    { vitals: wcFixture('vitals_eu_charging'), energyKwh: 386.204, reachable: false },
    { language: 'en', temperatureUnit: 'celsius' },
  );
  assert.deepEqual(offline, [
    { key: F.CONNECTOR_STATUS, value: 3 },
    { key: F.STATUS, value: { text: 'Unreachable' } },
    { key: F.ENERGY, value: 386.204 },
  ]);
});

test('charge sessions speak the cars’ vocabulary; unknown states make no transition', () => {
  assert.equal(sessionState(wcFixture('vitals_eu_unplugged')), 'Disconnected');
  assert.equal(sessionState(wcFixture('vitals_eu_charging')), 'Charging');
  assert.equal(sessionState(wcFixture('vitals_eu_finished')), 'Complete');
  assert.equal(sessionState({ evse_state: 9, vehicle_connected: true }), 'Stopped');
  assert.equal(sessionState({ evse_state: 7, vehicle_connected: true }), 'Stopped', 'schedule');
  assert.equal(sessionState({ evse_state: 7, vehicle_connected: false }), null, 'error');
  assert.equal(sessionState({ evse_state: 0 }), null, 'booting');
  assert.equal(statusText('fr', { evse_state: 42 }), 'État 42');
  const T = SCENE_TRIGGERS;
  const between = (a, b) => wallConnectorTransitions({ sessionState: a }, { sessionState: b });
  assert.deepEqual(between('Disconnected', 'Charging'), [
    T.WALL_CONNECTOR_PLUGGED,
    T.WALL_CONNECTOR_CHARGING_STARTED,
  ]);
  assert.deepEqual(between('Charging', 'Complete'), [T.WALL_CONNECTOR_CHARGING_FINISHED]);
  assert.deepEqual(between('Charging', 'Stopped'), [T.WALL_CONNECTOR_CHARGING_FINISHED]);
  assert.deepEqual(between('Stopped', 'Complete'), [], 'no charge to finish');
  assert.deepEqual(between('Charging', 'Disconnected'), [T.WALL_CONNECTOR_UNPLUGGED]);
  assert.deepEqual(between('Disconnected', 'Complete'), [T.WALL_CONNECTOR_PLUGGED]);
  assert.deepEqual(between('Complete', 'Disconnected'), [T.WALL_CONNECTOR_UNPLUGGED]);
  assert.deepEqual(between(undefined, 'Charging'), [], 'first value');
  assert.deepEqual(between('Charging', 'Charging'), []);
  assert.equal(statusText('en', {}), null, 'never an empty text');
});

// --- States of a real charger (single phase, a Tesla and a non-Tesla car) -------

const sequences = JSON.parse(
  readFileSync(new URL('./fixtures/single-phase/sequences.json', import.meta.url), 'utf8'),
);
const vitalsOf = (step) => ({ ...sequences.base, ...step.vitals });

function mapped(vitals) {
  const states = wallConnectorStates({ vitals }, { language: 'fr', temperatureUnit: 'celsius' });
  const byKey = Object.fromEntries(states.map(({ key, value }) => [key, value]));
  return [
    vitals.evse_state,
    byKey[F.CONNECTOR_STATUS],
    byKey[F.CHARGING_STATE] ?? null,
    byKey[F.STATUS].text,
    sessionState(vitals),
  ];
}

test('a Tesla: plugged in outside its schedule (7) is not an error', () => {
  assert.deepEqual(sequences.tesla.map(vitalsOf).map(mapped), [
    // evse, connector (0 free, 1 occupied), charging state, status, session
    [1, 0, null, 'Véhicule non branché', 'Disconnected'],
    [7, 1, 3, 'Branchée, hors plage de charge', 'Stopped'],
    [9, 1, 2, 'En attente du véhicule', 'Stopped'],
    [11, 1, 0, 'En charge', 'Charging'],
    [11, 1, 0, 'En charge', 'Charging'],
    [9, 1, 2, 'En attente du véhicule', 'Stopped'],
    [4, 1, 1, 'Prête à charger', 'Stopped'],
    [21, 1, 4, 'Fin de session', 'Complete'],
    [1, 0, null, 'Véhicule non branché', 'Disconnected'],
  ]);
});

test('a non-Tesla car: 12, 10 and 13, said "likely non-Tesla"', () => {
  assert.deepEqual(sequences.other_make.map(vitalsOf).map(mapped), [
    [1, 0, null, 'Véhicule non branché', 'Disconnected'],
    [12, 1, 1, 'Branchée (non Tesla probable)', 'Stopped'],
    [10, 1, 0, 'En charge (non Tesla probable)', 'Charging'],
    [13, 1, 4, 'Fin de session (non Tesla probable)', 'Complete'],
    [1, 0, null, 'Véhicule non branché', 'Disconnected'],
  ]);
  for (const step of sequences.other_make) {
    assert.ok(statusText('en', vitalsOf(step)).length <= 40, 'a widget status value');
  }
});

test('state 7 is an error only without a car or with an alert', () => {
  const plugged = vitalsOf(sequences.tesla[1]);
  assert.equal(isFault(plugged), false);
  const faulted = (vitals) =>
    wallConnectorStates({ vitals }, { language: 'en', temperatureUnit: 'celsius' });
  for (const vitals of [
    { ...plugged, current_alerts: [42] },
    { ...plugged, vehicle_connected: false, prox_v: 0 },
  ]) {
    assert.equal(isFault(vitals), true);
    const byKey = Object.fromEntries(faulted(vitals).map(({ key, value }) => [key, value]));
    assert.equal(byKey[F.CONNECTOR_STATUS], 4, 'faulted');
    assert.deepEqual(byKey[F.STATUS], { text: 'Error' });
    assert.equal(byKey[F.CHARGING_STATE], undefined);
    assert.equal(sessionState(vitals), null, 'no transition');
  }
  // A reason not to be ready (the schedule) is no error.
  assert.equal(isFault({ ...plugged, evse_not_ready_reasons: [1] }), false);
});

// --- Runtime --------------------------------------------------------------------

async function setup({ config = {}, store = createMemoryStore(), network } = {}) {
  const gladys = createFakeGladys();
  const net = network ?? createFakeWallNetwork();
  const clock = { t: Date.parse('2026-10-10T08:00:00Z') };
  const runtime = createRuntime({
    gladys,
    store,
    logger: silent,
    wallClientFactory: net.factory,
    now: () => clock.t,
  });
  await runtime.start(
    normalizeConfig({ wall_connectors: `${WC_HOSTS.EU}, ${WC_HOSTS.NA}`, ...config }),
  );
  gladys.createAll();
  for (const device of gladys.devices) await runtime.deviceCreated(device);
  const poll = async (ms = WALL_CONNECTOR_POLL_MS) => {
    clock.t += ms;
    await runtime.pollWallConnectors();
  };
  return { gladys, runtime, net, clock, store, poll };
}

test('the configured chargers are discovered, read and connected', async () => {
  const { gladys, runtime } = await setup();
  assert.deepEqual(
    gladys.discovered.map((d) => d.external_id),
    [EU, NA],
  );
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  assert.equal(gladys.last(`${NA}:power`), 11500);
  assert.deepEqual(gladys.transports.at(-1), { external_id: NA, transport: 'local' });
  await runtime.stop();
});

test('no charger configured: asks for an address or a search', async () => {
  const gladys = createFakeGladys();
  const runtime = createRuntime({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    wallClientFactory: createFakeWallNetwork().factory,
  });
  await runtime.start(normalizeConfig({}));
  assert.deepEqual(gladys.discovered, []);
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.match(gladys.connectionStatuses.at(-1).message.en, /Search for Wall Connectors/);
  assert.match(gladys.connectionStatuses.at(-1).message.fr, /Rechercher les bornes/);
  assert.match((await runtime.testWallConnectors()).fr, /Aucune adresse/);
  await runtime.stop();
});

test('the external ids are the ones of the Tesla integration 1.1.0, under this integration', () => {
  // Gladys prefixes every external id with `ext:<integration selector>:`, so
  // the prefix necessarily changes from one integration to the other; what
  // follows it stays exactly as the Tesla integration published it.
  const gladys = createFakeGladys({ selector: 'ext-guim31-gladys-tesla-wall-connector' });
  const device = buildWallConnectorDevice(gladys, wcFixture('version_eu'), {
    language: 'en',
    temperatureUnit: 'celsius',
  });
  const prefix = 'ext:ext-guim31-gladys-tesla-wall-connector:';
  assert.equal(device.external_id, `${prefix}wall-connector:TESTWC0000EU01`);
  assert.deepEqual(
    device.features.map((f) => f.external_id.slice(device.external_id.length + 1)),
    [
      'connector-status',
      'charging-state',
      'status',
      'power',
      'session-energy',
      'energy',
      'voltage',
      'current',
      'handle-temperature',
    ],
  );
});

test('nothing unchanged is published again; the lifetime counter is read every minute', async () => {
  const { gladys, runtime, net, poll } = await setup();
  const before = gladys.published.length;
  const lifetimeReads = net.count(WC_HOSTS.EU, 'lifetime');
  await poll();
  assert.equal(gladys.published.length, before, 'same vitals: nothing sent');
  assert.equal(net.count(WC_HOSTS.EU, 'lifetime'), lifetimeReads, 'not yet a minute');
  await poll(60 * 1000);
  assert.equal(net.count(WC_HOSTS.EU, 'lifetime'), lifetimeReads + 1);
  assert.equal(net.count(WC_HOSTS.EU, 'version'), 1, 'the identity is read once');
  await runtime.stop();
});

test('a charge session on the Wall Connector fires its own scene triggers, never the cars’ ones', async () => {
  const { gladys, runtime, net, poll } = await setup();
  net.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_charging') });
  await poll();
  net.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_finished') });
  await poll();
  net.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_unplugged') });
  await poll();
  assert.deepEqual(
    gladys.sceneEvents.map((e) => [e.key, e.data.device]),
    [
      ['wall_connector_plugged', EU],
      ['wall_connector_charging_started', EU],
      ['wall_connector_charging_finished', EU],
      ['wall_connector_unplugged', EU],
    ],
  );
  assert.deepEqual(gladys.sceneEvents[2].data, {
    device: EU,
    session_energy: 41.72,
  });
  assert.equal(gladys.last(`${EU}:connector-status`), 0);
  assert.equal(gladys.sceneEvents.filter((e) => e.data.device === NA).length, 0, 'first value');
  await runtime.stop();
});

test('a restart neither repeats nor misses a trigger', async () => {
  const store = createMemoryStore();
  const network = createFakeWallNetwork();
  network.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_charging') });
  const first = await setup({ store, network });
  await first.runtime.stop();
  const second = await setup({ store, network });
  assert.equal(second.gladys.sceneEvents.length, 0, 'still charging: nothing new');
  network.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_finished') });
  await second.poll();
  assert.deepEqual(
    second.gladys.sceneEvents.map((e) => e.key),
    ['wall_connector_charging_finished'],
  );
  await second.runtime.stop();
});

test('the energy index follows the charger, even downwards, and survives a restart', async () => {
  const store = createMemoryStore();
  const { gladys, runtime, net, poll } = await setup({ store });
  assert.equal(gladys.last(`${EU}:energy`), 386.204);
  net.set(WC_HOSTS.EU, { lifetime: { ...wcFixture('lifetime'), energy_wh: 397489 } });
  await poll(60 * 1000);
  assert.equal(gladys.last(`${EU}:energy`), 397.489);
  // A nan/0 is ignored; a lower reading goes through, for Gladys to treat as
  // a meter reset (holding the old value would freeze the index for good).
  net.set(WC_HOSTS.EU, { lifetime: { ...wcFixture('lifetime'), energy_wh: null } });
  await poll(60 * 1000);
  assert.equal(gladys.last(`${EU}:energy`), 397.489);
  net.set(WC_HOSTS.EU, { lifetime: { ...wcFixture('lifetime'), energy_wh: 1200 } });
  await poll(60 * 1000);
  assert.equal(gladys.last(`${EU}:energy`), 1.2);
  await runtime.stop();
  assert.equal(store.data.wallConnectors.TESTWC0000EU01.energyKwh, 1.2);
});

test('the device follows the serial number, not the IP address', async () => {
  const store = createMemoryStore();
  const network = createFakeWallNetwork();
  const first = await setup({ store, network, config: { wall_connectors: WC_HOSTS.EU } });
  await first.runtime.stop();
  // Same charger, new DHCP lease.
  const moved = createFakeWallNetwork();
  moved.set('192.0.2.99', {
    version: wcFixture('version_eu'),
    vitals: wcFixture('vitals_eu_unplugged'),
    lifetime: wcFixture('lifetime'),
    offline: false,
  });
  const second = await setup({ store, network: moved, config: { wall_connectors: '192.0.2.99' } });
  assert.deepEqual(
    second.gladys.discovered.map((d) => d.external_id),
    [EU],
  );
  await second.runtime.stop();
});

test('an unreachable charger: flagged after 3 missed reads, back when it answers', async () => {
  const { gladys, runtime, net, poll } = await setup();
  net.set(WC_HOSTS.EU, { offline: true });
  await poll();
  await poll();
  assert.equal(gladys.last(`${EU}:connector-status`), 0, 'two misses: not yet');
  await poll();
  assert.equal(gladys.last(`${EU}:connector-status`), 3, 'unavailable');
  assert.deepEqual(gladys.last(`${EU}:status`), { text: 'Unreachable' });
  const euTransport = () => gladys.transports.findLast((e) => e.external_id === EU).transport;
  assert.equal(euTransport(), 'unreachable');
  net.set(WC_HOSTS.EU, { offline: false });
  await poll();
  assert.equal(gladys.last(`${EU}:connector-status`), 0);
  assert.equal(euTransport(), 'local');
  await runtime.stop();
});

test('the connection status follows the chargers', async () => {
  const network = createFakeWallNetwork();
  network.set(WC_HOSTS.EU, { offline: true });
  network.set(WC_HOSTS.NA, { offline: true });
  const { gladys, runtime, poll } = await setup({ network });
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);
  assert.match(gladys.connectionStatuses.at(-1).message.fr, /Aucune Wall Connector/);
  network.set(WC_HOSTS.NA, { offline: false });
  await poll();
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  await runtime.stop();
});

test('a charger offline at startup keeps its device (remembered serial)', async () => {
  const store = createMemoryStore();
  const network = createFakeWallNetwork();
  const first = await setup({ store, network });
  await first.runtime.stop();
  network.set(WC_HOSTS.EU, { offline: true });
  const second = await setup({ store, network });
  assert.deepEqual(
    second.gladys.discovered.map((d) => d.external_id),
    [EU, NA],
  );
  await second.runtime.stop();
});

test('the local API is read-only', async () => {
  const { runtime } = await setup();
  await assert.rejects(
    runtime.setValue({ external_id: EU }, { external_id: `${EU}:power` }, 1),
    /read-only/,
  );
  await runtime.stop();
});

test('the test action reports each configured address', async () => {
  const { runtime, net } = await setup();
  net.set(WC_HOSTS.NA, { offline: true });
  const message = await runtime.testWallConnectors();
  assert.match(
    message.en,
    /192\.0\.2\.10: Wall Connector …EU01, firmware 21\.29\.1.*Vehicle not connected/,
  );
  assert.match(message.fr, /192\.0\.2\.11 : pas de réponse/);
  await runtime.stop();
});

test('changing the addresses restarts the chargers', async () => {
  const { gladys, runtime } = await setup();
  await runtime.reconfigure(normalizeConfig({ wall_connectors: WC_HOSTS.NA }));
  assert.deepEqual(
    gladys.discovered.map((d) => d.external_id),
    [NA],
  );
  await runtime.stop();
});

test('the chargers are read in parallel: a slow one delays nobody', async () => {
  const gladys = createFakeGladys();
  const pending = [];
  const hanging = ({ host }) => {
    const wait = () =>
      new Promise((resolve, reject) =>
        pending.push(() => reject(new Error(`Wall Connector ${host} unreachable`))),
      );
    return { host, vitals: wait, lifetime: wait, version: wait, wifiStatus: wait };
  };
  const runtime = createRuntime({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    wallClientFactory: hanging,
  });
  const started = runtime.start(
    normalizeConfig({ wall_connectors: `${WC_HOSTS.EU}, ${WC_HOSTS.NA}` }),
  );
  for (let i = 0; i < 20 && pending.length < 2; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(pending.length, 2, 'both chargers asked at once');
  for (const fail of pending) fail();
  await started;
  await runtime.stop();
});

test('widget: valid, read-only, bound to existing features', async () => {
  const { gladys, runtime, net, poll } = await setup();
  net.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_charging') });
  await poll();
  const widgets = createWidgets(runtime);
  const features = new Set(gladys.discovered.flatMap((d) => d.features.map((f) => f.external_id)));
  for (const device of [EU, NA]) {
    const content = await widgets.wall_connector.get({ settings: { device } });
    assert.deepEqual(validateWidgetContent(content), []);
    assert.ok(
      content.components.every((c) => c.type !== 'button'),
      'no button',
    );
    for (const c of content.components) {
      if (c.device_feature) assert.ok(features.has(c.device_feature), c.device_feature);
    }
  }
  const eu = await widgets.wall_connector.get({ settings: { device: EU } });
  const rows = eu.components.find((c) => c.type === 'status').items;
  assert.deepEqual(rows[0].value, { en: 'Charging', fr: 'En charge' });
  assert.equal(rows[2].value, '1 h 02 min');
  const wrong = await widgets.wall_connector.get({ settings: { device: 'ext:other:device:X' } });
  assert.deepEqual(validateWidgetContent(wrong), []);
  assert.deepEqual(validateWidgetContent(await widgets.wall_connector.get({ settings: {} })), []);
  await runtime.stop();
});

async function playSequence(steps, { config } = {}) {
  const ctx = await setup({ config: config ?? { wall_connectors: WC_HOSTS.EU } });
  const events = [];
  for (const step of steps) {
    ctx.net.set(WC_HOSTS.EU, { vitals: vitalsOf(step) });
    const before = ctx.gladys.sceneEvents.length;
    await ctx.poll(5 * 60 * 1000);
    events.push(ctx.gladys.sceneEvents.slice(before).map((e) => e.key));
  }
  return { ...ctx, events };
}

test('the scene triggers of a Tesla session on a real charger', async () => {
  const { runtime, events } = await playSequence(sequences.tesla);
  assert.deepEqual(events, [
    [], // already unplugged
    ['wall_connector_plugged'], // 7: outside the schedule, still plugged in
    [],
    ['wall_connector_charging_started'],
    [],
    ['wall_connector_charging_finished'], // 11 → 9
    [],
    [],
    ['wall_connector_unplugged'],
  ]);
  await runtime.stop();
});

test('the scene triggers of a non-Tesla car on a real charger', async () => {
  const { runtime, events, gladys } = await playSequence(sequences.other_make);
  assert.deepEqual(events, [
    [],
    ['wall_connector_plugged'],
    ['wall_connector_charging_started'],
    ['wall_connector_charging_finished'], // 13: the charge ends as the car leaves
    ['wall_connector_unplugged'],
  ]);
  assert.equal(gladys.sceneEvents.at(-1).data.session_energy, 1.29);
  await runtime.stop();
});

test('the charging time counts from the contactor, not from plugging in', async () => {
  const { gladys, runtime, net, poll } = await setup({ config: { wall_connectors: WC_HOSTS.EU } });
  const widgets = createWidgets(runtime);
  const rows = async () =>
    Object.fromEntries(
      (await widgets.wall_connector.get({ settings: { device: EU } })).components
        .find((c) => c.type === 'status')
        .items.map((item) => [item.label.fr, item.value]),
    );
  const [, outside, waiting, charging] = sequences.tesla.map(vitalsOf);
  net.set(WC_HOSTS.EU, { vitals: outside });
  await poll();
  net.set(WC_HOSTS.EU, { vitals: { ...waiting, session_s: 2220 } });
  await poll(30 * 60 * 1000);
  assert.equal((await rows())['Durée de charge'], '0 min', 'plugged in, not charging yet');
  net.set(WC_HOSTS.EU, { vitals: { ...charging, session_s: 2235 } });
  await poll();
  assert.deepEqual(await rows(), {
    Statut: { en: 'Charging', fr: 'En charge' },
    Véhicule: { en: 'Plugged in', fr: 'Branché' },
    'Branché depuis': '37 min',
    'Durée de charge': '0 min',
  });
  await poll(4 * 60 * 1000);
  net.set(WC_HOSTS.EU, { vitals: { ...waiting, session_s: 2600 } });
  await poll(60 * 1000);
  assert.equal((await rows())['Durée de charge'], '5 min');
  net.set(WC_HOSTS.EU, { vitals: { ...charging, session_s: 2900 } });
  await poll(5 * 60 * 1000);
  await poll(2 * 60 * 1000);
  assert.equal((await rows())['Durée de charge'], '7 min', 'the two charges of the session');
  // Unplugged: reset, and the durations leave the widget.
  net.set(WC_HOSTS.EU, { vitals: vitalsOf(sequences.tesla[8]) });
  await poll();
  assert.deepEqual(Object.keys(await rows()), ['Statut', 'Véhicule']);
  net.set(WC_HOSTS.EU, { vitals: { ...charging, session_s: 30 } });
  await poll();
  await poll(60 * 1000);
  assert.equal((await rows())['Durée de charge'], '1 min');
  assert.ok(gladys.widgetRefreshes.length > 0);
  await runtime.stop();
});

test('widget: power and current first, then the session and the total', async () => {
  const { runtime, net, poll } = await setup();
  const widgets = createWidgets(runtime);
  const tiles = async () =>
    (await widgets.wall_connector.get({ settings: { device: EU } })).components.filter(
      (c) => c.type === 'value',
    );
  assert.deepEqual(
    (await tiles()).map((c) => c.label.fr),
    ['Puissance', 'Courant', 'Dernière session', 'Total'],
  );
  assert.deepEqual((await tiles()).at(-1), {
    type: 'value',
    label: { en: 'Total', fr: 'Total' },
    icon: 'activity',
    value: 386,
    unit: 'kWh',
  });
  net.set(WC_HOSTS.EU, { vitals: wcFixture('vitals_eu_charging') });
  await poll();
  assert.equal((await tiles())[2].label.fr, 'Cette session');
  await runtime.stop();
});

test('widget: the total fits a tile; durations in both languages', () => {
  assert.deepEqual(totalEnergy(8596.731), { value: 8.6, unit: 'MWh' });
  assert.deepEqual(totalEnergy(12345.6), { value: 12.35, unit: 'MWh' });
  assert.deepEqual(totalEnergy(386.204), { value: 386, unit: 'kWh' });
  assert.deepEqual(totalEnergy(41.72), { value: 41.7, unit: 'kWh' });
  assert.deepEqual(totalEnergy(null), { value: '—' });
  assert.equal(duration(2220), '37 min');
  assert.equal(duration(3725), '1 h 02 min');
  assert.equal(duration(0), '0 min');
  assert.equal(duration(undefined), '—');
});
