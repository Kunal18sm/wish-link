function createMemoryCache({ defaultTtlMs = 60 * 1000, maxEntries = 500 } = {}) {
  const store = new Map();
  const safeDefaultTtlMs = Math.max(1000, Number(defaultTtlMs) || 60 * 1000);
  const safeMaxEntries = Math.max(10, Number(maxEntries) || 500);

  function isExpired(entry, now = Date.now()) {
    return !entry || entry.expiresAt <= now;
  }

  function evictIfNeeded() {
    while (store.size > safeMaxEntries) {
      const firstKey = store.keys().next().value;
      if (!firstKey) return;
      store.delete(firstKey);
    }
  }

  function get(key) {
    const entry = store.get(String(key));
    if (!entry) return null;

    if (isExpired(entry)) {
      store.delete(String(key));
      return null;
    }

    return entry.value;
  }

  function set(key, value, ttlMs = safeDefaultTtlMs) {
    const safeTtl = Math.max(1000, Number(ttlMs) || safeDefaultTtlMs);
    store.set(String(key), {
      value,
      expiresAt: Date.now() + safeTtl,
    });
    evictIfNeeded();
    return value;
  }

  async function getOrSet(key, resolver, ttlMs = safeDefaultTtlMs) {
    const cachedValue = get(key);
    if (cachedValue !== null) return cachedValue;

    const resolvedValue = await resolver();
    return set(key, resolvedValue, ttlMs);
  }

  function del(key) {
    store.delete(String(key));
  }

  function clear() {
    store.clear();
  }

  function deleteByPrefix(prefix) {
    const safePrefix = String(prefix || "");
    if (!safePrefix) return;

    for (const key of store.keys()) {
      if (key.startsWith(safePrefix)) {
        store.delete(key);
      }
    }
  }

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (isExpired(entry, now)) {
        store.delete(key);
      }
    }
  }, Math.min(safeDefaultTtlMs, 60 * 1000));

  cleanupInterval.unref();

  return {
    get,
    set,
    getOrSet,
    delete: del,
    clear,
    deleteByPrefix,
  };
}

module.exports = {
  createMemoryCache,
};
