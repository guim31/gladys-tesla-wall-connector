// -----------------------------------------------------------------------------
// Every text shown to a user exists in the four languages of the Gladys
// interface (English, French, German, Spanish), is not empty, and fits where
// it is shown. Gladys shows the user's language when the text has it, English
// otherwise: a missing German text silently shows English to German users.
//
// Walked: the whole manifest, the message tables of the code (feature names,
// charger states, action and widget messages), and what the runtime and the
// widget actually send for every state of the real-test sequences.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { FEATURE_NAMES, LANGUAGES, createLines, formatNumber } from '../src/i18n.js';
import { MESSAGES, WIDGET_TEXTS } from '../src/messages.js';
import { EVSE_STATES, STATE_TEXTS, statusText } from '../src/devices/wallConnector.js';
import { createRuntime, WALL_CONNECTOR_POLL_MS } from '../src/runtime.js';
import { normalizeConfig } from '../src/config.js';
import { createWidgets } from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createMemoryStore } from './helpers/memoryStore.js';
import { WC_HOSTS, createFakeWallNetwork, wcFixture } from './helpers/fakeWallConnector.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const sequences = JSON.parse(
  readFileSync(new URL('./fixtures/single-phase/sequences.json', import.meta.url), 'utf8'),
);
const vitalsOf = (step) => ({ ...sequences.base, ...step.vitals });
const LANGUAGE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * One multi-language text: exactly en, fr, de and es, each a non-empty
 * string of at most `max` characters.
 */
function assertText(text, path, max = Infinity) {
  assert.ok(text && typeof text === 'object' && !Array.isArray(text), `${path}: not an object`);
  assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
  for (const language of LANGUAGES) {
    const value = text[language];
    assert.equal(typeof value, 'string', `${path}.${language}`);
    assert.ok(value.trim().length > 0, `${path}.${language} is empty`);
    assert.ok(value.length <= max, `${path}.${language} holds ${value.length} > ${max} characters`);
  }
}

/** An object keyed by languages (one of ours at least), its values strings. */
const isLanguageObject = (node) =>
  node &&
  typeof node === 'object' &&
  !Array.isArray(node) &&
  Object.keys(node).length > 0 &&
  Object.keys(node).every((key) => LANGUAGE_KEY.test(key)) &&
  Object.keys(node).some((key) => LANGUAGES.includes(key)) &&
  Object.values(node).every((value) => typeof value === 'string');

/** Every multi-language text inside `node`, with its path. */
function collectTexts(node, path, found = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectTexts(item, `${path}[${i}]`, found));
  } else if (isLanguageObject(node)) {
    found.push({ path, text: node });
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectTexts(value, `${path}.${key}`, found);
  }
  return found;
}

// --- Manifest ---------------------------------------------------------------------

test('manifest: every text in the four languages', () => {
  const texts = collectTexts(manifest, 'manifest');
  assert.ok(texts.length > 40, `${texts.length} texts found`);
  for (const { path, text } of texts) {
    // A section text holds 1,000 characters; a field label stays short.
    const max = path.endsWith('.label') ? 80 : 1000;
    assertText(text, path, max);
  }
  // label, description and placeholder are never plain strings.
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (['label', 'description', 'placeholder'].includes(key))
        assertText(value, `${path}.${key}`);
      else walk(value, `${path}.${key}`);
    }
  };
  walk(manifest, 'manifest');
});

test('manifest: the catalog description holds 10 to 100 characters in each language', () => {
  assertText(manifest.description, 'description', 100);
  for (const text of Object.values(manifest.description)) assert.ok(text.length >= 10);
});

test('manifest: the feature names can be in each language of the interface', () => {
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGUAGES,
  );
});

test('manifest: the texts that name an action match its label', () => {
  // The configuration intro points to the search button by its label.
  const search = manifest.actions.find((action) => action.key === 'scan_wall_connectors').label;
  const intro = manifest.config_schema.find((f) => f.key === 'intro').description;
  for (const language of LANGUAGES) {
    assert.ok(intro[language].includes(search[language]), `intro.${language}`);
    assert.ok(MESSAGES.noCharger[language].includes(search[language]), `noCharger.${language}`);
    assert.ok(MESSAGES.noAddress[language].includes(search[language]), `noAddress.${language}`);
  }
});

// --- Message tables of the code ----------------------------------------------------

test('code: feature names in the four languages', () => {
  for (const [key, text] of Object.entries(FEATURE_NAMES))
    assertText(text, `FEATURE_NAMES.${key}`, 40);
});

test('code: charger states in the four languages, short enough for a widget row', () => {
  for (const [state, entry] of Object.entries(EVSE_STATES)) {
    const text = Object.fromEntries(LANGUAGES.map((language) => [language, entry[language]]));
    assertText(text, `EVSE_STATES.${state}`, 40);
    for (const language of LANGUAGES) {
      assert.equal(
        statusText(language, { evse_state: Number(state), vehicle_connected: true }).length > 0,
        true,
      );
    }
  }
  for (const [key, text] of Object.entries(STATE_TEXTS)) assertText(text, `STATE_TEXTS.${key}`, 40);
});

// Arguments for every message built by a function: a new function without a
// sample fails the test below, so none is skipped.
const outcome = MESSAGES.added;
const MESSAGE_SAMPLES = {
  badRange: [['300.1.1.1, 8.8.8.8'], ['']],
  searched: [[254, '192.168.1.0/24', 12]],
  gladysNetwork: [['192.168.1.0/24']],
  foundCount: [[1]],
  foundLine: [['192.168.1.50', '…EU01', '24.36.3', outcome]],
  newAddress: [['192.168.1.40']],
  saveFailed: [['192.168.1.50']],
  stateNumber: [[3]],
  testLine: [['192.168.1.50', '…EU01', '24.36.3', STATE_TEXTS.fault]],
  noAnswer: [['192.168.1.50', 'timeout']],
};

test('code: action and status messages in the four languages', () => {
  for (const [key, entry] of Object.entries(MESSAGES)) {
    if (typeof entry === 'function') {
      assert.ok(MESSAGE_SAMPLES[key], `MESSAGES.${key}: add a sample to this test`);
      for (const args of MESSAGE_SAMPLES[key]) assertText(entry(...args), `MESSAGES.${key}()`);
    } else {
      assertText(entry, `MESSAGES.${key}`);
    }
  }
  for (const key of Object.keys(MESSAGE_SAMPLES)) {
    assert.equal(typeof MESSAGES[key], 'function', `sample of an unknown message ${key}`);
  }
});

test('code: widget texts in the four languages, short enough for their place', () => {
  // The core cuts a tile label at 24 characters, a status label at 40, and a
  // body text at 300.
  const TILES = ['power', 'current'];
  const BODIES = ['pickDevice', 'notWallConnector'];
  for (const [key, text] of Object.entries(WIDGET_TEXTS)) {
    assertText(
      text,
      `WIDGET_TEXTS.${key}`,
      TILES.includes(key) ? 24 : BODIES.includes(key) ? 300 : 40,
    );
  }
});

test('code: lines and numbers are built in the four languages', () => {
  const lines = createLines();
  lines.add(MESSAGES.noneFound);
  lines.add(MESSAGES.searched(3, '192.168.1.0/24', 1));
  assertText(lines.text(), 'createLines');
  assert.equal(lines.text().de.split('\n').length, 2);
  assert.deepEqual(formatNumber(1.5), { en: '1.5', fr: '1,5', de: '1,5', es: '1,5' });
});

// --- What actually leaves the container --------------------------------------------

test('sent to Gladys: widget contents, statuses and action results in the four languages', async () => {
  const gladys = createFakeGladys();
  const net = createFakeWallNetwork();
  const clock = { t: Date.parse('2026-10-11T08:00:00Z') };
  const runtime = createRuntime({
    gladys,
    store: createMemoryStore(),
    logger: createLogger({ level: 'silent' }),
    wallClientFactory: net.factory,
    scan: async () => ({ scanned: 254, complete: false, found: [] }),
    now: () => clock.t,
  });
  await runtime.start(normalizeConfig({ wall_connectors: `${WC_HOSTS.EU}, 192.0.2.99` }));
  gladys.createAll();
  for (const device of gladys.devices) await runtime.deviceCreated(device);
  const widget = createWidgets(runtime).wall_connector;
  const device = gladys.devices[0].external_id;
  const sent = [];
  const steps = [...sequences.tesla, ...sequences.other_make].map(vitalsOf);
  steps.push(wcFixture('vitals_eu_charging'), { ...steps[1], current_alerts: [1] });
  for (const vitals of steps) {
    net.set(WC_HOSTS.EU, { vitals });
    clock.t += WALL_CONNECTOR_POLL_MS;
    await runtime.pollWallConnectors();
    sent.push(await widget.get({ settings: { device } }));
  }
  net.set(WC_HOSTS.EU, { offline: true });
  for (let i = 0; i < 3; i += 1) {
    clock.t += WALL_CONNECTOR_POLL_MS;
    await runtime.pollWallConnectors();
  }
  sent.push(await widget.get({ settings: { device } }));
  sent.push(await widget.get({ settings: {} }));
  sent.push(await widget.get({ settings: { device: 'ext:other:device:X' } }));
  sent.push(gladys.connectionStatuses.map((status) => status.message).filter(Boolean));
  sent.push(await runtime.testWallConnectors());
  await assert.rejects(runtime.searchWallConnectors(), (err) => {
    sent.push(err.message);
    return true;
  });
  const texts = collectTexts(sent, 'sent');
  assert.ok(texts.length > 100, `${texts.length} texts sent`);
  for (const { path, text } of texts) assertText(text, path);
  await runtime.stop();
});

test('German: "du" everywhere, never the polite "Sie"', () => {
  // The rule kept for every integration of the maintainer, as most of the
  // German interface of Gladys. A capitalized "Sie" or "Ihr…" is the polite
  // form mid-sentence and ambiguous at its start (it may mean "she"): both
  // are refused, rephrase the sentence. The lowercase "ihr/ihre" (their) is fine.
  const POLITE = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
  const texts = [
    ...collectTexts(manifest, 'manifest'),
    ...collectTexts(FEATURE_NAMES, 'FEATURE_NAMES'),
    ...collectTexts(STATE_TEXTS, 'STATE_TEXTS'),
    ...collectTexts(WIDGET_TEXTS, 'WIDGET_TEXTS'),
    ...Object.entries(EVSE_STATES).map(([state, entry]) => ({
      path: `EVSE_STATES.${state}`,
      text: { de: entry.de },
    })),
    ...Object.entries(MESSAGES).flatMap(([key, entry]) =>
      (typeof entry === 'function'
        ? MESSAGE_SAMPLES[key].map((args) => entry(...args))
        : [entry]
      ).map((text) => ({ path: `MESSAGES.${key}`, text })),
    ),
  ];
  assert.ok(texts.length > 100, `${texts.length} texts`);
  for (const { path, text } of texts) {
    assert.doesNotMatch(text.de, POLITE, `${path}.de`);
  }
  // The check itself catches the polite form.
  assert.match('Prüfen Sie die Adresse.', POLITE);
  assert.doesNotMatch('aus ihren Adressen', POLITE);
});
