const BannerConfig = require("../models/bannerConfig.js");
const { createMemoryCache } = require("./memoryCache.js");

const BANNER_PAGES = Object.freeze({
  HOME: "home",
  COLLECTION: "collection",
});

const DEFAULT_BANNER_SLIDES = Object.freeze({
  [BANNER_PAGES.HOME]: [
    {
      title: "Play and Win Free Template",
      imageUrl:
        "https://res.cloudinary.com/drzq6kjgp/image/upload/v1770794063/Gemini_Generated_Image_4qzfxy4qzfxy4qzf_l5tidy.png",
      linkUrl: "/game/",
      altText: "Play and win free template game on VishLink",
      isActive: true,
      sortOrder: 0,
    },
    {
      title: "Best-Selling Birthday Templates",
      imageUrl:
        "https://res.cloudinary.com/dcw90tnk1/image/upload/v1768805703/wishLink_dev/zehl3lsqfj0gdsaguevn.jpg",
      linkUrl: "/category/birthday",
      altText: "Best-selling birthday template preview on VishLink",
      isActive: true,
      sortOrder: 1,
    },
    {
      title: "Valentine's Day Special",
      imageUrl:
        "https://res.cloudinary.com/dcw90tnk1/image/upload/v1769509941/thumbnailV_k7rfkr.jpg",
      linkUrl: "/category/valentine's",
      altText: "Valentine's Day template preview on VishLink",
      isActive: true,
      sortOrder: 2,
    },
  ],
  [BANNER_PAGES.COLLECTION]: [
    {
      title: "Play and Win Free Template",
      imageUrl:
        "https://res.cloudinary.com/drzq6kjgp/image/upload/v1770794063/Gemini_Generated_Image_4qzfxy4qzfxy4qzf_l5tidy.png",
      linkUrl: "/game/",
      altText: "Play and win free template game on VishLink",
      isActive: true,
      sortOrder: 0,
    },
    {
      title: "Best-Selling Birthday Templates",
      imageUrl:
        "https://res.cloudinary.com/dcw90tnk1/image/upload/v1768805703/wishLink_dev/zehl3lsqfj0gdsaguevn.jpg",
      linkUrl: "/category/birthday",
      altText: "Best-selling birthday template preview on VishLink",
      isActive: true,
      sortOrder: 1,
    },
    {
      title: "Valentine's Day Special",
      imageUrl:
        "https://res.cloudinary.com/dcw90tnk1/image/upload/v1769509941/thumbnailV_k7rfkr.jpg",
      linkUrl: "/category/valentine's",
      altText: "Valentine's Day template preview on VishLink",
      isActive: true,
      sortOrder: 2,
    },
  ],
});

const cache = createMemoryCache({
  defaultTtlMs: Number(process.env.BANNER_CONFIG_CACHE_TTL_MS || 60 * 1000),
  maxEntries: 20,
});

const CACHE_KEY_PREFIX = "banner-config:";

function normalizePage(page) {
  return String(page || "").trim().toLowerCase() === BANNER_PAGES.COLLECTION
    ? BANNER_PAGES.COLLECTION
    : BANNER_PAGES.HOME;
}

function cloneSlides(slides) {
  return (Array.isArray(slides) ? slides : []).map((slide, index) => ({
    title: String(slide?.title || "").trim(),
    imageUrl: String(slide?.imageUrl || "").trim(),
    imagePublicId: String(slide?.imagePublicId || "").trim(),
    linkUrl: String(slide?.linkUrl || "/").trim() || "/",
    altText: String(slide?.altText || "").trim(),
    isActive: slide?.isActive !== false,
    sortOrder: Number.isFinite(Number(slide?.sortOrder)) ? Number(slide.sortOrder) : index,
  }));
}

function getDefaultSlides(page) {
  const normalizedPage = normalizePage(page);
  return cloneSlides(DEFAULT_BANNER_SLIDES[normalizedPage]);
}

function normalizeSlidesForRender(rawSlides, page) {
  const slides = cloneSlides(rawSlides)
    .filter((slide) => slide.isActive && slide.imageUrl)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return slides.length ? slides : getDefaultSlides(page);
}

async function getBannerSlides(page) {
  const normalizedPage = normalizePage(page);
  const cacheKey = `${CACHE_KEY_PREFIX}${normalizedPage}`;

  return cache.getOrSet(cacheKey, async () => {
    const doc = await BannerConfig.findOne({ page: normalizedPage })
      .select("slides")
      .lean();

    return normalizeSlidesForRender(doc?.slides, normalizedPage);
  });
}

async function getEditableBannerConfig(page) {
  const normalizedPage = normalizePage(page);
  const doc = await BannerConfig.findOne({ page: normalizedPage })
    .select("page slides")
    .lean();

  const rawSlides = Array.isArray(doc?.slides) && doc.slides.length
    ? doc.slides
    : getDefaultSlides(normalizedPage);

  return {
    page: normalizedPage,
    slides: cloneSlides(rawSlides),
  };
}

function invalidateBannerConfigCache(page) {
  if (page) {
    cache.delete(`${CACHE_KEY_PREFIX}${normalizePage(page)}`);
    return;
  }

  cache.deleteByPrefix(CACHE_KEY_PREFIX);
}

module.exports = {
  BANNER_PAGES,
  getBannerSlides,
  getEditableBannerConfig,
  invalidateBannerConfigCache,
};
