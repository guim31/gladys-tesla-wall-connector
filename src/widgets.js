// -----------------------------------------------------------------------------
// Dashboard widget (SDK v0.14+, Gladys 5.1+): `wall_connector`, one charger.
//
// Layout. Gladys 5.1.4 has no setting for the number of tile columns: its
// front puts every `value` component in ONE wrapping row of tiles at least
// 96 px wide, whatever the order or the grouping of the components
// (`splitIntoSlots` and `.tile { flex: 1 1 96px }`). Four tiles then show 3 +
// 1 on a usual dashboard column. So three tiles on one line: power, current
// and the energy of the session; the total, longer, is the first row of the
// status list, under the tiles.
//
// Width of a tile. Three tiles share a line only while each one keeps its
// 96 px basis (otherwise the third wraps), so a tile is at least 96 px wide:
// 78 px of content once the padding (8 px each side) and the border are
// removed. The value is set in 1.25rem semibold and its unit in 0.75rem:
// measured in Chromium, '99,9 kWh' takes 65 px in Arial metrics (Roboto,
// Helvetica, San Francisco are alike) and 78 px in DejaVu Sans, the widest
// fallback; '11,29 kWh' takes 75 and 92 px. Hence at most 4 characters for the
// number of a tile (sessionEnergy), and 14 for its label
// (test/i18n.test.js).
//
// The power and current tiles are bound to the device features: they move in
// real time and Gladys converts their unit. The rest is computed here from the
// vitals (live, not from the history): the runtime nudges the widget when the
// state changes (src/runtime.js), the TTL refreshes the energy and the
// durations.
// Read-only, no button: the charger's local API takes no command. Budget of
// the core: 8 components, 6 tiles, 2 texts at most.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  WALL_CONNECTOR_FEATURES,
  isCharging,
  isFault,
  stateText,
} from './devices/wallConnector.js';
import { LANGUAGES, formatNumber } from './i18n.js';
import { WIDGET_TEXTS as T } from './messages.js';
import { WIDGET_KEY } from './runtime.js';

function message(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text }] };
}

// "1 h 05 min" / "12 min" / "0 min", the same in every language.
export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/**
 * The total delivered, for a status row (room for it): whole kWh, grouped the
 * way the language groups thousands ('8 597 kWh'), MWh with one decimal from
 * 100,000 kWh only. The feature keeps its exact value (energy monitoring
 * reads it).
 */
export function totalEnergy(kwh) {
  if (!Number.isFinite(kwh)) return { value: '—' };
  if (kwh >= 100000) return { value: Math.round(kwh / 100) / 10, unit: 'MWh' };
  return { value: Math.round(kwh), unit: 'kWh' };
}

/** `{ en: '12.3 kWh', fr: '12,3 kWh', … }`, or '—' when unknown. */
export function energyText({ value, unit }) {
  if (typeof value !== 'number') return '—';
  const number = formatNumber(value);
  return Object.fromEntries(LANGUAGES.map((language) => [language, `${number[language]} ${unit}`]));
}

/**
 * Energy of the session, from the vitals (Wh), for a tile: kWh with one
 * decimal below 100 kWh, whole from 100, so at most 4 characters up to
 * 999 kWh ('0', '11.3', '99.9', '100'). The front writes the number in the
 * viewer's language ('11,3') and the unit, smaller, after it.
 */
export function sessionEnergy(wh) {
  if (typeof wh !== 'number' || !Number.isFinite(wh)) return { value: '—' };
  const kwh = Math.max(0, wh) / 1000;
  const tenths = Math.round(kwh * 10) / 10;
  return { value: tenths >= 100 ? Math.round(kwh) : tenths, unit: 'kWh' };
}

function wallConnectorContent(view) {
  const { device, vitals, reachable } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const state = stateText(vitals);
  const charging = isCharging(vitals);
  const plugged = vitals.vehicle_connected === true;
  const items = [
    {
      label: T.total,
      icon: 'activity',
      value: energyText(totalEnergy(view.energyKwh)),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: T.status,
      icon: charging ? 'zap' : 'battery',
      value: !reachable ? T.unreachable : (state ?? '—'),
      color:
        !reachable || isFault(vitals)
          ? WIDGET_COLORS.DANGER
          : charging
            ? WIDGET_COLORS.SUCCESS
            : vitals.evse_state === 7
              ? WIDGET_COLORS.INFO
              : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (reachable) {
    items.push({
      label: T.vehicle,
      icon: 'battery-charging',
      value: plugged ? T.pluggedIn : vitals.vehicle_connected === false ? T.notPluggedIn : '—',
      color: plugged ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
    if (plugged) {
      items.push(
        {
          // The charger's `session_s` starts when the car is plugged in.
          label: T.pluggedInFor,
          icon: 'clock',
          value: duration(vitals.session_s),
          color: WIDGET_COLORS.NEUTRAL,
        },
        {
          // Followed by the integration: contactor closed, this session.
          label: T.chargingTime,
          icon: 'zap',
          value: duration(view.chargingSeconds),
          color: charging ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        },
      );
    }
  }
  return {
    // The energy and the durations move: a minute is fine for them; the
    // state rows are nudged on every change by the runtime.
    ttl_seconds: 60,
    components: [
      // One line of three tiles (see the top of this file).
      {
        type: 'value',
        label: T.power,
        icon: 'zap',
        device_feature: ref(WALL_CONNECTOR_FEATURES.POWER),
      },
      {
        type: 'value',
        label: T.current,
        icon: 'trending-up',
        device_feature: ref(WALL_CONNECTOR_FEATURES.CURRENT),
      },
      {
        // The charger keeps the energy of the last session once unplugged.
        type: 'value',
        label: plugged ? T.thisSession : T.lastSession,
        icon: 'battery-charging',
        ...sessionEnergy(vitals.session_energy_wh),
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
          return message(settings?.device ? T.notWallConnector : T.pickDevice);
        }
        return wallConnectorContent(view);
      },
    },
  };
}
