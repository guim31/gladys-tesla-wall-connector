// -----------------------------------------------------------------------------
// Integration configuration: defaults (they MUST match the `default` values of
// the manifest `config_schema`, see test/manifest.test.js) and normalization,
// so the rest of the code never deals with `undefined` or form strings.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './i18n.js';
import { parseHosts } from './wallConnector/client.js';

export const UNIT_SYSTEMS = { AUTO: 'auto', METRIC: 'metric', IMPERIAL: 'imperial' };
export { LANGUAGES };

export const DEFAULT_CONFIG = {
  wall_connectors: '',
  scan_range: '',
  units: UNIT_SYSTEMS.AUTO,
  language: 'en',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  return {
    wall_connectors: String(config.wall_connectors ?? ''),
    scan_range: String(config.scan_range ?? '').trim(),
    units: Object.values(UNIT_SYSTEMS).includes(config.units) ? config.units : DEFAULT_CONFIG.units,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}

/** Wall Connector addresses of the configuration (invalid entries dropped). */
export function wallConnectorHosts(config) {
  return parseHosts(config?.wall_connectors);
}
