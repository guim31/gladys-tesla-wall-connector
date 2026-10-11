// -----------------------------------------------------------------------------
// Conformity with the Gladys core (mandatory test of this integration series).
//
// Every device the integration discovers from realistic fixtures — a
// three-phase European charger charging, finished, unplugged, a split-phase
// North American one, in every unit and language setting — is checked against
// test/fixtures/gladys-feature-table.json, a table taken from the Gladys core
// code, and so is every state published for it. Do not relax this test to make
// it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createRuntime } from '../src/runtime.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createMemoryStore } from './helpers/memoryStore.js';
import { WC_HOSTS, createFakeWallNetwork, wcFixture } from './helpers/fakeWallConnector.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);
const silent = createLogger({ level: 'silent' });

// What each fake charger answers, per scenario.
const SCENARIOS = {
  'EU three-phase, charging': { vitals: 'vitals_eu_charging', host: WC_HOSTS.EU },
  'EU three-phase, finished': { vitals: 'vitals_eu_finished', host: WC_HOSTS.EU },
  'EU three-phase, unplugged': { vitals: 'vitals_eu_unplugged', host: WC_HOSTS.EU },
  'NA split-phase, charging': { vitals: 'vitals_na_charging', host: WC_HOSTS.NA },
  'NA split-phase, unplugged': {
    vitals: { ...wcFixture('vitals_eu_unplugged'), grid_hz: 60.0, grid_v: 240.1 },
    host: WC_HOSTS.NA,
  },
};
// Every step of the single-phase sequences of a real test (a Tesla, a
// non-Tesla car), on the EU charger.
const sequences = JSON.parse(
  await readFile(new URL('./fixtures/single-phase/sequences.json', import.meta.url), 'utf8'),
);
for (const [car, steps] of [
  ['Tesla', sequences.tesla],
  ['non-Tesla', sequences.other_make],
]) {
  steps.forEach((step, i) => {
    SCENARIOS[`single phase, ${car} ${i + 1}: state ${step.vitals.evse_state}`] = {
      vitals: { ...sequences.base, ...step.vitals },
      host: WC_HOSTS.EU,
    };
  });
}

const CONFIGS = [
  { units: 'auto', language: 'en' },
  { units: 'metric', language: 'fr' },
  { units: 'imperial', language: 'en' },
];

async function discover(scenario, config) {
  const network = createFakeWallNetwork();
  const vitals = typeof scenario.vitals === 'string' ? wcFixture(scenario.vitals) : scenario.vitals;
  network.set(scenario.host, { vitals });
  const gladys = createFakeGladys();
  const runtime = createRuntime({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    wallClientFactory: network.factory,
  });
  await runtime.start(normalizeConfig({ wall_connectors: scenario.host, ...config }));
  gladys.createAll();
  for (const device of gladys.devices) await runtime.deviceCreated(device);
  await runtime.stop();
  return { devices: gladys.discovered, published: gladys.published };
}

for (const [scenarioName, scenario] of Object.entries(SCENARIOS)) {
  for (const config of CONFIGS) {
    const label = `[${scenarioName}, ${config.units}/${config.language}]`;
    const { devices, published } = await discover(scenario, config);

    test(`${label} one Wall Connector is discovered`, () => {
      assert.deepEqual(
        devices.map((d) => d.model),
        ['Wall Connector (Gen 3)'],
      );
    });

    for (const device of devices) {
      const name = `${label} "${device.name}"`;

      test(`${name}: category/type couples exist in Gladys, with labels and icon`, () => {
        for (const feature of device.features) {
          const pair = `${feature.category}/${feature.type}`;
          const entry = table.pairs[pair];
          assert.ok(entry, `${feature.external_id}: ${pair} is not a couple Gladys knows`);
          assert.ok(entry.label_en && entry.label_fr, `${pair} has no label in the Gladys front`);
          assert.ok(entry.icon, `${pair} has no icon in the Gladys front`);
        }
      });

      test(`${name}: should_poll if and only if poll_frequency, in milliseconds`, () => {
        const hasFrequency = device.poll_frequency !== undefined;
        assert.equal(device.should_poll === true, hasFrequency, 'should_poll ⇔ poll_frequency');
        if (hasFrequency) {
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }
      });

      test(`${name}: min/max numbers, boolean flags, known units`, () => {
        for (const feature of device.features) {
          const id = feature.external_id;
          assert.equal(typeof feature.min, 'number', `${id}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${id}: max must be a number`);
          assert.ok(feature.min <= feature.max, `${id}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${id}: read_only`);
          assert.equal(typeof feature.has_feedback, 'boolean', `${id}: has_feedback`);
          assert.equal(typeof feature.keep_history, 'boolean', `${id}: keep_history`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${id}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (Array.isArray(allowed) && allowed.every((u) => typeof u === 'string')) {
              assert.ok(
                allowed.includes(feature.unit),
                `${id}: unit ${feature.unit} not offered for ${feature.category}`,
              );
            }
          }
        }
      });

      test(`${name}: unique feature external_ids and distinct names`, () => {
        const ids = device.features.map((f) => f.external_id);
        assert.equal(new Set(ids).size, ids.length, 'duplicate feature external_id');
        const names = device.features.map((f) => f.name);
        assert.equal(new Set(names).size, names.length, 'two features share a name');
        for (const id of ids) {
          assert.ok(
            id.startsWith(`${device.external_id}:`),
            `${id} is not under ${device.external_id}`,
          );
        }
      });

      test(`${name}: read-only, as the local API is`, () => {
        for (const feature of device.features) {
          assert.equal(feature.read_only, true, `${feature.external_id} is not read-only`);
        }
      });

      test(`${name}: signed powers have symmetric bounds`, () => {
        // A gauge places its needle with (value - min) / (max - min): a signed
        // flow needs bounds centered on zero. Temperatures are signed too, but
        // have no "zero flow" to center.
        const powers = device.features.filter(
          (f) => f.min < 0 && ['watt', 'kilowatt'].includes(f.unit),
        );
        for (const feature of powers) {
          assert.equal(feature.min, -feature.max, `${feature.external_id}: bounds not symmetric`);
        }
      });

      test(`${name}: every published state fits its feature`, () => {
        const features = new Map(device.features.map((f) => [f.external_id, f]));
        assert.ok(published.length > 0, 'states were published');
        for (const { featureExternalId, state } of published) {
          const feature = features.get(featureExternalId);
          assert.ok(feature, `${featureExternalId} is not a discovered feature`);
          if (feature.category === 'text') {
            // A text feature receives { text }, never empty.
            assert.equal(typeof state?.text, 'string', `${featureExternalId}: text state`);
            assert.ok(state.text.length > 0, `${featureExternalId}: empty text`);
            continue;
          }
          assert.equal(typeof state, 'number', `${featureExternalId}: numeric state`);
          assert.ok(Number.isFinite(state), `${featureExternalId}: ${state}`);
          assert.ok(
            state >= feature.min && state <= feature.max,
            `${featureExternalId}: ${state} outside [${feature.min}, ${feature.max}]`,
          );
          if (feature.type === 'integer' || feature.category === 'charging-station') {
            assert.ok(Number.isInteger(state), `${featureExternalId}: ${state} is not an integer`);
          }
        }
      });
    }
  }
}
