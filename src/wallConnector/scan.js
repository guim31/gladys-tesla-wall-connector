// -----------------------------------------------------------------------------
// Finding Wall Connectors on the home network.
//
// The charger announces itself neither in mDNS nor in SSDP (Home Assistant
// finds it through DHCP, which Gladys does not relay), and the integration's
// container sits on a Docker bridge (172.30.0.0/24): it cannot see the LAN's
// broadcasts, nor learn which network Gladys is on. What it CAN do is unicast
// to LAN addresses (the bridge NAT lets it through), so the search sweeps a
// range of addresses:
//   1. a TCP connection to port 80, short timeout, many at once: most
//      addresses are empty and fail fast or time out;
//   2. on the few addresses with port 80 open, `GET /api/1/version` and
//      `/api/1/vitals` with the charger's own (long) delay, kept only when
//      both have the shape of a Wall Connector answer.
// The range is the user's (configuration), else the /24 of the chargers
// already configured and the /24 of Gladys itself, else the two most common
// home networks. Gladys's network is learnt from an SSDP search the core runs
// for the integration (it sits on the host network): the devices answering it
// (the internet box, a TV, a speaker...) are on the LAN of Gladys. Only
// private addresses (RFC 1918), 1,024 at most: the sweep never leaves the home.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { createWallConnectorClient } from './client.js';

export const MAX_SCAN_ADDRESSES = 1024;
// Most French boxes (Livebox, Freebox, SFR, Bbox) hand out 192.168.1.x;
// 192.168.0.x is the other common default.
export const DEFAULT_SCAN_RANGES = ['192.168.1.0/24', '192.168.0.0/24'];
// Four /24 networks: the 1,024 addresses of a search.
export const MAX_SCAN_RANGES = MAX_SCAN_ADDRESSES / 256;
// Docker's own networks, seen from the core when a container answers: the
// integrations bridge (172.30.0.0/24) and the default bridge (172.17.0.0/16).
const DOCKER_NETWORKS = [/^172\.30\.0\./, /^172\.17\./];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipToInt(ip) {
  const match = IPV4.exec(ip);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** RFC 1918 private ranges: 10/8, 172.16/12, 192.168/16. */
export function isPrivateIp(ip) {
  const n = ipToInt(ip);
  if (n === null) return false;
  return n >>> 24 === 10 || n >>> 20 === (172 << 4) + 1 || n >>> 16 === (192 << 8) + 168;
}

/** First and last address of one range entry, or null when it is not one. */
function entryBounds(entry) {
  // 192.168.1.0/24
  let match = /^([\d.]+)\/(\d{1,2})$/.exec(entry);
  if (match) {
    const base = ipToInt(match[1]);
    const bits = Number(match[2]);
    if (base === null || bits > 32) return null;
    const size = 2 ** (32 - bits);
    const first = Math.floor(base / size) * size;
    const last = first + size - 1;
    // Network and broadcast addresses hold no device.
    return size > 2 ? [first + 1, last - 1] : [first, last];
  }
  // 192.168.1.* (a whole /24)
  match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\*$/.exec(entry);
  if (match) return entryBounds(`${match[1]}.0/24`);
  // 192.168.1.10-192.168.1.60, or 192.168.1.10-60
  match = /^([\d.]+)-([\d.]+)$/.exec(entry);
  if (match) {
    const first = ipToInt(match[1]);
    let last = ipToInt(match[2]);
    if (last === null && /^\d{1,3}$/.test(match[2]) && first !== null) {
      last = ipToInt(match[1].replace(/\d+$/, match[2]));
    }
    if (first === null || last === null || last < first) return null;
    return [first, last];
  }
  // a single address
  const single = ipToInt(entry);
  return single === null ? null : [single, single];
}

/**
 * Parse the range typed by the user: CIDR blocks, `a.b.c.*`, `first-last`
 * ranges or single addresses, separated by commas, spaces or new lines.
 * @returns {{ addresses: string[], invalid: string[], notPrivate: string[], tooLarge: boolean }}
 */
export function parseScanRange(text) {
  const result = { addresses: [], invalid: [], notPrivate: [], tooLarge: false };
  const seen = new Set();
  for (const entry of String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const bounds = entryBounds(entry);
    if (!bounds) {
      result.invalid.push(entry);
      continue;
    }
    const [first, last] = bounds;
    if (last - first + 1 > MAX_SCAN_ADDRESSES) {
      result.tooLarge = true;
      continue;
    }
    if (!isPrivateIp(intToIp(first)) || !isPrivateIp(intToIp(last))) {
      result.notPrivate.push(entry);
      continue;
    }
    for (let n = first; n <= last; n += 1) {
      if (!seen.has(n)) {
        seen.add(n);
        result.addresses.push(intToIp(n));
      }
    }
  }
  if (result.addresses.length > MAX_SCAN_ADDRESSES) result.tooLarge = true;
  if (result.tooLarge) result.addresses = [];
  return result;
}

/** The /24 of a configured charger address ("192.168.1.50:80" → "192.168.1.0/24"). */
export function subnet24(host) {
  const ip = String(host).replace(/:\d+$/, '');
  if (!isPrivateIp(ip)) return null;
  return `${ip.replace(/\.\d+$/, '')}.0/24`;
}

/**
 * The home networks seen in the answers to an SSDP search
 * (`[{ source_ip }]`), as /24 ranges, the most populated first.
 */
export function lanRangesFromSsdp(answers) {
  const devices = new Map(); // range → distinct addresses
  for (const answer of Array.isArray(answers) ? answers : []) {
    const ip = typeof answer?.source_ip === 'string' ? answer.source_ip : '';
    if (DOCKER_NETWORKS.some((docker) => docker.test(ip))) continue;
    const range = subnet24(ip);
    if (!range) continue;
    if (!devices.has(range)) devices.set(range, new Set());
    devices.get(range).add(ip);
  }
  return [...devices.entries()]
    .sort(
      ([a, x], [b, y]) => y.size - x.size || ipToInt(a.split('/')[0]) - ipToInt(b.split('/')[0]),
    )
    .map(([range]) => range)
    .slice(0, MAX_SCAN_RANGES);
}

/** Is a TCP port open? Resolves false on any error or after `timeoutMs`. */
export function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Do `/api/1/version` and `/api/1/vitals` look like a Wall Connector's? */
export function looksLikeWallConnector(version, vitals) {
  return (
    typeof version?.serial_number === 'string' &&
    /^[A-Za-z0-9-]{4,64}$/.test(version.serial_number) &&
    typeof version.part_number === 'string' &&
    typeof version.firmware_version === 'string' &&
    Number.isFinite(vitals?.evse_state) &&
    typeof vitals.vehicle_connected === 'boolean' &&
    Number.isFinite(vitals.grid_v)
  );
}

/** `fn` over `items`, `limit` at a time, never starting one past `stop()`. */
async function eachLimited(items, limit, fn, stop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Sweep `addresses` for Wall Connectors.
 * @returns {Promise<{ found: Array<{ host, serial, firmware, partNumber, evseState }>,
 *   scanned: number, open: number, complete: boolean }>}
 */
export async function scanForWallConnectors({
  addresses,
  probe = tcpProbe,
  clientFactory = createWallConnectorClient,
  port = 80,
  connectTimeoutMs = 1000,
  concurrency = 64,
  identifyTimeoutMs = 8000,
  identifyConcurrency = 8,
  deadlineMs = 60 * 1000,
  now = Date.now,
}) {
  const deadline = now() + deadlineMs;
  const late = () => now() >= deadline;
  const open = [];
  let scanned = 0;
  await eachLimited(
    addresses,
    concurrency,
    async (host) => {
      scanned += 1;
      if (await probe(host, port, connectTimeoutMs)) open.push(host);
    },
    late,
  );
  const found = [];
  let identified = 0;
  await eachLimited(
    open,
    identifyConcurrency,
    async (host) => {
      identified += 1;
      const client = clientFactory({ host, timeoutMs: identifyTimeoutMs });
      try {
        const version = await client.version();
        if (typeof version?.serial_number !== 'string') return;
        const vitals = await client.vitals();
        if (!looksLikeWallConnector(version, vitals)) return;
        if (found.some((f) => f.serial === version.serial_number)) return;
        found.push({
          host,
          serial: version.serial_number,
          firmware: version.firmware_version,
          partNumber: version.part_number,
          evseState: vitals.evse_state,
        });
      } catch {
        // Not a Wall Connector (or not answering in time): nothing to keep.
      }
    },
    late,
  );
  // Sorted by address, as a person reads them.
  found.sort((a, b) => ipToInt(a.host) - ipToInt(b.host));
  return {
    found,
    scanned,
    open: open.length,
    complete: scanned === addresses.length && identified === open.length,
  };
}
