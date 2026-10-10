// -----------------------------------------------------------------------------
// Fake Wall Connectors on a fake home network, answering from
// test/fixtures/wall-connector/. A test changes what a charger answers with
// `network.set(host, { vitals })` or takes it offline with
// `network.set(host, { offline: true })`. Other devices with port 80 open
// (a router, a printer...) are added with `network.other(host, answers)`;
// `network.probe` stands in for the TCP probe of the search.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { WallConnectorError } from '../../src/wallConnector/client.js';

const dir = new URL('../fixtures/wall-connector/', import.meta.url);

export function wcFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
}

export function wcRawFixture(name) {
  return readFileSync(new URL(name, dir), 'utf8');
}

// Documentation addresses (RFC 5737), never a real network.
export const WC_HOSTS = { EU: '192.0.2.10', NA: '192.0.2.11' };

export function createFakeWallNetwork() {
  const chargers = new Map([
    [
      WC_HOSTS.EU,
      {
        version: wcFixture('version_eu'),
        vitals: wcFixture('vitals_eu_unplugged'),
        lifetime: wcFixture('lifetime'),
        offline: false,
      },
    ],
    [
      WC_HOSTS.NA,
      {
        version: wcFixture('version_na'),
        vitals: wcFixture('vitals_na_charging'),
        lifetime: { ...wcFixture('lifetime'), energy_wh: 1203384 },
        offline: false,
      },
    ],
  ]);
  const calls = [];
  const others = new Map();
  const probes = [];
  const network = {
    calls,
    probes,
    other(host, answers = {}) {
      others.set(host, answers);
    },
    probe: async (host) => {
      probes.push(host);
      const charger = chargers.get(host);
      return (charger !== undefined && !charger.offline) || others.has(host);
    },
    count: (host, endpoint) =>
      calls.filter((c) => c.host === host && (!endpoint || c.endpoint === endpoint)).length,
    set(host, changes) {
      chargers.set(host, { ...chargers.get(host), ...changes });
    },
    factory: ({ host }) => {
      const answer = (endpoint) => async () => {
        calls.push({ host, endpoint });
        if (others.has(host)) {
          const answer = others.get(host)[endpoint];
          if (answer === undefined) {
            throw new WallConnectorError(`Wall Connector ${host} answered 404`, { kind: 'http' });
          }
          return structuredClone(answer);
        }
        const charger = chargers.get(host);
        if (!charger || charger.offline) {
          throw new WallConnectorError(`Wall Connector ${host} unreachable (TimeoutError)`);
        }
        return structuredClone(charger[endpoint]);
      };
      return {
        host,
        vitals: answer('vitals'),
        lifetime: answer('lifetime'),
        version: answer('version'),
        wifiStatus: answer('wifi_status'),
      };
    },
  };
  return network;
}
