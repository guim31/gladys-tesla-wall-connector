// -----------------------------------------------------------------------------
// Scene triggers fired by the integration (manifest `scene_triggers`).
//
// Each one is a TRANSITION observed between two known values: nothing fires on
// the first value ever seen, so a restart or a reconnection never replays an
// event (the last known session state is persisted, see src/store.js).
// The keys are the ones the Tesla integration published in 1.1.0, so a scene
// moved from one integration to the other keeps its trigger.
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  WALL_CONNECTOR_PLUGGED: 'wall_connector_plugged',
  WALL_CONNECTOR_UNPLUGGED: 'wall_connector_unplugged',
  WALL_CONNECTOR_CHARGING_STARTED: 'wall_connector_charging_started',
  WALL_CONNECTOR_CHARGING_FINISHED: 'wall_connector_charging_finished',
};

export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGERS);

/**
 * Wall Connector triggers between two charge session states (see
 * `sessionState` in src/devices/wallConnector.js), in the order things happen:
 * plugged in, then charging.
 * @returns {string[]} trigger keys
 */
export function wallConnectorTransitions(previous, next) {
  const before = previous.sessionState;
  const after = next.sessionState;
  const events = [];
  if (!before || !after || before === after) return events;
  if (before === 'Disconnected') events.push(SCENE_TRIGGERS.WALL_CONNECTOR_PLUGGED);
  if (after === 'Charging') events.push(SCENE_TRIGGERS.WALL_CONNECTOR_CHARGING_STARTED);
  if (after === 'Complete' && before !== 'Disconnected') {
    events.push(SCENE_TRIGGERS.WALL_CONNECTOR_CHARGING_FINISHED);
  }
  if (after === 'Disconnected') events.push(SCENE_TRIGGERS.WALL_CONNECTOR_UNPLUGGED);
  return events;
}
