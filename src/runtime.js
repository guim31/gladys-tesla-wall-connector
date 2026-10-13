// -----------------------------------------------------------------------------
// The integration's runtime: the configured Wall Connectors, read on the home
// network, publishing to Gladys only what changed.
//
//   - vitals every 15 s, lifetime counters every minute, from the container
//     itself (no device asks for the core's poll: 15 s is in its list, but a
//     charger answering slowly would then make the core wait on it);
//   - a charger is flagged "unreachable" after 3 missed reads in a row; the
//     logs say it once per outage, and once when it answers again;
//   - the chargers are read in parallel, so a slow one delays nobody.
// This started as the Wall Connector part of the Tesla integration 1.1.0; it
// adds the search for chargers on the network (src/wallConnector/scan.js), the
// charging time of the session, and the states read on a real charger.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { wallConnectorHosts } from './config.js';
import {
  HISTORY_REFRESH_MS,
  HISTORY_THRESHOLDS,
  WALL_CONNECTOR_FEATURES,
  buildWallConnectorDevice,
  isSignificantChange,
  isCharging,
  sessionState,
  stateText,
  wallConnectorIds,
  wallConnectorStates,
  wallConnectorTemperatureUnit,
} from './devices/wallConnector.js';
import { createWallConnectorClient } from './wallConnector/client.js';
import {
  DEFAULT_SCAN_RANGES,
  MAX_SCAN_RANGES,
  lanRangesFromSsdp,
  parseScanRange,
  scanForWallConnectors,
  subnet24,
} from './wallConnector/scan.js';
import { wallConnectorTransitions } from './triggers.js';
import { createLines } from './i18n.js';
import { MESSAGES } from './messages.js';

const MINUTE = 60 * 1000;
const MAX_STATES_PER_REQUEST = 100;
const WIDGET_NUDGE_MIN_INTERVAL_MS = 10 * 1000;
// Vitals every 15 s, lifetime counters every minute, and "unreachable" only
// after 3 missed reads in a row (a slow answer is common).
export const WALL_CONNECTOR_POLL_MS = 15 * 1000;
const WALL_CONNECTOR_LIFETIME_MS = MINUTE;
const WALL_CONNECTOR_MAX_FAILURES = 3;

// Widget key (manifest `widgets`), nudged when its computed rows change.
export const WIDGET_KEY = 'wall_connector';

export const STATUS_MESSAGES = { noCharger: MESSAGES.noCharger, unreachable: MESSAGES.unreachable };

const lastDigits = (serial) => `…${String(serial).slice(-4)}`;

// SSDP search run by the core on the search's behalf (manifest
// `network_discovery`): who answers tells which network Gladys is on.
const SSDP_TIMEOUT_SECONDS = 3;

/**
 * An action that failed: thrown, so Gladys shows the message in red. The core
 * (5.1.4) relays the thrown `message` untouched up to the browser, which picks
 * the user's language in a `{ en, fr, de, es }` object; it has no "warning"
 * level.
 */
export class ActionFailure extends Error {
  constructor(message) {
    super(message.en);
    this.message = message;
  }
}

export function createRuntime({
  gladys,
  store,
  logger = createLogger({ name: 'wall-connector' }),
  wallClientFactory = createWallConnectorClient,
  scan = scanForWallConnectors,
  now = Date.now,
}) {
  let config = null;
  let publishedDevicesJson = null;
  let searching = false;
  const published = new Map(); // feature external_id → { serialized, value, at }
  const nudge = { at: 0, timer: null };
  // host → { host, client, serial, version, vitals, energyKwh, reachable, failures, lastLifetimeAt }
  const wallConnectors = new Map();
  let wallTimer = null;
  let wallPolling = null;
  // Gladys refusing the states (disconnected, restarting): one warning when it
  // starts, one line when it accepts them again, not one per read.
  let publishFailing = false;

  // --- Helpers ---------------------------------------------------------------

  const persistedWallConnectors = () => (store.data.wallConnectors ??= {});

  function createdDevice(externalId) {
    return (gladys.devices ?? []).find((device) => device.external_id === externalId);
  }

  // Unit of a feature: the created device's (what Gladys stores the values
  // in), else the one the next discovery would publish.
  function unitResolver(deviceExternalId, built) {
    const created = createdDevice(deviceExternalId);
    return (key) => {
      const externalId = `${deviceExternalId}:${key}`;
      const feature =
        created?.features?.find((f) => f.external_id === externalId) ??
        built.features.find((f) => f.external_id === externalId);
      return feature?.unit;
    };
  }

  function wallConnectorDevice(wc) {
    const several = [...wallConnectors.values()].filter((w) => w.serial).length > 1;
    return buildWallConnectorDevice(gladys, wc.version ?? { serial_number: wc.serial }, {
      language: config.language,
      temperatureUnit: wallConnectorTemperatureUnit(config.units, wc.vitals),
      // Several chargers: tell them apart by the end of their serial number.
      name: several ? `Tesla Wall Connector ${String(wc.serial).slice(-4)}` : undefined,
    });
  }

  function findWallConnector(deviceExternalId) {
    for (const wc of wallConnectors.values()) {
      if (wc.serial && wallConnectorIds(gladys, wc.serial).device === deviceExternalId) return wc;
    }
    return null;
  }

  async function setStatus(connected, message) {
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.warn(`Could not report the connection status: ${err.message}`);
    }
  }

  // --- Publishing ------------------------------------------------------------

  /** Whether a state is worth sending after the last accepted publication. */
  function worthPublishing(key, value, serialized, last, temperatureUnit) {
    if (!last) return true;
    // Measurements: a significant change only, or the value once an hour.
    if (HISTORY_THRESHOLDS[key]) {
      return (
        now() - last.at >= HISTORY_REFRESH_MS ||
        isSignificantChange(key, last.value, value, { temperatureUnit })
      );
    }
    return last.serialized !== serialized;
  }

  /**
   * Publish the states worth it since the last accepted publication (see
   * `worthPublishing`). States of devices the user has not created yet are
   * kept for later: Gladys would drop them (they are re-sent by
   * onDeviceCreated).
   */
  async function publishChanged(deviceExternalId, states, { force = false, temperatureUnit } = {}) {
    const devicesKnown = Array.isArray(gladys.devices);
    if (devicesKnown && !createdDevice(deviceExternalId)) return 0;
    const changed = [];
    for (const { key, value } of states) {
      const externalId = `${deviceExternalId}:${key}`;
      const serialized = JSON.stringify(value);
      const last = published.get(externalId);
      if (!force && !worthPublishing(key, value, serialized, last, temperatureUnit)) continue;
      changed.push({ externalId, serialized, value });
    }
    for (let i = 0; i < changed.length; i += MAX_STATES_PER_REQUEST) {
      const batch = changed.slice(i, i + MAX_STATES_PER_REQUEST);
      try {
        await gladys.publishStates(
          batch.map(({ externalId, value }) =>
            typeof value === 'object'
              ? { device_feature_external_id: externalId, text: value.text }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        const at = now();
        for (const { externalId, serialized, value } of batch) {
          published.set(externalId, { serialized, value, at });
        }
        if (publishFailing) {
          publishFailing = false;
          logger.info('Gladys accepts the states again');
        }
      } catch (err) {
        // Not remembered: the next change (or reconnection) sends it again.
        const line = `Publishing ${batch.length} state(s) failed: ${err.message}`;
        if (publishFailing) logger.debug(line);
        else {
          publishFailing = true;
          logger.warn(line);
        }
      }
    }
    return changed.length;
  }

  async function publishWallConnector(wc, options = {}) {
    if (!wc.serial) return 0;
    const built = wallConnectorDevice(wc);
    const temperatureUnit = unitResolver(
      built.external_id,
      built,
    )(WALL_CONNECTOR_FEATURES.HANDLE_TEMPERATURE);
    const states = wallConnectorStates(wc, { language: config.language, temperatureUnit });
    return publishChanged(built.external_id, states, { ...options, temperatureUnit });
  }

  async function publishTransports() {
    const entries = [...wallConnectors.values()]
      .filter((wc) => wc.serial)
      .map((wc) => ({
        external_id: wallConnectorIds(gladys, wc.serial).device,
        transport: wc.reachable === false ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL,
      }));
    if (entries.length === 0) return;
    try {
      await gladys.publishTransports(entries);
    } catch (err) {
      logger.warn(`Publishing the Wall Connector transports failed: ${err.message}`);
    }
  }

  async function publishAll(options) {
    for (const wc of wallConnectors.values()) await publishWallConnector(wc, options);
  }

  async function publishDevices({ force = false } = {}) {
    const devices = [...wallConnectors.values()].filter((wc) => wc.serial).map(wallConnectorDevice);
    const json = JSON.stringify(devices);
    if (!force && json === publishedDevicesJson) return;
    await gladys.publishDiscoveredDevices(devices);
    publishedDevicesJson = json;
  }

  function nudgeWidget() {
    if (nudge.timer) return;
    const wait = nudge.at + WIDGET_NUDGE_MIN_INTERVAL_MS - now();
    const fire = () => {
      nudge.timer = null;
      nudge.at = now();
      try {
        gladys.requestWidgetRefresh(WIDGET_KEY);
      } catch (err) {
        logger.debug(`Widget nudge skipped: ${err.message}`);
      }
    };
    if (wait <= 0) fire();
    else {
      // Trailing nudge: the last change inside the core's 10 s window still lands.
      nudge.timer = setTimeout(fire, wait);
      nudge.timer.unref?.();
    }
  }

  async function fireTriggers(keys, data) {
    for (const key of keys) {
      try {
        await gladys.publishSceneEvent(key, data);
        logger.debug(`Scene trigger ${key} fired for ${data.device}`);
      } catch (err) {
        logger.warn(`Scene trigger ${key} failed: ${err.message}`);
      }
    }
  }

  // --- Reading the chargers --------------------------------------------------

  /** The serial a host had last time (its device survives an offline restart). */
  function rememberedSerial(host) {
    const entry = Object.entries(persistedWallConnectors()).find(([, v]) => v.host === host);
    return entry ? entry[0] : null;
  }

  async function applyWallConnector(wc, { vitals, energyWh, reachable }) {
    const previous = { vitals: wc.vitals, reachable: wc.reachable };
    if (vitals) wc.vitals = vitals;
    if (reachable !== undefined) wc.reachable = reachable;
    const memory = persistedWallConnectors()[wc.serial] ?? {};
    let memoryChanged = memory.host !== wc.host;
    const next = { ...memory, host: wc.host };
    // A lower lifetime reading (a firmware glitch, a replaced charger) goes
    // through as is: Gladys's energy derivation treats it as a meter reset,
    // where holding the old value would freeze the index for good.
    if (Number.isFinite(energyWh) && energyWh > 0) {
      const kwh = Math.round(energyWh) / 1000;
      if (kwh !== memory.energyKwh) memoryChanged = true;
      next.energyKwh = kwh;
    }
    wc.energyKwh = next.energyKwh ?? null;
    // Charging time of the session, followed here: `session_s` counts from
    // the moment the car was plugged in, not from the start of the charge.
    if (vitals) {
      let seconds = memory.chargeSeconds ?? 0;
      let since = memory.chargeSince ?? null;
      if (vitals.vehicle_connected === false) {
        seconds = 0;
        since = null;
      } else if (isCharging(vitals)) {
        since ??= now();
      } else if (since !== null) {
        seconds += Math.max(0, Math.round((now() - since) / 1000));
        since = null;
      }
      if (seconds !== (memory.chargeSeconds ?? 0) || since !== (memory.chargeSince ?? null)) {
        next.chargeSeconds = seconds;
        next.chargeSince = since;
        memoryChanged = true;
      }
    }
    // Scene triggers: the charger's own session transitions.
    let transitions = [];
    const session = vitals ? sessionState(vitals) : null;
    if (session) {
      transitions = wallConnectorTransitions(
        { sessionState: memory.chargingState },
        { sessionState: session },
      );
      if (session !== memory.chargingState) {
        next.chargingState = session;
        memoryChanged = true;
      }
    }
    if (memoryChanged) {
      persistedWallConnectors()[wc.serial] = next;
      store.touch();
    }
    await publishWallConnector(wc);
    if (transitions.length) {
      const sessionWh = Number(wc.vitals?.session_energy_wh);
      await fireTriggers(transitions, {
        device: wallConnectorIds(gladys, wc.serial).device,
        session_energy: Number.isFinite(sessionWh) ? Math.round(sessionWh / 10) / 100 : null,
      });
    }
    if (previous.reachable !== wc.reachable) {
      await publishTransports();
      await reportStatus();
    }
    if (
      previous.reachable !== wc.reachable ||
      previous.vitals?.evse_state !== wc.vitals?.evse_state ||
      previous.vitals?.vehicle_connected !== wc.vitals?.vehicle_connected ||
      previous.vitals?.contactor_closed !== wc.vitals?.contactor_closed
    ) {
      nudgeWidget();
    }
  }

  async function reportStatus() {
    const all = [...wallConnectors.values()];
    if (all.length === 0) await setStatus(false, STATUS_MESSAGES.noCharger);
    else if (all.some((wc) => wc.reachable)) await setStatus(true);
    else await setStatus(false, STATUS_MESSAGES.unreachable);
  }

  /** One read of a charger: vitals, plus its identity and counters when due. */
  async function pollWallConnector(wc) {
    try {
      if (!wc.version) {
        // Kept only once it has a serial number: without one, the charger
        // would be stored under an "undefined" key in /data.
        const version = await wc.client.version();
        if (!version?.serial_number) throw new Error('no serial number in /api/1/version');
        wc.version = version;
        const known = wc.serial;
        wc.serial = String(version.serial_number);
        if (known !== wc.serial) logger.info(`Wall Connector found at ${wc.host}`);
      }
      const vitals = await wc.client.vitals();
      let energyWh;
      if (now() - wc.lastLifetimeAt >= WALL_CONNECTOR_LIFETIME_MS) {
        energyWh = Number((await wc.client.lifetime())?.energy_wh);
        wc.lastLifetimeAt = now();
      }
      wc.failures = 0;
      if (wc.outageLogged) {
        wc.outageLogged = false;
        logger.info(`Wall Connector ${wc.host} answers again`);
      }
      const firstValues = !wc.vitals;
      await applyWallConnector(wc, { vitals, energyWh, reachable: true });
      // The structure follows the grid (°F on a 60 Hz supply in "auto"), and a
      // charger seen for the first time joins the Discovery screen.
      if (firstValues) await publishDevices().catch((err) => logger.warn(err.message));
      return true;
    } catch (err) {
      wc.failures += 1;
      // One warning per outage: when the charger is flagged unreachable, or at
      // once for an address never seen (a typo in the settings). A single slow
      // answer, common on this firmware, stays in debug, also for a known
      // charger right after a restart.
      const line = err.message.includes(wc.host)
        ? err.message
        : `Wall Connector ${wc.host}: ${err.message}`;
      const neverSeen = !wc.serial && wc.reachable === undefined;
      if (!wc.outageLogged && (wc.failures >= WALL_CONNECTOR_MAX_FAILURES || neverSeen)) {
        wc.outageLogged = true;
        logger.warn(line);
      } else logger.debug(line);
      if (wc.serial && wc.failures >= WALL_CONNECTOR_MAX_FAILURES && wc.reachable !== false) {
        await applyWallConnector(wc, { reachable: false });
      }
      return false;
    }
  }

  // A round still running makes the next one skip.
  async function pollWallConnectors() {
    if (wallPolling) return wallPolling;
    wallPolling = Promise.all([...wallConnectors.values()].map(pollWallConnector)).finally(() => {
      wallPolling = null;
    });
    return wallPolling;
  }

  // --- Lifecycle -------------------------------------------------------------

  async function stop() {
    clearInterval(wallTimer);
    wallTimer = null;
    await wallPolling;
    clearTimeout(nudge.timer);
    nudge.timer = null;
    await store.flush();
  }

  async function start(newConfig) {
    config = newConfig;
    for (const host of wallConnectorHosts(config)) {
      const serial = rememberedSerial(host);
      wallConnectors.set(host, {
        host,
        client: wallClientFactory({ host }),
        serial,
        version: null,
        vitals: null,
        energyKwh: serial ? (persistedWallConnectors()[serial]?.energyKwh ?? null) : null,
        reachable: undefined,
        failures: 0,
        outageLogged: false,
        lastLifetimeAt: 0,
      });
    }
    if (wallConnectors.size > 0) {
      await pollWallConnectors();
      wallTimer = setInterval(
        () => pollWallConnectors().catch((err) => logger.error('Wall Connector read failed', err)),
        WALL_CONNECTOR_POLL_MS,
      );
      wallTimer.unref?.();
    }
    await publishDevices({ force: true });
    await publishTransports();
    await reportStatus();
  }

  async function reconfigure(newConfig) {
    const hostsChanged =
      !config || wallConnectorHosts(newConfig).join(',') !== wallConnectorHosts(config).join(',');
    if (hostsChanged) {
      await stop();
      wallConnectors.clear();
      published.clear();
      publishedDevicesJson = null;
      await start(newConfig);
    } else {
      config = newConfig;
      await publishDevices();
      await publishAll();
    }
    nudgeWidget();
  }

  // --- Search (manifest action) ----------------------------------------------

  /**
   * The /24 networks of the devices answering an SSDP search made by Gladys
   * (the core runs on the host network, the container does not): the network
   * Gladys is on. Empty when nothing answers or the core refuses.
   */
  async function gladysNetworks() {
    try {
      const answers = await gladys.scanNetwork('ssdp', { timeoutSeconds: SSDP_TIMEOUT_SECONDS });
      return lanRangesFromSsdp(answers);
    } catch (err) {
      logger.warn(`The SSDP search of Gladys failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Where to look: the configured range, else the networks of the chargers
   * already configured and of Gladys, else the two most common home networks.
   */
  async function scanTargets() {
    if (config.scan_range) {
      return {
        source: 'config',
        ranges: [config.scan_range],
        ...parseScanRange(config.scan_range),
      };
    }
    const chargers = [...new Set(wallConnectorHosts(config).map(subnet24).filter(Boolean))];
    const lan = (await gladysNetworks()).filter((range) => !chargers.includes(range));
    const ranges = [...chargers, ...lan].slice(0, MAX_SCAN_RANGES);
    if (ranges.length === 0) {
      return {
        source: 'default',
        ranges: DEFAULT_SCAN_RANGES,
        lan: [],
        ...parseScanRange(DEFAULT_SCAN_RANGES.join(',')),
      };
    }
    return {
      source: 'network',
      ranges,
      lan: lan.filter((range) => ranges.includes(range)),
      ...parseScanRange(ranges.join(',')),
    };
  }

  async function searchWallConnectors() {
    if (!config) return STATUS_MESSAGES.noCharger;
    if (searching) return MESSAGES.searchRunning;
    searching = true;
    try {
      return await search();
    } finally {
      searching = false;
    }
  }

  async function search() {
    const startedAt = now();
    const targets = await scanTargets();
    if (targets.invalid.length || targets.notPrivate.length || targets.tooLarge) {
      const bad = [...targets.invalid, ...targets.notPrivate].join(', ');
      throw new ActionFailure(MESSAGES.badRange(bad));
    }
    logger.info(`Searching ${targets.addresses.length} addresses for Wall Connectors`);
    const result = await scan({ addresses: targets.addresses });
    const seconds = Math.max(1, Math.round((now() - startedAt) / 1000));
    const where = targets.ranges.join(', ');
    const lines = createLines();
    lines.add(MESSAGES.searched(result.scanned, where, seconds));
    if (targets.lan?.length) lines.add(MESSAGES.gladysNetwork(targets.lan.join(', ')));
    if (targets.source === 'default') lines.add(MESSAGES.defaultNetworks);
    if (!result.complete) lines.add(MESSAGES.searchIncomplete);

    // Merge into the configured addresses: a known serial at a new address
    // (DHCP) replaces its old address, a new charger is appended.
    const hosts = wallConnectorHosts(config);
    const serialAt = new Map();
    for (const wc of wallConnectors.values()) if (wc.serial) serialAt.set(wc.serial, wc.host);
    for (const [serial, memory] of Object.entries(persistedWallConnectors())) {
      if (!serialAt.has(serial) && memory?.host) serialAt.set(serial, memory.host);
    }
    let changed = false;
    const outcome = (wc) => {
      if (hosts.includes(wc.host)) return MESSAGES.alreadyConfigured;
      const previous = serialAt.get(wc.serial);
      const index = previous ? hosts.indexOf(previous) : -1;
      changed = true;
      if (index >= 0) {
        hosts[index] = wc.host;
        return MESSAGES.newAddress(previous);
      }
      hosts.push(wc.host);
      return MESSAGES.added;
    };
    const found = result.found.map((wc) => ({ wc, outcome: outcome(wc) }));

    if (found.length === 0) {
      lines.add(MESSAGES.noneFound);
      lines.add(MESSAGES.noneFoundHelp);
      throw new ActionFailure(lines.text());
    }
    lines.add(MESSAGES.foundCount(found.length));
    for (const { wc, outcome: o } of found) {
      lines.add(MESSAGES.foundLine(wc.host, lastDigits(wc.serial), wc.firmware, o));
    }
    if (changed) {
      const value = hosts.join(', ');
      try {
        // No config-updated echo for the integration's own write: apply it here.
        await gladys.setConfig({ wall_connectors: value });
        await reconfigure({ ...config, wall_connectors: value });
        lines.add(MESSAGES.saved);
      } catch (err) {
        logger.warn(`Saving the found addresses failed: ${err.message}`);
        lines.add(MESSAGES.saveFailed(value));
      }
    }
    return lines.text();
  }

  // --- Public API ------------------------------------------------------------

  return {
    start,
    stop,
    reconfigure,
    pollWallConnectors,
    searchWallConnectors,

    /** (Re)connected to Gladys: devices and every state again. */
    async resync() {
      published.clear();
      await publishDevices({ force: true });
      await publishAll({ force: true });
      await publishTransports();
      await reportStatus();
      nudgeWidget();
    },

    /** The Discovery tab's scan: read the chargers not identified yet, publish again. */
    async scan() {
      for (const wc of wallConnectors.values()) if (!wc.serial) await pollWallConnector(wc);
      await publishDevices({ force: true });
    },

    /** Gladys created a device: its states were dropped until now. */
    async deviceCreated(device) {
      for (const key of [...published.keys()]) {
        if (key.startsWith(`${device.external_id}:`)) published.delete(key);
      }
      const wc = findWallConnector(device.external_id);
      if (wc) {
        await publishWallConnector(wc, { force: true });
        await publishTransports();
      }
      nudgeWidget();
    },

    /** The core's scheduled poll (not used: no device asks for it). */
    async poll(device) {
      const wc = findWallConnector(device.external_id);
      if (wc) await publishWallConnector(wc, { force: true });
    },

    async setValue() {
      throw new Error('The Wall Connector local API is read-only');
    },

    /** Test action: what each configured address answers. */
    async testWallConnectors() {
      const hosts = config ? wallConnectorHosts(config) : [];
      if (hosts.length === 0) return MESSAGES.noAddress;
      const lines = createLines();
      for (const host of hosts) {
        const probe = wallClientFactory({ host });
        try {
          const version = await probe.version();
          const vitals = await probe.vitals();
          const state = stateText(vitals ?? {}) ?? MESSAGES.stateNumber(vitals?.evse_state);
          const serial = String(version?.serial_number ?? '?');
          const firmware = version?.firmware_version ?? '?';
          lines.add(MESSAGES.testLine(host, lastDigits(serial), firmware, state));
        } catch (err) {
          lines.add(MESSAGES.noAnswer(host, err.message));
        }
      }
      return lines.text();
    },

    /** Read access for the widget. */
    wallConnectorView(deviceExternalId) {
      const wc = findWallConnector(deviceExternalId);
      if (!wc) return null;
      const memory = persistedWallConnectors()[wc.serial] ?? {};
      const since = memory.chargeSince ?? null;
      return {
        device: wallConnectorDevice(wc),
        vitals: wc.vitals ?? {},
        reachable: wc.reachable !== false,
        energyKwh: wc.energyKwh,
        chargingSeconds:
          (memory.chargeSeconds ?? 0) +
          (since === null ? 0 : Math.max(0, Math.round((now() - since) / 1000))),
      };
    },
  };
}
