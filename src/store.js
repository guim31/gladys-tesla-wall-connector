// -----------------------------------------------------------------------------
// Small JSON persistence under /data, the container's only writable volume.
//
// What survives a restart, per charger serial number: its last address (so a
// charger offline at startup keeps its device), its last energy index, and its
// last charge session state (so a restart neither misses nor repeats a
// "charging finished"). Writes are debounced and atomic (temporary file +
// rename).
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';

export function createStore({ dir = DEFAULT_DATA_DIR, debounceMs = 5000, logger } = {}) {
  const file = join(dir, 'wall-connector-state.json');
  let data = { version: 1, wallConnectors: {} };
  let timer = null;
  let writing = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && parsed.version === 1) {
        data = { version: 1, wallConnectors: {}, ...parsed };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') logger?.warn(`Ignoring unreadable ${file}: ${err.message}`);
    }
    return data;
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const snapshot = JSON.stringify(data);
    writing = writing.then(async () => {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${file}.tmp`, snapshot);
        await rename(`${file}.tmp`, file);
      } catch (err) {
        logger?.warn(`Could not save ${file}: ${err.message}`);
      }
    });
    return writing;
  }

  return {
    load,
    flush,
    get data() {
      return data;
    },
    /** Ask for a write soon; several changes in a row make one write. */
    touch() {
      if (!timer) {
        timer = setTimeout(flush, debounceMs);
        timer.unref?.();
      }
    },
  };
}
