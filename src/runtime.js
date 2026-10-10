// -----------------------------------------------------------------------------
// The integration's runtime: the configured Wall Connectors, read on the home
// network, publishing to Gladys only what changed.
//
//   - vitals every 15 s, lifetime counters every minute, from the container
//     itself (no device asks for the core's poll: 15 s is in its list, but a
//     charger answering slowly would then make the core wait on it);
//   - a charger is flagged "unreachable" after 3 missed reads in a row;
//   - the chargers are read in parallel, so a slow one delays nobody.
// This is the Wall Connector part of the Tesla integration 1.1.0, unchanged in
// behavior, plus the search for chargers on the network (src/wallConnector/scan.js).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { wallConnectorHosts } from './config.js';
import {
  EVSE_STATES,
  WALL_CONNECTOR_FEATURES,
  buildWallConnectorDevice,
  sessionState,
  wallConnectorIds,
  wallConnectorStates,
  wallConnectorTemperatureUnit,
} from './devices/wallConnector.js';
import { createWallConnectorClient } from './wallConnector/client.js';
import {
  DEFAULT_SCAN_RANGES,
  parseScanRange,
  scanForWallConnectors,
  subnet24,
} from './wallConnector/scan.js';
import { wallConnectorTransitions } from './triggers.js';

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

export const STATUS_MESSAGES = {
  noCharger: {
    en: 'Enter the address of your Wall Connector, or use “Search for Wall Connectors” below.',
    fr: 'Saisissez l’adresse de votre borne, ou utilisez « Rechercher les bornes » ci-dessous.',
  },
  unreachable: {
    en: 'No Wall Connector answers on the home network: check the addresses.',
    fr: 'Aucune Wall Connector ne répond sur le réseau local : vérifiez les adresses.',
  },
};

const lastDigits = (serial) => `…${String(serial).slice(-4)}`;

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
  const published = new Map(); // feature external_id → serialized value
  const nudge = { at: 0, timer: null };
  // host → { host, client, serial, version, vitals, energyKwh, reachable, failures, lastLifetimeAt }
  const wallConnectors = new Map();
  let wallTimer = null;
  let wallPolling = null;

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

  /**
   * Publish the states whose value changed since the last accepted
   * publication. States of devices the user has not created yet are kept for
   * later: Gladys would drop them (they are re-sent by onDeviceCreated).
   */
  async function publishChanged(deviceExternalId, states, { force = false } = {}) {
    const devicesKnown = Array.isArray(gladys.devices);
    if (devicesKnown && !createdDevice(deviceExternalId)) return 0;
    const changed = [];
    for (const { key, value } of states) {
      const externalId = `${deviceExternalId}:${key}`;
      const serialized = JSON.stringify(value);
      if (!force && published.get(externalId) === serialized) continue;
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
        for (const { externalId, serialized } of batch) published.set(externalId, serialized);
      } catch (err) {
        // Not remembered: the next change (or reconnection) sends it again.
        logger.warn(`Publishing ${batch.length} state(s) failed: ${err.message}`);
      }
    }
    return changed.length;
  }

  async function publishWallConnector(wc, options) {
    if (!wc.serial) return 0;
    const built = wallConnectorDevice(wc);
    const states = wallConnectorStates(wc, {
      language: config.language,
      temperatureUnit: unitResolver(
        built.external_id,
        built,
      )(WALL_CONNECTOR_FEATURES.HANDLE_TEMPERATURE),
    });
    return publishChanged(built.external_id, states, options);
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
        logger.info(`Scene trigger ${key} fired for ${data.device}`);
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
      previous.vitals?.vehicle_connected !== wc.vitals?.vehicle_connected
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
        wc.version = await wc.client.version();
        if (!wc.version?.serial_number) throw new Error('no serial number in /api/1/version');
        const known = wc.serial;
        wc.serial = String(wc.version.serial_number);
        if (known !== wc.serial) logger.info(`Wall Connector found at ${wc.host}`);
      }
      const vitals = await wc.client.vitals();
      let energyWh;
      if (now() - wc.lastLifetimeAt >= WALL_CONNECTOR_LIFETIME_MS) {
        energyWh = Number((await wc.client.lifetime())?.energy_wh);
        wc.lastLifetimeAt = now();
      }
      wc.failures = 0;
      const firstValues = !wc.vitals;
      await applyWallConnector(wc, { vitals, energyWh, reachable: true });
      // The structure follows the grid (°F on a 60 Hz supply in "auto"), and a
      // charger seen for the first time joins the Discovery screen.
      if (firstValues) await publishDevices().catch((err) => logger.warn(err.message));
      return true;
    } catch (err) {
      wc.failures += 1;
      if (wc.failures === 1 || wc.failures === WALL_CONNECTOR_MAX_FAILURES) {
        logger.warn(`Wall Connector ${wc.host}: ${err.message}`);
      }
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

  /** Where to look: the configured range, else the chargers' /24, else the defaults. */
  function scanTargets() {
    if (config.scan_range) {
      return {
        source: 'config',
        ranges: [config.scan_range],
        ...parseScanRange(config.scan_range),
      };
    }
    const fromChargers = [
      ...new Set(wallConnectorHosts(config).map(subnet24).filter(Boolean)),
    ].slice(0, 4);
    const ranges = fromChargers.length ? fromChargers : DEFAULT_SCAN_RANGES;
    return {
      source: fromChargers.length ? 'chargers' : 'default',
      ranges,
      ...parseScanRange(ranges.join(',')),
    };
  }

  async function searchWallConnectors() {
    if (!config) return STATUS_MESSAGES.noCharger;
    const targets = scanTargets();
    if (targets.invalid.length || targets.notPrivate.length || targets.tooLarge) {
      const bad = [...targets.invalid, ...targets.notPrivate].join(', ');
      return {
        en:
          `The search range of the configuration is not usable${bad ? ` (${bad})` : ''}.\n` +
          'Give private addresses of your home network, 1,024 at most: a network such as 192.168.1.0/24, or a range such as 192.168.1.10-192.168.1.60.',
        fr:
          `La plage de recherche de la configuration est inutilisable${bad ? ` (${bad})` : ''}.\n` +
          'Indiquez des adresses privées de votre réseau local, 1 024 au plus : un réseau comme 192.168.1.0/24, ou une plage comme 192.168.1.10-192.168.1.60.',
      };
    }
    if (searching) {
      return {
        en: 'A search is already running, wait for its result.',
        fr: 'Une recherche est déjà en cours, attendez son résultat.',
      };
    }
    searching = true;
    const startedAt = now();
    let result;
    try {
      logger.info(`Searching ${targets.addresses.length} addresses for Wall Connectors`);
      result = await scan({ addresses: targets.addresses });
    } finally {
      searching = false;
    }
    const seconds = Math.max(1, Math.round((now() - startedAt) / 1000));
    const where = targets.ranges.join(', ');
    const lines = { en: [], fr: [] };
    lines.en.push(`${result.scanned} addresses searched (${where}) in ${seconds} s.`);
    lines.fr.push(`${result.scanned} adresses explorées (${where}) en ${seconds} s.`);
    if (targets.source === 'default') {
      lines.en.push('No range in the configuration: the two most common home networks were tried.');
      lines.fr.push(
        'Aucune plage dans la configuration : les deux réseaux domestiques les plus courants ont été essayés.',
      );
    }
    if (!result.complete) {
      lines.en.push('The search ran out of time before the end of the range.');
      lines.fr.push('La recherche a manqué de temps avant la fin de la plage.');
    }

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
      if (hosts.includes(wc.host)) return { en: 'already configured', fr: 'déjà configurée' };
      const previous = serialAt.get(wc.serial);
      const index = previous ? hosts.indexOf(previous) : -1;
      changed = true;
      if (index >= 0) {
        hosts[index] = wc.host;
        return {
          en: `new address, replaces ${previous}`,
          fr: `nouvelle adresse, remplace ${previous}`,
        };
      }
      hosts.push(wc.host);
      return { en: 'added to the configuration', fr: 'ajoutée à la configuration' };
    };
    const found = result.found.map((wc) => ({ wc, outcome: outcome(wc) }));

    if (found.length === 0) {
      lines.en.push(
        'No Wall Connector answered.',
        'Check that the charger is connected to your Wi-Fi (Tesla One app), then set the range of your home network in the configuration (e.g. 192.168.1.0/24), or type the charger address.',
      );
      lines.fr.push(
        'Aucune Wall Connector n’a répondu.',
        'Vérifiez que la borne est connectée à votre Wi-Fi (application Tesla One), puis indiquez la plage de votre réseau dans la configuration (ex. 192.168.1.0/24), ou saisissez l’adresse de la borne.',
      );
      return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
    }
    lines.en.push(`Wall Connector(s) found: ${found.length}.`);
    lines.fr.push(`Borne(s) trouvée(s) : ${found.length}.`);
    for (const { wc, outcome: o } of found) {
      lines.en.push(
        `• ${wc.host}: serial ${lastDigits(wc.serial)}, firmware ${wc.firmware}, ${o.en}.`,
      );
      lines.fr.push(
        `• ${wc.host} : numéro de série ${lastDigits(wc.serial)}, firmware ${wc.firmware}, ${o.fr}.`,
      );
    }
    if (changed) {
      const value = hosts.join(', ');
      try {
        // No config-updated echo for the integration's own write: apply it here.
        await gladys.setConfig({ wall_connectors: value });
        await reconfigure({ ...config, wall_connectors: value });
        lines.en.push(
          'The chargers now appear in the Discovery tab. Reload this page before saving the configuration form, or it would put back the old addresses.',
        );
        lines.fr.push(
          'Les bornes apparaissent maintenant dans l’onglet Découverte. Rechargez cette page avant d’enregistrer le formulaire de configuration, sinon il remettrait les anciennes adresses.',
        );
      } catch (err) {
        logger.warn(`Saving the found addresses failed: ${err.message}`);
        lines.en.push(`The configuration could not be saved: type these addresses: ${value}`);
        lines.fr.push(
          `La configuration n’a pas pu être enregistrée : saisissez ces adresses : ${value}`,
        );
      }
    }
    return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
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
      if (hosts.length === 0) {
        return {
          en: 'No Wall Connector address in the configuration: type one, or use “Search for Wall Connectors”.',
          fr: 'Aucune adresse de borne dans la configuration : saisissez-en une, ou utilisez « Rechercher les bornes ».',
        };
      }
      const lines = { en: [], fr: [] };
      for (const host of hosts) {
        const probe = wallClientFactory({ host });
        try {
          const version = await probe.version();
          const vitals = await probe.vitals();
          const state = EVSE_STATES[vitals?.evse_state];
          const serial = String(version?.serial_number ?? '?');
          lines.en.push(
            `${host}: Wall Connector ${lastDigits(serial)}, firmware ${version?.firmware_version ?? '?'}, ${state?.en ?? `state ${vitals?.evse_state}`}.`,
          );
          lines.fr.push(
            `${host} : Wall Connector ${lastDigits(serial)}, firmware ${version?.firmware_version ?? '?'}, ${state?.fr ?? `état ${vitals?.evse_state}`}.`,
          );
        } catch (err) {
          lines.en.push(`${host}: no answer (${err.message}).`);
          lines.fr.push(`${host} : pas de réponse (${err.message}).`);
        }
      }
      return { en: lines.en.join('\n'), fr: lines.fr.join('\n') };
    },

    /** Read access for the widget. */
    wallConnectorView(deviceExternalId) {
      const wc = findWallConnector(deviceExternalId);
      if (!wc) return null;
      return {
        device: wallConnectorDevice(wc),
        vitals: wc.vitals ?? {},
        reachable: wc.reachable !== false,
        energyKwh: wc.energyKwh,
      };
    },
  };
}
