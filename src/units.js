// -----------------------------------------------------------------------------
// Unit helpers. The Wall Connector reports temperatures in °C; the published
// unit is a user choice (the `units` setting), since scenes compare the raw
// value while the dashboard converts to each viewer's preference.
// -----------------------------------------------------------------------------

export const celsiusToFahrenheit = (c) => (c * 9) / 5 + 32;

/** Round to `decimals` places, keeping null/undefined as null. */
export function round(value, decimals = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
