const WebSample = require("../models/WebSample.js");
const { createMemoryCache } = require("./memoryCache.js");

const cache = createMemoryCache({
  defaultTtlMs: Number(process.env.WEB_SAMPLE_CACHE_TTL_MS || 60 * 1000),
  maxEntries: 400,
});

const CACHE_KEYS = {
  HOME: "web-sample:home",
  CATEGORY_PREFIX: "web-sample:category:",
  BY_ID_PREFIX: "web-sample:id:",
};

const HOME_SELECT_FIELDS = [
  "webName",
  "description",
  "imageUrl",
  "webUrl",
  "priceForTemporary",
  "priceForPermanent",
  "priority",
].join(" ");

function withIdField(doc) {
  if (!doc) return doc;
  return {
    ...doc,
    id: String(doc._id),
  };
}

async function getHomeSamples() {
  return cache.getOrSet(CACHE_KEYS.HOME, async () => {
    const docs = await WebSample.find({})
      .select(HOME_SELECT_FIELDS)
      .sort({ priority: -1, _id: -1 })
      .lean();
    return docs.map(withIdField);
  });
}

async function getCategorySamples(tag) {
  const normalizedTag = String(tag || "").trim().toLowerCase();
  const cacheKey = `${CACHE_KEYS.CATEGORY_PREFIX}${normalizedTag}`;

  return cache.getOrSet(cacheKey, async () => {
    const docs = await WebSample.find({ tags: normalizedTag })
      .select(HOME_SELECT_FIELDS)
      .sort({ priority: -1, _id: -1 })
      .lean();
    return docs.map(withIdField);
  });
}

async function getTemplateByIdCached(id, selectFields, ttlMs) {
  const safeId = String(id || "").trim();
  const projection = String(selectFields || "").trim();

  if (!safeId || !projection) {
    return null;
  }

  const cacheKey = `${CACHE_KEYS.BY_ID_PREFIX}${safeId}:${projection}`;
  return cache.getOrSet(cacheKey, async () => {
    const doc = await WebSample.findById(safeId).select(projection).lean();
    return withIdField(doc);
  }, ttlMs);
}

function invalidateWebSampleCache(templateId) {
  cache.delete(CACHE_KEYS.HOME);
  cache.deleteByPrefix(CACHE_KEYS.CATEGORY_PREFIX);

  if (templateId) {
    cache.deleteByPrefix(`${CACHE_KEYS.BY_ID_PREFIX}${String(templateId)}:`);
    return;
  }

  cache.deleteByPrefix(CACHE_KEYS.BY_ID_PREFIX);
}

module.exports = {
  getHomeSamples,
  getCategorySamples,
  getTemplateByIdCached,
  invalidateWebSampleCache,
};
