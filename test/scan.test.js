// -----------------------------------------------------------------------------
// Search for Wall Connectors on the home network: the range, the sweep, and
// the "Search for Wall Connectors" action that fills the configuration.
// Only documentation and private addresses; the one real socket is on the
// loopback interface.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import {
  DEFAULT_SCAN_RANGES,
  MAX_SCAN_ADDRESSES,
  isPrivateIp,
  looksLikeWallConnector,
  parseScanRange,
  scanForWallConnectors,
  subnet24,
  tcpProbe,
} from '../src/wallConnector/scan.js';
import { createRuntime } from '../src/runtime.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createMemoryStore } from './helpers/memoryStore.js';
import { WC_HOSTS, createFakeWallNetwork, wcFixture } from './helpers/fakeWallConnector.js';

const silent = createLogger({ level: 'silent' });

// --- Range ----------------------------------------------------------------------

test('the range: networks, ranges, a.b.c.* and single addresses', () => {
  const net24 = parseScanRange('192.168.1.0/24');
  assert.equal(net24.addresses.length, 254, 'network and broadcast addresses skipped');
  assert.equal(net24.addresses[0], '192.168.1.1');
  assert.equal(net24.addresses.at(-1), '192.168.1.254');
  // Any address of the block designates the block.
  assert.deepEqual(parseScanRange('192.168.1.77/24').addresses, net24.addresses);
  assert.deepEqual(parseScanRange('192.168.1.*').addresses, net24.addresses);
  assert.deepEqual(parseScanRange('10.0.0.10-10.0.0.12').addresses, [
    '10.0.0.10',
    '10.0.0.11',
    '10.0.0.12',
  ]);
  assert.deepEqual(parseScanRange('172.16.5.250-252').addresses, [
    '172.16.5.250',
    '172.16.5.251',
    '172.16.5.252',
  ]);
  // Several entries, any separator, duplicates once.
  assert.deepEqual(parseScanRange(' 192.168.2.5, 192.168.2.5;192.168.2.6\n').addresses, [
    '192.168.2.5',
    '192.168.2.6',
  ]);
  assert.equal(parseScanRange('10.1.0.0/22').addresses.length, 1022);
});

test('the range: never public addresses, never more than 1,024', () => {
  assert.deepEqual(parseScanRange('8.8.8.0/24').notPrivate, ['8.8.8.0/24']);
  assert.deepEqual(parseScanRange('8.8.8.0/24').addresses, []);
  assert.deepEqual(parseScanRange('172.32.0.1').notPrivate, ['172.32.0.1']);
  assert.equal(parseScanRange('10.0.0.0/8').tooLarge, true);
  assert.equal(parseScanRange('10.0.0.0/21').tooLarge, true);
  // Two blocks within the cap each, too many together.
  const both = parseScanRange('10.1.0.0/22, 10.2.0.0/22');
  assert.equal(both.tooLarge, true);
  assert.deepEqual(both.addresses, []);
  assert.equal(parseScanRange('10.1.0.0/22').addresses.length <= MAX_SCAN_ADDRESSES, true);
  assert.deepEqual(parseScanRange('192.168.1.300, nope, 192.168.1.9-192.168.1.2').invalid, [
    '192.168.1.300',
    'nope',
    '192.168.1.9-192.168.1.2',
  ]);
  assert.deepEqual(parseScanRange(''), {
    addresses: [],
    invalid: [],
    notPrivate: [],
    tooLarge: false,
  });
});

test('private addresses and the /24 of a configured charger', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '192.0.2.10']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
  assert.equal(subnet24('192.168.1.50'), '192.168.1.0/24');
  assert.equal(subnet24('192.168.1.50:80'), '192.168.1.0/24');
  assert.equal(subnet24('wallconnector.lan'), null);
  for (const range of DEFAULT_SCAN_RANGES)
    assert.equal(parseScanRange(range).addresses.length, 254);
});

// --- Sweep ----------------------------------------------------------------------

test('only answers shaped like a Wall Connector are kept', () => {
  const version = wcFixture('version_eu');
  const vitals = wcFixture('vitals_eu_unplugged');
  assert.equal(looksLikeWallConnector(version, vitals), true);
  assert.equal(looksLikeWallConnector({ ...version, serial_number: '' }, vitals), false);
  assert.equal(looksLikeWallConnector({ serial_number: 'ABC123' }, vitals), false);
  assert.equal(looksLikeWallConnector(version, { evse_state: 'x' }), false);
  assert.equal(looksLikeWallConnector(version, {}), false);
  assert.equal(looksLikeWallConnector(null, null), false);
});

function lan() {
  // The two fixture chargers moved to a private /24, among other devices.
  const network = createFakeWallNetwork();
  const charger = (version, vitals) => ({
    version: wcFixture(version),
    vitals: wcFixture(vitals),
    lifetime: wcFixture('lifetime'),
    offline: false,
  });
  network.set('192.168.1.42', charger('version_eu', 'vitals_eu_unplugged'));
  network.set('192.168.1.43', charger('version_na', 'vitals_na_charging'));
  network.other('192.168.1.1'); // the box: port 80 open, 404 on the API
  network.other('192.168.1.20', { version: { serial_number: 'NAS-1' } }); // a lookalike
  network.other('192.168.1.30', {
    version: { serial_number: 'X1', part_number: 'p', firmware_version: 'f' },
    vitals: { evse_state: 'busy' },
  });
  return network;
}

test('the sweep finds the chargers, and only them', async () => {
  const network = lan();
  const result = await scanForWallConnectors({
    addresses: parseScanRange('192.168.1.0/24').addresses,
    probe: network.probe,
    clientFactory: network.factory,
  });
  assert.deepEqual(
    result.found.map((f) => [f.host, f.serial]),
    [
      ['192.168.1.42', 'TESTWC0000EU01'],
      ['192.168.1.43', 'TESTWC0000NA02'],
    ],
  );
  assert.equal(result.found[0].firmware, '21.29.1+g4152353e50f744');
  assert.equal(result.scanned, 254);
  assert.equal(result.open, 5);
  assert.equal(result.complete, true);
  // The API is only asked on the addresses with port 80 open.
  assert.deepEqual([...new Set(network.calls.map((c) => c.host))].sort(), [
    '192.168.1.1',
    '192.168.1.20',
    '192.168.1.30',
    '192.168.1.42',
    '192.168.1.43',
  ]);
});

test('the sweep keeps its concurrency and stops at its deadline', async () => {
  let running = 0;
  let peak = 0;
  const clock = { t: 0 };
  const slowProbe = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    clock.t += 100;
    running -= 1;
    return false;
  };
  const result = await scanForWallConnectors({
    addresses: parseScanRange('10.0.0.0/23').addresses,
    probe: slowProbe,
    clientFactory: () => assert.fail('nothing is open'),
    concurrency: 16,
    deadlineMs: 2000,
    now: () => clock.t,
  });
  assert.ok(peak <= 16, `peak ${peak}`);
  assert.equal(result.complete, false);
  assert.ok(result.scanned < 510, `scanned ${result.scanned}`);
});

test('the TCP probe: open port, closed port', async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.equal(await tcpProbe('127.0.0.1', port, 1000), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await tcpProbe('127.0.0.1', port, 1000), false);
});

// --- The action -----------------------------------------------------------------

async function setup({ config = {}, network = lan(), store = createMemoryStore() } = {}) {
  const gladys = createFakeGladys();
  const scans = [];
  const runtime = createRuntime({
    gladys,
    store,
    logger: silent,
    wallClientFactory: network.factory,
    scan: (options) => {
      scans.push(options.addresses);
      return scanForWallConnectors({
        ...options,
        probe: network.probe,
        clientFactory: network.factory,
      });
    },
  });
  await runtime.start(normalizeConfig(config));
  return { gladys, runtime, network, scans, store };
}

test('the search adds the chargers found to the configuration and starts reading them', async () => {
  const { gladys, runtime, scans } = await setup({ config: { scan_range: '192.168.1.0/24' } });
  const message = await runtime.searchWallConnectors();
  assert.equal(scans[0].length, 254);
  assert.deepEqual(gladys.configWrites, [{ wall_connectors: '192.168.1.42, 192.168.1.43' }]);
  assert.match(message.en, /254 addresses searched \(192\.168\.1\.0\/24\)/);
  assert.match(message.en, /192\.168\.1\.42: serial …EU01, firmware 21\.29\.1.*added/);
  assert.match(message.fr, /192\.168\.1\.43 : numéro de série …NA02.*ajoutée/);
  assert.match(message.fr, /Rechargez cette page/);
  // The chargers are read and offered in the Discovery tab right away.
  assert.deepEqual(
    gladys.discovered.map((d) => d.external_id),
    [
      'ext:wall-connector:wall-connector:TESTWC0000EU01',
      'ext:wall-connector:wall-connector:TESTWC0000NA02',
    ],
  );
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  await runtime.stop();
});

test('a charger found at a new address replaces its old one; a known one is kept', async () => {
  const store = createMemoryStore();
  // The EU charger was configured at another address (the DHCP lease moved);
  // the NA one is configured where it is.
  const before = createFakeWallNetwork();
  before.set('192.168.1.9', {
    version: wcFixture('version_eu'),
    vitals: wcFixture('vitals_eu_unplugged'),
    lifetime: wcFixture('lifetime'),
    offline: false,
  });
  const first = await setup({ store, network: before, config: { wall_connectors: '192.168.1.9' } });
  await first.runtime.stop();
  assert.equal(store.data.wallConnectors.TESTWC0000EU01.host, '192.168.1.9');

  const { gladys, runtime, scans } = await setup({
    store,
    config: { wall_connectors: '192.168.1.9, 192.168.1.43' },
  });
  const message = await runtime.searchWallConnectors();
  // No range configured: the /24 of the configured chargers.
  assert.equal(scans[0].length, 254);
  assert.match(message.en, /\(192\.168\.1\.0\/24\)/);
  assert.deepEqual(gladys.configWrites, [{ wall_connectors: '192.168.1.42, 192.168.1.43' }]);
  assert.match(message.en, /192\.168\.1\.42: .*new address, replaces 192\.168\.1\.9/);
  assert.match(message.en, /192\.168\.1\.43: .*already configured/);
  await runtime.stop();
});

test('nothing new found: the configuration is left alone', async () => {
  const { gladys, runtime } = await setup({
    config: { wall_connectors: '192.168.1.42, 192.168.1.43' },
  });
  const message = await runtime.searchWallConnectors();
  assert.deepEqual(gladys.configWrites, []);
  assert.doesNotMatch(message.en, /Reload/);
  await runtime.stop();
});

test('no range and no charger: the two most common home networks, said so', async () => {
  const { runtime, scans } = await setup();
  const message = await runtime.searchWallConnectors();
  assert.equal(scans[0].length, 508);
  assert.equal(scans[0][0], '192.168.1.1');
  assert.match(message.en, /No range in the configuration/);
  assert.match(message.fr, /réseaux domestiques les plus courants/);
  await runtime.stop();
});

test('nothing found: the message says what to check', async () => {
  const { gladys, runtime } = await setup({ config: { scan_range: '10.0.0.1-10.0.0.20' } });
  const message = await runtime.searchWallConnectors();
  assert.match(message.en, /No Wall Connector answered/);
  assert.match(message.fr, /Tesla One/);
  assert.deepEqual(gladys.configWrites, []);
  await runtime.stop();
});

test('an unusable range is refused before any search, with an example', async () => {
  for (const scan_range of ['8.8.8.0/24', '10.0.0.0/16', 'my network']) {
    const { runtime, scans } = await setup({ config: { scan_range } });
    const message = await runtime.searchWallConnectors();
    assert.equal(scans.length, 0, scan_range);
    assert.match(message.en, /192\.168\.1\.0\/24/);
    assert.match(message.fr, /inutilisable/);
    await runtime.stop();
  }
});

test('the configuration cannot be saved: the addresses are given to type', async () => {
  const { gladys, runtime } = await setup({ config: { scan_range: '192.168.1.40-50' } });
  gladys.failSetConfig = true;
  const message = await runtime.searchWallConnectors();
  assert.match(
    message.en,
    /could not be saved: type these addresses: 192\.168\.1\.42, 192\.168\.1\.43/,
  );
  assert.deepEqual(gladys.discovered, []);
  await runtime.stop();
});

test('one search at a time', async () => {
  let release;
  const gladys = createFakeGladys();
  const runtime = createRuntime({
    gladys,
    store: createMemoryStore(),
    logger: silent,
    wallClientFactory: createFakeWallNetwork().factory,
    scan: () =>
      new Promise((resolve) => {
        release = () => resolve({ found: [], scanned: 0, open: 0, complete: true });
      }),
  });
  await runtime.start(normalizeConfig({ scan_range: WC_HOSTS.EU.replace('192.0.2', '10.0.0') }));
  const first = runtime.searchWallConnectors();
  const second = await runtime.searchWallConnectors();
  assert.match(second.en, /already running/);
  release();
  assert.match((await first).en, /No Wall Connector answered/);
  await runtime.stop();
});
