// -----------------------------------------------------------------------------
// Dashboard widget (SDK v0.14+, Gladys 5.1+): `wall_connector`, one charger.
//
// Live tiles bound to the device features (they move in real time and Gladys
// converts their unit to the viewer's preference), and a status list computed
// here: the runtime nudges the widget when it changes (src/runtime.js), the
// TTL is a safety net. Read-only, no button: the charger's local API takes no
// command. Budget of the core: 8 components, 2 texts at most.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { EVSE_STATES, WALL_CONNECTOR_FEATURES } from './devices/wallConnector.js';
import { WIDGET_KEY } from './runtime.js';

const pickDevice = {
  en: 'Choose a Wall Connector in the widget settings.',
  fr: 'Choisissez une borne dans les réglages du widget.',
};

function message(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text }] };
}

// "1 h 05 min" / "12 min": the session duration, in both languages.
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function wallConnectorContent(view) {
  const { device, vitals, reachable } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const state = EVSE_STATES[vitals.evse_state];
  const charging = vitals.evse_state === 10 || vitals.evse_state === 11;
  const stateRow = {
    label: { en: 'Status', fr: 'Statut' },
    icon: charging ? 'zap' : 'battery',
    value: !reachable
      ? { en: 'Unreachable', fr: 'Injoignable' }
      : state
        ? { en: state.en, fr: state.fr }
        : '—',
    color: !reachable
      ? WIDGET_COLORS.DANGER
      : vitals.evse_state === 7
        ? WIDGET_COLORS.DANGER
        : charging
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.NEUTRAL,
  };
  const items = [stateRow];
  if (reachable) {
    items.push(
      {
        label: { en: 'Vehicle', fr: 'Véhicule' },
        icon: 'battery-charging',
        value:
          vitals.vehicle_connected === true
            ? { en: 'Plugged in', fr: 'Branché' }
            : vitals.vehicle_connected === false
              ? { en: 'Not plugged in', fr: 'Non branché' }
              : '—',
        color: vitals.vehicle_connected ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
      },
      {
        label: { en: 'Session duration', fr: 'Durée de la session' },
        icon: 'clock',
        value: vitals.vehicle_connected ? duration(vitals.session_s) : '—',
        color: WIDGET_COLORS.NEUTRAL,
      },
    );
  }
  return {
    // The session duration moves: a minute is fine for it; the state rows
    // are nudged on every change by the runtime.
    ttl_seconds: 60,
    components: [
      {
        type: 'value',
        label: { en: 'Power', fr: 'Puissance' },
        icon: 'zap',
        device_feature: ref(WALL_CONNECTOR_FEATURES.POWER),
      },
      {
        type: 'value',
        label: { en: 'This session', fr: 'Cette session' },
        icon: 'battery-charging',
        device_feature: ref(WALL_CONNECTOR_FEATURES.SESSION_ENERGY),
      },
      {
        type: 'value',
        label: { en: 'Total', fr: 'Total' },
        icon: 'activity',
        device_feature: ref(WALL_CONNECTOR_FEATURES.ENERGY),
      },
      {
        type: 'value',
        label: { en: 'Current', fr: 'Courant' },
        icon: 'trending-up',
        device_feature: ref(WALL_CONNECTOR_FEATURES.CURRENT),
      },
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
