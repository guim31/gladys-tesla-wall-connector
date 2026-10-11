// -----------------------------------------------------------------------------
// Configuration normalization: what the form sends becomes what the code uses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, wallConnectorHosts } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ units: null, language: undefined }), DEFAULT_CONFIG);
});

test('unknown choices fall back to the defaults', () => {
  const config = normalizeConfig({ units: 'kelvin', language: 'it' });
  assert.equal(config.units, 'auto');
  assert.equal(config.language, 'en');
  assert.equal(normalizeConfig({ units: 'imperial' }).units, 'imperial');
  for (const language of ['en', 'fr', 'de', 'es']) {
    assert.equal(normalizeConfig({ language }).language, language);
  }
});

test('addresses and range are kept as typed, the addresses parsed on use', () => {
  const config = normalizeConfig({
    wall_connectors: 'http://192.168.1.50/, 192.168.1.51;bad/host',
    scan_range: '  192.168.1.0/24 ',
  });
  assert.equal(config.scan_range, '192.168.1.0/24');
  assert.deepEqual(wallConnectorHosts(config), ['192.168.1.50', '192.168.1.51']);
  assert.deepEqual(wallConnectorHosts({}), []);
});
