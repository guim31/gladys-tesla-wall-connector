// -----------------------------------------------------------------------------
// Texts that leave the container.
//
// A `device` integration does not receive the language of the user (a widget
// request does): feature names follow the `language` setting of the
// integration, and are frozen by Gladys once the device is created. Widget
// contents and action messages use multi-language objects instead, so the
// core picks the viewer's language.
// -----------------------------------------------------------------------------

const TEXTS = {
  // Wall Connector features (same texts as the Tesla integration 1.1.0)
  wcConnectorStatus: { en: 'Connector', fr: 'Connecteur' },
  wcChargingState: { en: 'Charging state', fr: 'État de charge' },
  wcStatus: { en: 'Status', fr: 'Statut' },
  wcPower: { en: 'Charging power', fr: 'Puissance de charge' },
  wcSessionEnergy: { en: 'Session energy', fr: 'Énergie de la session' },
  wcEnergy: { en: 'Total energy delivered', fr: 'Énergie totale délivrée' },
  wcVoltage: { en: 'Grid voltage', fr: 'Tension du réseau' },
  wcCurrent: { en: 'Vehicle current', fr: 'Courant du véhicule' },
  wcHandleTemperature: { en: 'Handle temperature', fr: 'Température de la poignée' },
};

/** Text in one language (device and feature names). */
export function t(language, key) {
  const entry = TEXTS[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return entry[language] ?? entry.en;
}
