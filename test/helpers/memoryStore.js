// -----------------------------------------------------------------------------
// In-memory stand-in for src/store.js: same surface, nothing written to disk.
// -----------------------------------------------------------------------------

export function createMemoryStore(initial) {
  let data = structuredClone(initial ?? { version: 1, wallConnectors: {} });
  return {
    get data() {
      return data;
    },
    async load() {
      return data;
    },
    async flush() {},
    touch() {},
    dump: () => structuredClone(data),
  };
}
