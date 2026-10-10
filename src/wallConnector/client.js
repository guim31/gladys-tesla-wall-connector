// -----------------------------------------------------------------------------
// Tesla Wall Connector (gen 3) local HTTP client.
//
// The Wall Connector answers on the home network, without authentication:
//   GET http://<host>/api/1/vitals       live session (state, power, voltages...)
//   GET http://<host>/api/1/lifetime     lifetime counters (energy_wh...)
//   GET http://<host>/api/1/version      serial number, part number, firmware
//   GET http://<host>/api/1/wifi_status  Wi-Fi link
// Endpoints and quirks follow the `tesla-wall-connector` Python library (MIT,
// used by Home Assistant): the firmware sometimes writes `nan` (not JSON) and
// sometimes drops the closing brace, and it can take a few seconds to answer.
// No Teslemetry, no Tesla account, no cloud.
// -----------------------------------------------------------------------------

export class WallConnectorError extends Error {
  constructor(message, { kind = 'network' } = {}) {
    super(message);
    this.name = 'WallConnectorError';
    this.kind = kind; // 'network' | 'http' | 'decode'
  }
}

/**
 * Parse a Wall Connector JSON body, repairing the two known firmware glitches.
 * @param {string} text
 */
export function parseWallConnectorJson(text) {
  // `"key": nan` is not JSON: the value is unknown, read it as null.
  const body = String(text).replace(/:\s*-?nan\b/gi, ': null');
  try {
    return JSON.parse(body);
  } catch {
    const trimmed = body.trimEnd();
    if (trimmed && !trimmed.endsWith('}')) {
      try {
        return JSON.parse(`${trimmed}}`);
      } catch {
        // fall through
      }
    }
    throw new WallConnectorError('The Wall Connector answered something that is not JSON', {
      kind: 'decode',
    });
  }
}

/**
 * Accept "192.168.1.50", "wallconnector.lan", "192.168.1.50:80", even pasted
 * as "http://192.168.1.50/"; anything else is not a host and is rejected (the
 * value builds a URL).
 * @returns {string|null}
 */
export function normalizeHost(value) {
  const host = String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/.test(host)) return null;
  return host;
}

/** Every host of a free-text list (commas, spaces, semicolons, new lines). */
export function parseHosts(value) {
  const hosts = [];
  for (const entry of String(value ?? '').split(/[\s,;]+/)) {
    const host = normalizeHost(entry);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

// The real answers are under 2 KB: anything far larger is not a Wall Connector.
export const MAX_RESPONSE_BYTES = 64 * 1024;

/** The body as text, refused past `maxBytes` (read as a stream, never buffered whole). */
async function readCapped(response, host, maxBytes) {
  const tooLarge = () =>
    new WallConnectorError(`Wall Connector ${host} answer too large`, { kind: 'decode' });
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * @param {object} options
 * @param {string} options.host IP address or host name (optionally :port)
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs] the Wall Connector can be slow to answer
 */
export function createWallConnectorClient({
  host,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
}) {
  async function get(endpoint) {
    let response;
    try {
      response = await fetchImpl(`http://${host}/api/1/${endpoint}`, {
        headers: { Accept: 'application/json' },
        // The charger never redirects: a redirect would lead off the home network.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new WallConnectorError(`Wall Connector ${host} unreachable (${err.name})`);
    }
    if (!response.ok) {
      throw new WallConnectorError(`Wall Connector ${host} answered ${response.status}`, {
        kind: 'http',
      });
    }
    let text;
    try {
      text = await readCapped(response, host, MAX_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof WallConnectorError) throw err;
      throw new WallConnectorError(`Wall Connector ${host} unreachable (${err.name})`);
    }
    return parseWallConnectorJson(text);
  }

  return {
    host,
    vitals: () => get('vitals'),
    lifetime: () => get('lifetime'),
    version: () => get('version'),
    wifiStatus: () => get('wifi_status'),
  };
}
