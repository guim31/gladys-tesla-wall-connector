// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Everything Wall Connector lives in src/runtime.js.
//
// The Gladys supervisor injects GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR; `new GladysIntegration()` reads them.
// Every handler is registered BEFORE connect().
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createStore } from './src/store.js';
import { createRuntime } from './src/runtime.js';
import { createWidgets } from './src/widgets.js';
import { MESSAGES } from './src/messages.js';

const gladys = new GladysIntegration();
const store = createStore({ logger });
const runtime = createRuntime({ gladys, store });
let started = false;

gladys.onScanRequest(() => runtime.scan());

// The local API is read-only: every command is refused with a clear message.
gladys.onSetValue((device, feature, value) => runtime.setValue(device, feature, value));

// No device is published with `should_poll`: the runtime reads the chargers
// itself. Kept as a cheap republication of the known values.
gladys.onPoll((device) => runtime.poll(device));

// Gladys drops the states of a feature that does not exist yet: send them
// again now that it does, and let the widget bind to it.
gladys.onDeviceCreated((device) => runtime.deviceCreated(device));
gladys.onDeviceUpdated((device) => runtime.deviceCreated(device));

gladys.onAction('scan_wall_connectors', () => runtime.searchWallConnectors());
gladys.onAction('test_wall_connector', () => runtime.testWallConnectors());

for (const [key, widget] of Object.entries(createWidgets(runtime))) {
  gladys.onWidgetGet(key, (request) => widget.get(request));
}

gladys.onConfigUpdated(async (newConfig) => {
  logger.info('Configuration updated');
  await runtime.reconfigure(normalizeConfig(newConfig));
});

gladys.on('connected', async () => {
  try {
    if (!started) {
      started = true;
      await store.load();
      await runtime.start(normalizeConfig(await gladys.getConfig()));
    } else {
      // Reconnected to Gladys: what was published while disconnected was lost.
      await runtime.resync();
    }
  } catch (err) {
    logger.error('Initialization failed', err);
    await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
  }
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}, stopping`);
  await runtime.stop();
});

logger.info('Starting the Tesla Wall Connector integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
