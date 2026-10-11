// -----------------------------------------------------------------------------
// Dashboard widget (SDK v0.14+, Gladys 5.1+): `wall_connector`, one charger.
//
// Live tiles bound to the device features (they move in real time and Gladys
// converts their unit to the viewer's preference), the total rounded here,
// and a status list computed here: the runtime nudges the widget when it changes (src/runtime.js), the
// TTL is a safety net. Read-only, no button: the charger's local API takes no
// command. Budget of the core: 8 components, 2 texts at most.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  WALL_CONNECTOR_FEATURES,
  isCharging,
  isFault,
  stateText,
} from './devices/wallConnector.js';
import { WIDGET_KEY } from './runtime.js';

const pickDevice = {
  en: 'Choose a Wall Connector in the widget settings.',
  fr: 'Choisissez une borne dans les réglages du widget.',
};

function message(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text }] };
}

// "1 h 05 min" / "12 min" / "0 min", in both languages.
export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/**
 * The total delivered, short enough for a tile: a live kWh tile shows
 * "8596.7 kWh", cut by the tile width. MWh from 1,000 kWh, whole kWh from
 * 100. The feature keeps its exact value (energy monitoring reads it).
 */
export function totalEnergy(kwh) {
  if (!Number.isFinite(kwh)) return { value: '—' };
  if (kwh >= 1000) return { value: Math.round(kwh / 10) / 100, unit: 'MWh' };
  if (kwh >= 100) return { value: Math.round(kwh), unit: 'kWh' };
  return { value: Math.round(kwh * 10) / 10, unit: 'kWh' };
}

function wallConnectorContent(view) {
  const { device, vitals, reachable } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const state = stateText(vitals);
  const charging = isCharging(vitals);
  const plugged = vitals.vehicle_connected === true;
  const stateRow = {
    label: { en: 'Status', fr: 'Statut' },
    icon: charging ? 'zap' : 'battery',
    value: !reachable ? { en: 'Unreachable', fr: 'Injoignable' } : (state ?? '—'),
    color:
      !reachable || isFault(vitals)
        ? WIDGET_COLORS.DANGER
        : charging
          ? WIDGET_COLORS.SUCCESS
          : vitals.evse_state === 7
            ? WIDGET_COLORS.INFO
            : WIDGET_COLORS.NEUTRAL,
  };
  const items = [stateRow];
  if (reachable) {
    items.push({
      label: { en: 'Vehicle', fr: 'Véhicule' },
      icon: 'battery-charging',
      value: plugged
        ? { en: 'Plugged in', fr: 'Branché' }
        : vitals.vehicle_connected === false
          ? { en: 'Not plugged in', fr: 'Non branché' }
          : '—',
      color: plugged ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
    if (plugged) {
      items.push(
        {
          // The charger's `session_s` starts when the car is plugged in.
          label: { en: 'Plugged in for', fr: 'Branché depuis' },
          icon: 'clock',
          value: duration(vitals.session_s),
          color: WIDGET_COLORS.NEUTRAL,
        },
        {
          // Followed by the integration: contactor closed, this session.
          label: { en: 'Charging time', fr: 'Durée de charge' },
          icon: 'zap',
          value: duration(view.chargingSeconds),
          color: charging ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        },
      );
    }
  }
  const total = totalEnergy(view.energyKwh);
  return {
    // The durations move: a minute is fine for them; the state rows are
    // nudged on every change by the runtime.
    ttl_seconds: 60,
    // Two rows of tiles: what moves live (power, current), then the energy.
    components: [
      {
        type: 'value',
        label: { en: 'Power', fr: 'Puissance' },
        icon: 'zap',
        device_feature: ref(WALL_CONNECTOR_FEATURES.POWER),
      },
      {
        type: 'value',
        label: { en: 'Current', fr: 'Courant' },
        icon: 'trending-up',
        device_feature: ref(WALL_CONNECTOR_FEATURES.CURRENT),
      },
      {
        type: 'value',
        // The charger keeps the energy of the last session once unplugged.
        label: plugged
          ? { en: 'This session', fr: 'Cette session' }
          : { en: 'Last session', fr: 'Dernière session' },
        icon: 'battery-charging',
        device_feature: ref(WALL_CONNECTOR_FEATURES.SESSION_ENERGY),
      },
      { type: 'value', label: { en: 'Total', fr: 'Total' }, icon: 'activity', ...total },
      { type: 'status', items },
    ],
  };
}

/**
 * Widgets, keyed like the manifest. `runtime` is src/runtime.js.
 */
export function createWidgets(runtime) {
  return {
    [WIDGET_KEY]: {
      async get({ settings }) {
        const view = settings?.device ? runtime.wallConnectorView(settings.device) : null;
        if (!view) {
          return message(
            settings?.device
              ? {
                  en: 'This device is not a Tesla Wall Connector.',
                  fr: "Cet appareil n'est pas une borne Tesla Wall Connector.",
                }
              : pickDevice,
          );
        }
        return wallConnectorContent(view);
      },
    },
  };
}
