// -----------------------------------------------------------------------------
// Texts that leave the container.
//
// A `device` integration does not receive the language of the user (a widget
// request does): feature names follow the `language` setting of the
// integration, and are frozen by Gladys once the device is created. Widget
// contents and action messages use multi-language objects instead, so the
// browser picks the viewer's language (English when it has none).
//
// Every multi-language text carries the four languages of the Gladys
// interface: test/i18n.test.js checks it.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, English first (the fallback). */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // Wall Connector features (same en/fr texts as the Tesla integration 1.1.0)
  wcConnectorStatus: { en: 'Connector', fr: 'Connecteur', de: 'Anschluss', es: 'Conector' },
  wcChargingState: {
    en: 'Charging state',
    fr: 'État de charge',
    de: 'Ladestatus',
    es: 'Estado de carga',
  },
  wcStatus: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  wcPower: {
    en: 'Charging power',
    fr: 'Puissance de charge',
    de: 'Ladeleistung',
    es: 'Potencia de carga',
  },
  wcSessionEnergy: {
    en: 'Session energy',
    fr: 'Énergie de la session',
    de: 'Energie der Sitzung',
    es: 'Energía de la sesión',
  },
  wcEnergy: {
    en: 'Total energy delivered',
    fr: 'Énergie totale délivrée',
    de: 'Insgesamt abgegebene Energie',
    es: 'Energía total suministrada',
  },
  wcVoltage: {
    en: 'Grid voltage',
    fr: 'Tension du réseau',
    de: 'Netzspannung',
    es: 'Tensión de red',
  },
  wcCurrent: {
    en: 'Vehicle current',
    fr: 'Courant du véhicule',
    de: 'Fahrzeugstrom',
    es: 'Corriente del vehículo',
  },
  wcHandleTemperature: {
    en: 'Handle temperature',
    fr: 'Température de la poignée',
    de: 'Temperatur des Ladegriffs',
    es: 'Temperatura de la empuñadura',
  },
};

/** Feature names, by key: read by test/i18n.test.js. */
export const FEATURE_NAMES = TEXTS;

/** Text in one language (device and feature names). */
export function t(language, key) {
  const entry = TEXTS[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return entry[language] ?? entry.en;
}

/**
 * A multi-line message in every language: `add({ en, fr, de, es })` appends a
 * line, `text()` returns the `{ en, fr, de, es }` object of the joined lines.
 */
export function createLines() {
  const lines = Object.fromEntries(LANGUAGES.map((language) => [language, []]));
  return {
    add(entry) {
      for (const language of LANGUAGES) lines[language].push(entry[language] ?? entry.en);
    },
    get length() {
      return lines.en.length;
    },
    text() {
      return Object.fromEntries(
        LANGUAGES.map((language) => [language, lines[language].join('\n')]),
      );
    },
  };
}

/**
 * A number written the way each language writes it (decimal comma in French,
 * German and Spanish), at most `decimals` places.
 */
export function formatNumber(value, decimals = 2) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      new Intl.NumberFormat(language, { maximumFractionDigits: decimals }).format(value),
    ]),
  );
}
