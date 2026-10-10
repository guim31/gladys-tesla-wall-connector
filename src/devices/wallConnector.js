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
import { t } from '../i18n.js';
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

// `evse_state` of the vitals (Home Assistant's table), with its text and the
// charge-session vocabulary the scene triggers share with the cars.
export const EVSE_STATES = {
  0: { key: 'booting', en: 'Booting', fr: 'Démarrage' },
  1: {
    key: 'not_connected',
    en: 'Vehicle not connected',
    fr: 'Véhicule non branché',
    session: 'Disconnected',
  },
  2: { key: 'connected', en: 'Vehicle connected', fr: 'Véhicule branché', session: 'Stopped' },
  4: { key: 'ready', en: 'Ready to charge', fr: 'Prête à charger', session: 'Stopped' },
  6: { key: 'negotiating', en: 'Negotiating', fr: 'Négociation', session: 'Stopped' },
  7: { key: 'error', en: 'Error', fr: 'Erreur' },
  8: {
    key: 'charging_finished',
    en: 'Charging finished',
    fr: 'Charge terminée',
    session: 'Complete',
  },
  9: {
    key: 'waiting_car',
    en: 'Waiting for the car',
    fr: 'En attente du véhicule',
    session: 'Stopped',
  },
  10: {
    key: 'charging_reduced',
    en: 'Charging (reduced)',
    fr: 'En charge (réduite)',
    session: 'Charging',
  },
  11: { key: 'charging', en: 'Charging', fr: 'En charge', session: 'Charging' },
};
const UNREACHABLE_TEXT = { en: 'Unreachable', fr: 'Injoignable' };
const UNKNOWN_STATE_TEXT = { en: 'State', fr: 'État' };

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
  const state = EVSE_STATES[vitals.evse_state];
  if (state?.session) return state.session;
  if (vitals.vehicle_connected === false) return 'Disconnected';
  return null; // booting, error, unknown: no transition
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
  if (!reachable) return UNREACHABLE_TEXT[language] ?? UNREACHABLE_TEXT.en;
  const state = EVSE_STATES[vitals?.evse_state];
  if (state) return state[language] ?? state.en;
  const label = UNKNOWN_STATE_TEXT[language] ?? UNKNOWN_STATE_TEXT.en;
  return Number.isFinite(vitals?.evse_state) ? `${label} ${vitals.evse_state}` : null;
}

function connectorStatus(vitals, reachable) {
  if (!reachable || vitals.evse_state === 0) return CONNECTOR_STATUS.UNAVAILABLE;
  if (vitals.evse_state === 7) return CONNECTOR_STATUS.FAULTED;
  if (vitals.vehicle_connected === true) return CONNECTOR_STATUS.OCCUPIED;
  if (vitals.vehicle_connected === false) return CONNECTOR_STATUS.AVAILABLE;
  return null;
}

function chargingState(vitals) {
  switch (vitals.evse_state) {
    case 10:
    case 11:
      return CHARGING_STATION_STATE.CHARGING;
    case 2:
    case 4:
    case 6:
      return CHARGING_STATION_STATE.EV_CONNECTED;
    case 9:
      return CHARGING_STATION_STATE.PAUSED_BY_VEHICLE;
    // Gladys's charge session enum expects "idle" only with a car plugged in
    // (OCCUPIED): no car (state 1), nothing is published.
    case 8:
      return vitals.vehicle_connected === false ? null : CHARGING_STATION_STATE.IDLE;
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
