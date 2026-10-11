// -----------------------------------------------------------------------------
// Device type: TESLA WALL CONNECTOR (gen 3), read on the home network.
//
// One Gladys device per charger, keyed on its SERIAL NUMBER (`/api/1/version`):
// the IP address can change with DHCP, the serial never does. Values come from
// `/api/1/vitals` (the live session) and `/api/1/lifetime` (counters).
//
// Power: the charger reports voltages and currents, not the power. Like Home
// Assistant, it is computed per phase (three-phase Europe: VA·IA + VB·IB +
// VC·IC) or, on the North American split-phase supply, grid voltage × vehicle
// current. Home Assistant asks the user which applies; here the grid
// frequency decides (60 Hz: North America, split phase).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { UNIT_SYSTEMS } from '../config.js';
import { LANGUAGES, t } from '../i18n.js';
import { celsiusToFahrenheit, round } from '../units.js';

export const WALL_CONNECTOR_DEVICE_TYPE = 'wall-connector';

// Feature keys: part of the external_id, frozen once published. They are the
// keys of the Tesla integration 1.1.0, kept as they were.
export const WALL_CONNECTOR_FEATURES = {
  CONNECTOR_STATUS: 'connector-status',
  CHARGING_STATE: 'charging-state',
  STATUS: 'status',
  POWER: 'power',
  SESSION_ENERGY: 'session-energy',
  ENERGY: 'energy',
  VOLTAGE: 'voltage',
  CURRENT: 'current',
  HANDLE_TEMPERATURE: 'handle-temperature',
};

// History: the grid voltage, the current, the handle temperature and the
// power move a little at every read (every 15 s), and Gladys keeps each state
// it receives: a real charger stored 2,827 voltage states in under 12 hours.
// Only a significant change is published, measured from the last value
// published, so a slow drift still gets through; and, for the power and the
// current, the return to 0 (the end of a charge). During a charge, the power
// moves by 2 % (150 W at 7.4 kW) before a state, the noise of the current
// (±0.3 A at 32 A, ±100 W) would otherwise publish every other read.
// src/runtime.js republishes the current value once an hour, so Gladys never
// sees the feature as stale.
export const HISTORY_THRESHOLDS = {
  [WALL_CONNECTOR_FEATURES.POWER]: { step: 50, relative: 0.02, zero: true }, // W
  [WALL_CONNECTOR_FEATURES.CURRENT]: { step: 0.5, zero: true }, // A
  [WALL_CONNECTOR_FEATURES.VOLTAGE]: { step: 2 }, // V
  [WALL_CONNECTOR_FEATURES.HANDLE_TEMPERATURE]: { step: 1 }, // °C (1.8 °F)
};
export const HISTORY_REFRESH_MS = 60 * 60 * 1000;

/**
 * Whether `next` is worth a state after `previous`, the last value published.
 * Features without a threshold: any change is.
 * @param {{ temperatureUnit?: string }} options unit of the handle temperature
 */
export function isSignificantChange(key, previous, next, { temperatureUnit } = {}) {
  const rule = HISTORY_THRESHOLDS[key];
  if (!rule || typeof previous !== 'number' || typeof next !== 'number') {
    return JSON.stringify(previous) !== JSON.stringify(next);
  }
  // Back to 0 only: an idle reading wavering between 0 and a few watts must
  // not publish at every read.
  if (rule.zero && next === 0 && previous !== 0) return true;
  const fahrenheit =
    key === WALL_CONNECTOR_FEATURES.HANDLE_TEMPERATURE && temperatureUnit === UNITS.FAHRENHEIT;
  const step = Math.max(
    fahrenheit ? rule.step * 1.8 : rule.step,
    Math.abs(previous) * (rule.relative ?? 0),
  );
  // The epsilon absorbs the float error of a rounded value (16.5 - 16 is 0.5).
  return Math.abs(next - previous) >= step - 1e-9;
}

// Gladys `charging-station/charging-state` (OCPP ChargingStateEnumType).
export const CHARGING_STATION_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
};

// Gladys `charging-station/connector-status` (OCPP ConnectorStatusEnumType).
export const CONNECTOR_STATUS = { AVAILABLE: 0, OCCUPIED: 1, UNAVAILABLE: 3, FAULTED: 4 };

// `evse_state` of the vitals, with its text and the charge-session vocabulary
// the scene triggers share with the cars. Home Assistant's table, corrected by
// the states a user read on a real gen 3 (single phase, a Tesla and a plug-in
// hybrid of another make, October 2026):
//   - 7 is a Tesla plugged in OUTSIDE its charging schedule, not an error: an
//     error only when no car is plugged in or the charger raises an alert
//     (see `isFault`);
//   - 9 also follows the end of a charge; 21 is a Tesla being unplugged;
//   - 10, 12 and 13 were only seen with the non-Tesla car (charging, plugging
//     in, unplugging): "likely a non-Tesla car", from that single test.
// No car plugged in (`vehicle_connected: false`) is always "Disconnected".
export const EVSE_STATES = {
  0: { key: 'booting', en: 'Booting', fr: 'Démarrage', de: 'Startet', es: 'Arrancando' },
  1: {
    key: 'not_connected',
    en: 'Vehicle not connected',
    fr: 'Véhicule non branché',
    de: 'Fahrzeug nicht angeschlossen',
    es: 'Vehículo no enchufado',
    session: 'Disconnected',
  },
  2: {
    key: 'connected',
    en: 'Vehicle connected',
    fr: 'Véhicule branché',
    de: 'Fahrzeug angeschlossen',
    es: 'Vehículo enchufado',
    session: 'Stopped',
  },
  4: {
    key: 'ready',
    en: 'Ready to charge',
    fr: 'Prête à charger',
    de: 'Bereit zum Laden',
    es: 'Listo para cargar',
    session: 'Stopped',
  },
  6: {
    key: 'negotiating',
    en: 'Negotiating',
    fr: 'Négociation',
    de: 'Aushandlung',
    es: 'Negociando',
    session: 'Stopped',
  },
  7: {
    key: 'outside_schedule',
    en: 'Plugged in, outside charging schedule',
    fr: 'Branchée, hors plage de charge',
    de: 'Angeschlossen, außerhalb des Ladeplans',
    es: 'Enchufado, fuera del horario de carga',
    session: 'Stopped',
  },
  8: {
    key: 'charging_finished',
    en: 'Charging finished',
    fr: 'Charge terminée',
    de: 'Laden beendet',
    es: 'Carga terminada',
    session: 'Complete',
  },
  9: {
    key: 'waiting_car',
    en: 'Waiting for the car',
    fr: 'En attente du véhicule',
    de: 'Wartet auf das Fahrzeug',
    es: 'Esperando al vehículo',
    session: 'Stopped',
  },
  10: {
    key: 'charging_other',
    en: 'Charging (likely non-Tesla)',
    fr: 'En charge (non Tesla probable)',
    de: 'Lädt (wohl kein Tesla)',
    es: 'Cargando (probablemente no Tesla)',
    session: 'Charging',
  },
  11: {
    key: 'charging',
    en: 'Charging',
    fr: 'En charge',
    de: 'Lädt',
    es: 'Cargando',
    session: 'Charging',
  },
  12: {
    key: 'connected_other',
    en: 'Plugged in (likely non-Tesla)',
    fr: 'Branchée (non Tesla probable)',
    de: 'Angeschlossen (wohl kein Tesla)',
    es: 'Enchufado (probablemente no Tesla)',
    session: 'Stopped',
  },
  13: {
    key: 'ending_other',
    en: 'Session ending (likely non-Tesla)',
    fr: 'Fin de session (non Tesla probable)',
    de: 'Sitzungsende (wohl kein Tesla)',
    es: 'Fin de sesión (probablemente no Tesla)',
    session: 'Complete',
  },
  21: {
    key: 'ending',
    en: 'Session ending',
    fr: 'Fin de session',
    de: 'Sitzungsende',
    es: 'Fin de sesión',
    session: 'Complete',
  },
};
// Other texts of the state, exported for test/i18n.test.js.
export const STATE_TEXTS = {
  fault: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  unknown: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
};

// Display bounds: 22 kW is the three-phase maximum, 11.5 kW the North
// American one (48 A × 240 V).
const POWER_MAX_W = 25000;

export function wallConnectorIds(gladys, serial) {
  return gladys.externalIds(WALL_CONNECTOR_DEVICE_TYPE, serial);
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** North American split-phase supply (60 Hz grid). */
export function isSplitPhase(vitals) {
  const hz = num(vitals?.grid_hz);
  return hz !== null && hz > 55;
}

/** Power delivered to the car, in W (null when unknown). */
export function chargingPowerW(vitals = {}) {
  if (isSplitPhase(vitals)) {
    const v = num(vitals.grid_v);
    const a = num(vitals.vehicle_current_a);
    return v === null || a === null ? null : v * a;
  }
  let total = 0;
  let known = false;
  for (const phase of ['A', 'B', 'C']) {
    const v = num(vitals[`voltage${phase}_v`]);
    const a = num(vitals[`current${phase}_a`]);
    if (v !== null && a !== null) {
      total += v * a;
      known = true;
    }
  }
  return known ? total : null;
}

/** The charge-session vocabulary of the cars: Charging, Complete, Stopped, Disconnected. */
export function sessionState(vitals = {}) {
  if (isFault(vitals)) return null;
  if (vitals.vehicle_connected === false) return 'Disconnected';
  return EVSE_STATES[vitals.evse_state]?.session ?? null; // booting, unknown: no transition
}

const hasAlerts = (vitals) =>
  Array.isArray(vitals?.current_alerts) && vitals.current_alerts.length > 0;

/**
 * A real fault: state 7 with no car plugged in, or any state 7 with an alert.
 * State 7 with a car and no alert is a car waiting for its charging schedule.
 * `evse_not_ready_reasons` is not used: a car held back by its schedule is
 * "not ready" too, so a reason there is no sign of an error.
 */
export function isFault(vitals = {}) {
  return vitals.evse_state === 7 && (vitals.vehicle_connected !== true || hasAlerts(vitals));
}

/** A car is drawing power: the contactor is closed (else the charging states). */
export function isCharging(vitals = {}) {
  if (typeof vitals.contactor_closed === 'boolean') return vitals.contactor_closed;
  return EVSE_STATES[vitals.evse_state]?.session === 'Charging';
}

/** The state of the vitals as text, `{ en, fr, de, es }` (null when unknown). */
export function stateText(vitals = {}) {
  if (isFault(vitals)) return STATE_TEXTS.fault;
  const state = EVSE_STATES[vitals.evse_state];
  return state
    ? Object.fromEntries(LANGUAGES.map((language) => [language, state[language]]))
    : null;
}

/** Temperature unit: the setting, or the grid (60 Hz: °F) when "auto". */
export function wallConnectorTemperatureUnit(system, vitals) {
  if (system === UNIT_SYSTEMS.IMPERIAL) return UNITS.FAHRENHEIT;
  if (system === UNIT_SYSTEMS.METRIC) return UNITS.CELSIUS;
  return isSplitPhase(vitals) ? UNITS.FAHRENHEIT : UNITS.CELSIUS;
}

/**
 * The discovery payload of one Wall Connector.
 * @param {object} gladys SDK instance
 * @param {{ serial_number: string, part_number?: string }} version `/api/1/version`
 * @param {{ language: string, temperatureUnit: string, name?: string }} options
 */
export function buildWallConnectorDevice(gladys, version, { language, temperatureUnit, name }) {
  const ids = wallConnectorIds(gladys, version.serial_number);
  const feature = (key, label, category, type, extra) => ({
    name: t(language, label),
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
    ...extra,
  });
  return {
    name: name ?? 'Tesla Wall Connector',
    external_id: ids.device,
    model: 'Wall Connector (Gen 3)',
    // Read every 15 s by the container itself.
    should_poll: false,
    features: [
      feature(
        WALL_CONNECTOR_FEATURES.CONNECTOR_STATUS,
        'wcConnectorStatus',
        CATEGORIES.CHARGING_STATION,
        TYPES.CHARGING_STATION.CONNECTOR_STATUS,
        { max: 4 },
      ),
      feature(
        WALL_CONNECTOR_FEATURES.CHARGING_STATE,
        'wcChargingState',
        CATEGORIES.CHARGING_STATION,
        TYPES.CHARGING_STATION.CHARGING_STATE,
        { max: 5 },
      ),
      feature(WALL_CONNECTOR_FEATURES.STATUS, 'wcStatus', CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        max: 0,
      }),
      feature(
        WALL_CONNECTOR_FEATURES.POWER,
        'wcPower',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.POWER,
        { unit: UNITS.WATT, max: POWER_MAX_W },
      ),
      feature(
        WALL_CONNECTOR_FEATURES.SESSION_ENERGY,
        'wcSessionEnergy',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
        { unit: UNITS.KILOWATT_HOUR, max: 500 },
      ),
      // Cumulative: Gladys derives the 30-minute consumption and its cost from
      // it, under the main electric meter (the charger is one of its loads).
      feature(
        WALL_CONNECTOR_FEATURES.ENERGY,
        'wcEnergy',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.INDEX,
        { unit: UNITS.KILOWATT_HOUR, max: 1000000000 },
      ),
      feature(
        WALL_CONNECTOR_FEATURES.VOLTAGE,
        'wcVoltage',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.VOLTAGE,
        { unit: UNITS.VOLT, max: 500 },
      ),
      feature(
        WALL_CONNECTOR_FEATURES.CURRENT,
        'wcCurrent',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.CURRENT,
        { unit: UNITS.AMPERE, max: 80 },
      ),
      feature(
        WALL_CONNECTOR_FEATURES.HANDLE_TEMPERATURE,
        'wcHandleTemperature',
        CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        {
          unit: temperatureUnit,
          min: -40,
          max: temperatureUnit === UNITS.FAHRENHEIT ? 212 : 100,
        },
      ),
    ],
  };
}

/** The status text, in the configured language. */
export function statusText(language, vitals, reachable = true) {
  if (!reachable) return STATE_TEXTS.unreachable[language] ?? STATE_TEXTS.unreachable.en;
  const state = stateText(vitals ?? {});
  if (state) return state[language] ?? state.en;
  const label = STATE_TEXTS.unknown[language] ?? STATE_TEXTS.unknown.en;
  return Number.isFinite(vitals?.evse_state) ? `${label} ${vitals.evse_state}` : null;
}

function connectorStatus(vitals, reachable) {
  if (!reachable || vitals.evse_state === 0) return CONNECTOR_STATUS.UNAVAILABLE;
  if (isFault(vitals)) return CONNECTOR_STATUS.FAULTED;
  if (vitals.vehicle_connected === true) return CONNECTOR_STATUS.OCCUPIED;
  if (vitals.vehicle_connected === false) return CONNECTOR_STATUS.AVAILABLE;
  return null;
}

function chargingState(vitals) {
  // No car plugged in: Gladys's enum has a value only during a session, but a
  // published state cannot be cleared, and the last one ("Charging") would
  // stay on screen. "Idle", as soon as the car leaves (a real test: 11 → 1).
  if (vitals.vehicle_connected === false || vitals.evse_state === 1) {
    return CHARGING_STATION_STATE.IDLE;
  }
  switch (vitals.evse_state) {
    case 10:
    case 11:
      return CHARGING_STATION_STATE.CHARGING;
    case 2:
    case 4:
    case 6:
    case 12:
      return CHARGING_STATION_STATE.EV_CONNECTED;
    // Held back by the charger's schedule (OCPP SuspendedEVSE).
    case 7:
      return isFault(vitals) ? null : CHARGING_STATION_STATE.PAUSED_BY_CHARGER;
    case 9:
      return CHARGING_STATION_STATE.PAUSED_BY_VEHICLE;
    // The session ends, the car still plugged in (OCPP Finishing).
    case 8:
    case 13:
    case 21:
      return CHARGING_STATION_STATE.IDLE;
    default:
      return null;
  }
}

/**
 * States of one Wall Connector.
 * @param {object} snapshot `{ vitals, energyKwh, reachable }`
 * @param {{ language: string, temperatureUnit: string }} options
 * @returns {Array<{ key: string, value: number|{ text: string } }>}
 */
export function wallConnectorStates(snapshot, { language, temperatureUnit }) {
  const vitals = snapshot.vitals ?? {};
  const reachable = snapshot.reachable !== false;
  const F = WALL_CONNECTOR_FEATURES;
  const states = [];
  const push = (key, value) => {
    if (value !== null && value !== undefined && !Number.isNaN(value)) states.push({ key, value });
  };
  push(F.CONNECTOR_STATUS, connectorStatus(vitals, reachable));
  const text = statusText(language, vitals, reachable);
  if (text) push(F.STATUS, { text });
  push(F.ENERGY, snapshot.energyKwh ?? null);
  if (!reachable) return states;
  push(F.CHARGING_STATE, chargingState(vitals));
  const power = chargingPowerW(vitals);
  push(F.POWER, power === null ? null : round(Math.max(0, power)));
  const session = num(vitals.session_energy_wh);
  push(F.SESSION_ENERGY, session === null ? null : round(session / 1000, 2));
  push(F.VOLTAGE, round(num(vitals.grid_v), 1));
  push(F.CURRENT, round(num(vitals.vehicle_current_a), 1));
  const handle = num(vitals.handle_temp_c);
  push(
    F.HANDLE_TEMPERATURE,
    handle === null
      ? null
      : round(temperatureUnit === UNITS.FAHRENHEIT ? celsiusToFahrenheit(handle) : handle, 1),
  );
  return states;
}
