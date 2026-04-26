const SiteConfig = require("../models/siteConfig.js");
const { createMemoryCache } = require("./memoryCache.js");

const cache = createMemoryCache({
  defaultTtlMs: Number(process.env.SITE_CONFIG_CACHE_TTL_MS || 60 * 1000),
  maxEntries: 10,
});

const CACHE_KEY = "site-config:global";

function normalizeConfig(rawConfig = {}) {
  return {
    showTemplateCoinPrice: rawConfig.showTemplateCoinPrice !== false,
  };
}

async function getSiteConfig() {
  return cache.getOrSet(CACHE_KEY, async () => {
    const configDoc = await SiteConfig.findOne({ configKey: "global" })
      .select("showTemplateCoinPrice")
      .lean();

    return normalizeConfig(configDoc || {});
  });
}

async function setTemplateCoinPriceVisibility(isVisible, updatedBy = null) {
  const normalizedValue = Boolean(isVisible);

  const configDoc = await SiteConfig.findOneAndUpdate(
    { configKey: "global" },
    {
      $set: {
        showTemplateCoinPrice: normalizedValue,
        updatedBy: updatedBy || null,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      projection: { showTemplateCoinPrice: 1 },
    }
  ).lean();

  invalidateSiteConfigCache();
  return normalizeConfig(configDoc || { showTemplateCoinPrice: normalizedValue });
}

function invalidateSiteConfigCache() {
  cache.delete(CACHE_KEY);
}

module.exports = {
  getSiteConfig,
  setTemplateCoinPriceVisibility,
  invalidateSiteConfigCache,
};
