const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");

const purchasedWeb = require("../models/purchasedWeb.js");
const WebSample = require("../models/WebSample.js");
const BannerConfig = require("../models/bannerConfig.js");
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const { cloudinary, storage, permanentCloudinaryOptions } = require("../cloudConfig.js");
const {
  getEditableBannerConfig,
  invalidateBannerConfigCache,
  BANNER_PAGES,
} = require("../utils/bannerConfigCache.js");
const {
  cache,
  getAdminUsersCacheKey,
  invalidateAdminUsersCache,
} = require("../utils/runtimeCaches.js");

const router = express.Router({ mergeParams: true });

const REQUEST_SCOPE = {
  DEFAULT: "default",
  PERMANENT: "permanent",
};
const USERS_PAGE_LIMIT = 20;
const REQUEST_CARD_SELECT = "webName sender receiver price paymentProofUrl webUrl isLive isTemporary author";
const PROFILE_PURCHASE_SELECT = "webName webUrl receiver price isLive isTemporary date author";
const MAX_BANNER_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_BANNER_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const bannerImageFileFilter = (_req, file, cb) => {
  if (!ALLOWED_BANNER_UPLOAD_MIME_TYPES.has(file?.mimetype)) {
    return cb(new Error("Invalid file type. Only JPG, JPEG, PNG, and WEBP images are allowed."));
  }
  return cb(null, true);
};

const bannerUpload = multer({
  storage,
  fileFilter: bannerImageFileFilter,
  limits: {
    fileSize: MAX_BANNER_UPLOAD_SIZE_BYTES,
    files: 80,
  },
});

function handleBannerUpload(req, res, next) {
  bannerUpload.any()(req, res, (err) => {
    if (!err) return next();

    const redirectWithError = () => {
      req.flash("error", String(err?.message || "Banner image upload failed. Please try again."));
      return res.redirect("/requests/banner");
    };

    const uploadedPublicIds = (Array.isArray(req.files) ? req.files : [])
      .map((file) => String(file?.filename || "").trim())
      .filter(Boolean);

    if (!uploadedPublicIds.length) {
      return redirectWithError();
    }

    Promise.allSettled(
      uploadedPublicIds.map((publicId) => cloudinary.uploader.destroy(publicId))
    ).finally(redirectWithError);
    return undefined;
  });
}

function runBannerUpload(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, async (err) => {
      if (!err) return next();

      const uploadedFiles = Array.isArray(req.files)
        ? req.files
        : req.file
          ? [req.file]
          : [];

      const uploadedPublicIds = uploadedFiles
        .map((file) => String(file?.filename || "").trim())
        .filter(Boolean);

      if (uploadedPublicIds.length) {
        await Promise.allSettled(
          uploadedPublicIds.map((publicId) => cloudinary.uploader.destroy(publicId))
        );
      }

      req.flash("error", String(err?.message || "Banner image upload failed. Please try again."));
      return res.redirect("/requests/banner");
    });
  };
}

const handleSingleBannerImageUpload = runBannerUpload(bannerUpload.single("imageFile"));

function getRequestScope(req) {
  const rawScope = String(req.query.scope || REQUEST_SCOPE.DEFAULT).toLowerCase();
  if (rawScope === REQUEST_SCOPE.PERMANENT) return REQUEST_SCOPE.PERMANENT;
  return REQUEST_SCOPE.DEFAULT;
}

function parseUsersPage(rawPage) {
  const parsedPage = Number.parseInt(rawPage, 10);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) return 1;
  return Math.min(parsedPage, 500);
}

function escapeRegex(rawValue) {
  return String(rawValue || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSafeReturnPath(rawPath) {
  const fallbackPath = "/requests/users";
  const candidatePath = String(rawPath || "").trim();

  if (!candidatePath.startsWith("/requests/users")) return fallbackPath;
  return candidatePath;
}

function getRequestsHomePath(scope) {
  return scope === REQUEST_SCOPE.PERMANENT ? "/requests/permanent" : "/requests";
}

function getDeleteRedirectPath(req, scope) {
  if (!req.user?.isAdmin) return "/profile";
  return req.get("Referrer") || getRequestsHomePath(scope);
}

function getPurchaseModelByScope(req, scope) {
  if (scope === REQUEST_SCOPE.DEFAULT) return purchasedWeb;

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (!permanentModel) return null;
  return permanentModel;
}

function parseLegacyBannerSlides(rawSlides) {
  const slideEntries = Array.isArray(rawSlides)
    ? rawSlides
    : Object.values(rawSlides || {});

  const parsed = slideEntries
    .map((entry, index) => {
      const title = String(entry?.title || "").trim().slice(0, 120);
      const imageUrl = String(entry?.imageUrl || "").trim().slice(0, 1200);
      const imagePublicId = String(entry?.imagePublicId || "").trim().slice(0, 300);
      const linkUrl = String(entry?.linkUrl || "/").trim().slice(0, 1024) || "/";
      const altText = String(entry?.altText || "").trim().slice(0, 180);
      const sortOrderRaw = Number(entry?.sortOrder);
      const sortOrder = Number.isFinite(sortOrderRaw) ? sortOrderRaw : index;
      const isActive = Boolean(
        entry?.isActive === true ||
        String(entry?.isActive || "").toLowerCase() === "on"
      );

      return {
        title,
        imageUrl,
        imagePublicId,
        linkUrl,
        altText,
        sortOrder,
        isActive,
      };
    })
    .filter((slide) => slide.imageUrl);

  return parsed.sort((a, b) => a.sortOrder - b.sortOrder);
}

function parseBannerSlidesPayload(rawPayload) {
  if (Array.isArray(rawPayload)) return rawPayload;
  if (typeof rawPayload !== "string") return [];

  const normalizedPayload = rawPayload.trim();
  if (!normalizedPayload) return [];

  const parsed = JSON.parse(normalizedPayload);
  return Array.isArray(parsed) ? parsed : [];
}

function parseBooleanValue(rawValue, fallback = true) {
  if (typeof rawValue === "boolean") return rawValue;
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  return true;
}

function parseBannerSlidesFromPayload(rawSlidesPayload, uploadedFileMap) {
  const slides = Array.isArray(rawSlidesPayload) ? rawSlidesPayload : [];

  const normalizedSlides = slides
    .map((slide, index) => {
      const fileFieldName = String(slide?.fileFieldName || "").trim();
      const uploadedFile = fileFieldName ? uploadedFileMap.get(fileFieldName) : null;

      const uploadedImageUrl = String(uploadedFile?.path || "").trim();
      const uploadedPublicId = String(uploadedFile?.filename || "").trim();
      const existingImageUrl = String(slide?.existingImageUrl || "").trim();
      const existingPublicId = String(slide?.existingImagePublicId || "").trim();
      const imageUrl = uploadedImageUrl || existingImageUrl;
      const imagePublicId = uploadedPublicId || existingPublicId;
      const title = String(slide?.title || "").trim().slice(0, 120);
      const linkUrl = String(slide?.linkUrl || "/").trim().slice(0, 1024) || "/";
      const altText = String(slide?.altText || "").trim().slice(0, 180);
      const sortOrderRaw = Number(slide?.sortOrder);
      const sortOrder = Number.isFinite(sortOrderRaw) ? sortOrderRaw : index;
      const isActive = parseBooleanValue(slide?.isActive, true);

      return {
        title,
        imageUrl,
        imagePublicId,
        linkUrl,
        altText,
        sortOrder,
        isActive,
      };
    })
    .filter((slide) => slide.imageUrl);

  return normalizedSlides.sort((a, b) => a.sortOrder - b.sortOrder);
}

function collectSlidePublicIds(slides) {
  const ids = new Set();
  for (const slide of Array.isArray(slides) ? slides : []) {
    const publicId = String(slide?.imagePublicId || "").trim();
    if (!publicId) continue;
    ids.add(publicId);
  }
  return ids;
}

function normalizeBannerPage(rawPage) {
  const normalizedPage = String(rawPage || "").trim().toLowerCase();
  if (normalizedPage === BANNER_PAGES.HOME) return BANNER_PAGES.HOME;
  if (normalizedPage === BANNER_PAGES.COLLECTION) return BANNER_PAGES.COLLECTION;
  return null;
}

function parseBannerIndex(rawIndex) {
  const parsed = Number.parseInt(rawIndex, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

async function cleanupBannerUploadedFile(file) {
  const publicId = String(file?.filename || "").trim();
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
}

function normalizeBannerSlideInput(input = {}, fallbackSortOrder = 0) {
  const title = String(input?.title || "").trim().slice(0, 120);
  const linkUrl = String(input?.linkUrl || "/").trim().slice(0, 1024) || "/";
  const altText = String(input?.altText || "").trim().slice(0, 180);
  const sortOrderRaw = Number(input?.sortOrder);
  const sortOrder = Number.isFinite(sortOrderRaw) ? sortOrderRaw : fallbackSortOrder;
  const isActive = parseBooleanValue(input?.isActive, false);

  return {
    title,
    linkUrl,
    altText,
    sortOrder,
    isActive,
  };
}

function toScopedDocs(docs, scope) {
  return docs.map((doc) => ({
    ...(typeof doc.toObject === "function" ? doc.toObject() : doc),
    requestScope: scope,
  }));
}

async function loadMergedPurchases(req, authorId) {
  const permanentModel = req.app.locals.permanentPurchasedWeb;
  const normalQuery = purchasedWeb
    .find({ author: authorId })
    .select(PROFILE_PURCHASE_SELECT)
    .lean();
  const permanentQuery = permanentModel
    ? permanentModel.find({ author: authorId }).select(PROFILE_PURCHASE_SELECT).lean()
    : Promise.resolve([]);

  const [normalLinks, permanentLinks] = await Promise.all([normalQuery, permanentQuery]);
  const merged = normalLinks.map((item) => ({
    ...item,
    requestScope: REQUEST_SCOPE.DEFAULT,
  }));

  if (permanentLinks.length) {
    merged.push(
      ...permanentLinks.map((item) => ({
        ...item,
        requestScope: REQUEST_SCOPE.PERMANENT,
      }))
    );
  }

  merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return merged;
}

async function buildActiveLinksCountMap(req, authorIds) {
  const countMap = new Map(authorIds.map((authorId) => [String(authorId), 0]));
  if (!authorIds.length) return countMap;

  const defaultCountsPromise = purchasedWeb.aggregate([
    { $match: { author: { $in: authorIds } } },
    { $group: { _id: "$author", count: { $sum: 1 } } },
  ]);

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  const permanentCountsPromise = permanentModel
    ? permanentModel.aggregate([
      { $match: { author: { $in: authorIds } } },
      { $group: { _id: "$author", count: { $sum: 1 } } },
    ])
    : Promise.resolve([]);

  const [defaultCounts, permanentCounts] = await Promise.all([
    defaultCountsPromise,
    permanentCountsPromise,
  ]);

  defaultCounts.forEach((entry) => {
    const key = String(entry._id);
    countMap.set(key, (countMap.get(key) || 0) + Number(entry.count || 0));
  });

  permanentCounts.forEach((entry) => {
    const key = String(entry._id);
    countMap.set(key, (countMap.get(key) || 0) + Number(entry.count || 0));
  });

  return countMap;
}

async function fetchAdminUsersPage(req, searchTerm, page) {
  const normalizedSearchTerm = String(searchTerm || "")
    .trim()
    .slice(0, 64);
  const cacheKey = getAdminUsersCacheKey(normalizedSearchTerm, page);

  return cache.getOrSet(cacheKey, async () => {
    const skip = (page - 1) * USERS_PAGE_LIMIT;
    const matchStage = {};

    if (normalizedSearchTerm) {
      matchStage.username = {
        $regex: escapeRegex(normalizedSearchTerm),
        $options: "i",
      };
    }

    const usersList = await user.aggregate([
      { $match: matchStage },
      { $sort: { _id: -1 } },
      { $skip: skip },
      { $limit: USERS_PAGE_LIMIT + 1 },
      {
        $project: {
          username: 1,
          email: 1,
          winnerCount: 1,
          isAdmin: 1,
          date: 1,
          totalLinksCreated: {
            $size: {
              $ifNull: ["$webCollection", []],
            },
          },
        },
      },
    ]);

    const hasMore = usersList.length > USERS_PAGE_LIMIT;
    const pagedUsers = usersList.slice(0, USERS_PAGE_LIMIT);
    const authorIds = pagedUsers.map((entry) => entry._id);
    const activeLinksCountMap = await buildActiveLinksCountMap(req, authorIds);

    const usersWithCounts = pagedUsers.map((entry) => ({
      id: String(entry._id),
      username: entry.username,
      email: entry.email,
      winnerCount: Number(entry.winnerCount || 0),
      isAdmin: Boolean(entry.isAdmin),
      date: entry.date,
      totalLinksCreated: Number(entry.totalLinksCreated || 0),
      activeLinksCount: Number(activeLinksCountMap.get(String(entry._id)) || 0),
    }));

    return {
      users: usersWithCounts,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
      searchTerm: normalizedSearchTerm,
      page,
    };
  }, 30 * 1000);
}

// get default requests page
router.get(
  "/users",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const searchTerm = String(req.query.search || "")
      .trim()
      .slice(0, 64);
    const page = parseUsersPage(req.query.page);
    const usersPageData = await fetchAdminUsersPage(req, searchTerm, page);

    return res.render("adminUsers", {
      adminUsers: usersPageData.users,
      searchTerm: usersPageData.searchTerm,
      hasMore: usersPageData.hasMore,
      nextPage: usersPageData.nextPage,
      currentPage: usersPageData.page,
      pageLimit: USERS_PAGE_LIMIT,
      title: "Manage Users - VishLink Admin",
      description: "View, search and manage VishLink users from one place.",
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/users/load",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const searchTerm = String(req.query.search || "")
      .trim()
      .slice(0, 64);
    const page = parseUsersPage(req.query.page);
    const usersPageData = await fetchAdminUsersPage(req, searchTerm, page);

    return res.json({
      ok: true,
      users: usersPageData.users,
      hasMore: usersPageData.hasMore,
      nextPage: usersPageData.nextPage,
      currentPage: usersPageData.page,
    });
  })
);

router.post(
  "/users/:id/credits",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const returnTo = getSafeReturnPath(req.body?.returnTo);
    const winnerCount = Number.parseInt(req.body?.winnerCount, 10);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid user id.");
      return res.redirect(returnTo);
    }

    if (!Number.isInteger(winnerCount) || winnerCount < 0 || winnerCount > 1000000) {
      req.flash("error", "Credits must be a number between 0 and 1000000.");
      return res.redirect(returnTo);
    }

    const updatedUser = await user.findByIdAndUpdate(
      req.params.id,
      { winnerCount },
      { new: true }
    );

    if (!updatedUser) {
      req.flash("error", "User not found.");
      return res.redirect(returnTo);
    }

    invalidateAdminUsersCache();
    req.flash("success", `Credits updated for @${updatedUser.username}.`);
    return res.redirect(returnTo);
  })
);

router.get(
  "/banner",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    const [homeConfig, collectionConfig] = await Promise.all([
      getEditableBannerConfig(BANNER_PAGES.HOME),
      getEditableBannerConfig(BANNER_PAGES.COLLECTION),
    ]);

    return res.render("bannerManager", {
      homeConfig,
      collectionConfig,
      title: "Banner Manager - VishLink Admin",
      description: "Manage dynamic home and collection page banners.",
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/banner/:page/new",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const page = normalizeBannerPage(req.params.page);
    if (!page) {
      req.flash("error", "Invalid banner page.");
      return res.redirect("/requests/banner");
    }

    return res.render("bannerSlideEditor", {
      mode: "create",
      bannerPage: page,
      slideIndex: null,
      slide: {
        title: "",
        imageUrl: "",
        imagePublicId: "",
        linkUrl: "/",
        altText: "",
        sortOrder: 0,
        isActive: true,
      },
      title: `Add ${page} Banner - VishLink Admin`,
      description: `Add a new ${page} page banner slide.`,
      robots: "noindex, nofollow",
    });
  })
);

router.post(
  "/banner/:page/new",
  isLoggedIn,
  isAdmin,
  handleSingleBannerImageUpload,
  wrapAsync(async (req, res) => {
    const page = normalizeBannerPage(req.params.page);
    const uploadedFile = req.file || null;

    if (!page) {
      await cleanupBannerUploadedFile(uploadedFile);
      req.flash("error", "Invalid banner page.");
      return res.redirect("/requests/banner");
    }

    const parsedInput = normalizeBannerSlideInput(req.body, 0);
    const imageUrl = String(uploadedFile?.path || "").trim();
    const imagePublicId = String(uploadedFile?.filename || "").trim();

    if (!imageUrl) {
      req.flash("error", "Please upload banner image.");
      return res.redirect(`/requests/banner/${page}/new`);
    }

    try {
      const config = await getEditableBannerConfig(page);
      const slides = Array.isArray(config?.slides) ? config.slides : [];
      const nextSlide = {
        ...parsedInput,
        imageUrl,
        imagePublicId,
        sortOrder:
          Number.isFinite(Number(parsedInput.sortOrder))
            ? Number(parsedInput.sortOrder)
            : slides.length,
      };

      slides.push(nextSlide);

      await BannerConfig.findOneAndUpdate(
        { page },
        { slides, updatedBy: req.user._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      invalidateBannerConfigCache(page);

      req.flash("success", "New banner added successfully.");
      return res.redirect("/requests/banner");
    } catch (err) {
      await cleanupBannerUploadedFile(uploadedFile);
      throw err;
    }
  })
);

router.get(
  "/banner/:page/:index/edit",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const page = normalizeBannerPage(req.params.page);
    const index = parseBannerIndex(req.params.index);

    if (!page || index === null) {
      req.flash("error", "Invalid banner selection.");
      return res.redirect("/requests/banner");
    }

    const config = await getEditableBannerConfig(page);
    const slides = Array.isArray(config?.slides) ? config.slides : [];
    const selectedSlide = slides[index];

    if (!selectedSlide) {
      req.flash("error", "Selected banner not found.");
      return res.redirect("/requests/banner");
    }

    return res.render("bannerSlideEditor", {
      mode: "edit",
      bannerPage: page,
      slideIndex: index,
      slide: selectedSlide,
      title: `Edit ${page} Banner - VishLink Admin`,
      description: `Edit banner slide ${index + 1} for ${page} page.`,
      robots: "noindex, nofollow",
    });
  })
);

router.post(
  "/banner/:page/:index",
  isLoggedIn,
  isAdmin,
  handleSingleBannerImageUpload,
  wrapAsync(async (req, res) => {
    const page = normalizeBannerPage(req.params.page);
    const index = parseBannerIndex(req.params.index);
    const uploadedFile = req.file || null;

    if (!page || index === null) {
      await cleanupBannerUploadedFile(uploadedFile);
      req.flash("error", "Invalid banner selection.");
      return res.redirect("/requests/banner");
    }

    const config = await getEditableBannerConfig(page);
    const slides = Array.isArray(config?.slides) ? config.slides : [];
    const currentSlide = slides[index];

    if (!currentSlide) {
      await cleanupBannerUploadedFile(uploadedFile);
      req.flash("error", "Selected banner not found.");
      return res.redirect("/requests/banner");
    }

    const parsedInput = normalizeBannerSlideInput(req.body, index);
    const uploadedImageUrl = String(uploadedFile?.path || "").trim();
    const uploadedImagePublicId = String(uploadedFile?.filename || "").trim();
    const currentImageUrl = String(currentSlide?.imageUrl || "").trim();
    const currentImagePublicId = String(currentSlide?.imagePublicId || "").trim();
    const nextImageUrl = uploadedImageUrl || currentImageUrl;
    const nextImagePublicId = uploadedImagePublicId || currentImagePublicId;

    if (!nextImageUrl) {
      await cleanupBannerUploadedFile(uploadedFile);
      req.flash("error", "Banner image is required.");
      return res.redirect(`/requests/banner/${page}/${index}/edit`);
    }

    slides[index] = {
      ...currentSlide,
      ...parsedInput,
      imageUrl: nextImageUrl,
      imagePublicId: nextImagePublicId,
    };

    try {
      await BannerConfig.findOneAndUpdate(
        { page },
        { slides, updatedBy: req.user._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (
        uploadedImagePublicId &&
        currentImagePublicId &&
        currentImagePublicId !== uploadedImagePublicId
      ) {
        await cloudinary.uploader.destroy(currentImagePublicId);
      }

      invalidateBannerConfigCache(page);
      req.flash("success", "Banner updated successfully.");
      return res.redirect("/requests/banner");
    } catch (err) {
      await cleanupBannerUploadedFile(uploadedFile);
      throw err;
    }
  })
);

router.post(
  "/banner/:page/:index/delete",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const page = normalizeBannerPage(req.params.page);
    const index = parseBannerIndex(req.params.index);

    if (!page || index === null) {
      req.flash("error", "Invalid banner selection.");
      return res.redirect("/requests/banner");
    }

    const config = await getEditableBannerConfig(page);
    const slides = Array.isArray(config?.slides) ? config.slides : [];

    if (!slides[index]) {
      req.flash("error", "Selected banner not found.");
      return res.redirect("/requests/banner");
    }

    if (slides.length <= 1) {
      req.flash("error", "At least one banner is required on each page.");
      return res.redirect(`/requests/banner/${page}/${index}/edit`);
    }

    const [removedSlide] = slides.splice(index, 1);

    await BannerConfig.findOneAndUpdate(
      { page },
      { slides, updatedBy: req.user._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const removablePublicId = String(removedSlide?.imagePublicId || "").trim();
    if (removablePublicId) {
      await cloudinary.uploader.destroy(removablePublicId);
    }

    invalidateBannerConfigCache(page);
    req.flash("success", "Banner deleted successfully.");
    return res.redirect("/requests/banner");
  })
);

router.post(
  "/banner",
  isLoggedIn,
  isAdmin,
  handleBannerUpload,
  wrapAsync(async (req, res) => {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const uploadedFileMap = new Map(
      uploadedFiles
        .filter((file) => file?.fieldname)
        .map((file) => [String(file.fieldname), file])
    );
    const uploadedPublicIds = uploadedFiles
      .map((file) => String(file?.filename || "").trim())
      .filter(Boolean);

    const cleanupUploadedFiles = async () => {
      if (!uploadedPublicIds.length) return;
      await Promise.allSettled(
        uploadedPublicIds.map((publicId) => cloudinary.uploader.destroy(publicId))
      );
    };

    let homeSlidesPayload = [];
    let collectionSlidesPayload = [];

    try {
      homeSlidesPayload = parseBannerSlidesPayload(req.body?.homeSlidesPayload);
      collectionSlidesPayload = parseBannerSlidesPayload(req.body?.collectionSlidesPayload);
    } catch (_err) {
      await cleanupUploadedFiles();
      req.flash("error", "Banner form data is invalid. Please reload and try again.");
      return res.redirect("/requests/banner");
    }

    const homeSlides = homeSlidesPayload.length
      ? parseBannerSlidesFromPayload(homeSlidesPayload, uploadedFileMap)
      : parseLegacyBannerSlides(req.body?.homeSlides);
    const collectionSlides = collectionSlidesPayload.length
      ? parseBannerSlidesFromPayload(collectionSlidesPayload, uploadedFileMap)
      : parseLegacyBannerSlides(req.body?.collectionSlides);

    if (!homeSlides.length || !collectionSlides.length) {
      await cleanupUploadedFiles();
      req.flash("error", "Please keep at least one valid slide in both Home and Collection banners.");
      return res.redirect("/requests/banner");
    }

    try {
      const [previousHomeConfig, previousCollectionConfig] = await Promise.all([
        BannerConfig.findOne({ page: BANNER_PAGES.HOME }).select("slides").lean(),
        BannerConfig.findOne({ page: BANNER_PAGES.COLLECTION }).select("slides").lean(),
      ]);

      await Promise.all([
        BannerConfig.findOneAndUpdate(
          { page: BANNER_PAGES.HOME },
          { slides: homeSlides, updatedBy: req.user._id },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ),
        BannerConfig.findOneAndUpdate(
          { page: BANNER_PAGES.COLLECTION },
          { slides: collectionSlides, updatedBy: req.user._id },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ),
      ]);

      const previousIds = new Set([
        ...collectSlidePublicIds(previousHomeConfig?.slides),
        ...collectSlidePublicIds(previousCollectionConfig?.slides),
      ]);
      const nextIds = new Set([
        ...collectSlidePublicIds(homeSlides),
        ...collectSlidePublicIds(collectionSlides),
      ]);
      const removablePublicIds = Array.from(previousIds).filter((publicId) => !nextIds.has(publicId));

      if (removablePublicIds.length) {
        await Promise.allSettled(
          removablePublicIds.map((publicId) => cloudinary.uploader.destroy(publicId))
        );
      }

      invalidateBannerConfigCache(BANNER_PAGES.HOME);
      invalidateBannerConfigCache(BANNER_PAGES.COLLECTION);

      req.flash("success", "Banner settings updated successfully.");
      return res.redirect("/requests/banner");
    } catch (err) {
      await cleanupUploadedFiles();
      throw err;
    }
  })
);

router.get(
  "/",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const userPurchased = toScopedDocs(
      await purchasedWeb
        .find({ adminInterected: false })
        .select(REQUEST_CARD_SELECT)
        .sort({ _id: -1 })
        .lean(),
      REQUEST_SCOPE.DEFAULT
    );

    res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.DEFAULT,
      title: "Admin Requests - VishLink",
      description: "Admin panel to manage user purchase requests.",
      robots: "noindex, nofollow",
    });
  })
);

// get permanent requests page (secondary DB)
router.get(
  "/permanent",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const permanentModel = getPurchaseModelByScope(req, REQUEST_SCOPE.PERMANENT);
    if (!permanentModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    const userPurchased = toScopedDocs(
      await permanentModel
        .find({ adminInterected: false })
        .select(REQUEST_CARD_SELECT)
        .sort({ _id: -1 })
        .lean(),
      REQUEST_SCOPE.PERMANENT
    );

    return res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.PERMANENT,
      title: "Permanent Requests - VishLink",
      description: "Admin panel to manage permanent link purchase requests.",
      robots: "noindex, nofollow",
    });
  })
);

// request accepted
router.get(
  "/accept/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const requestedScope = getRequestScope(req);
    const permanentModel = getPurchaseModelByScope(req, REQUEST_SCOPE.PERMANENT);
    let requestScope = requestedScope;
    let PurchaseModel = getPurchaseModelByScope(req, requestScope);
    let redirectPath = getRequestsHomePath(requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    let web = await PurchaseModel.findByIdAndUpdate(
      id,
      {
        isLive: true,
        adminInterected: true,
      },
      {
        new: true,
        projection: { webName: 1 },
      }
    );

    // Safety fallback: if scope is missing in URL but id exists in permanent DB,
    // still apply accept action in second DB.
    if (!web && requestedScope === REQUEST_SCOPE.DEFAULT && permanentModel) {
      const permanentWeb = await permanentModel.findByIdAndUpdate(
        id,
        {
          isLive: true,
          adminInterected: true,
        },
        {
          new: true,
          projection: { webName: 1 },
        }
      );

      if (permanentWeb) {
        web = permanentWeb;
        requestScope = REQUEST_SCOPE.PERMANENT;
        PurchaseModel = permanentModel;
        redirectPath = getRequestsHomePath(requestScope);
      }
    }

    if (!web) {
      req.flash("error", "Request not found.");
      return res.redirect(redirectPath);
    }

    await WebSample.findOneAndUpdate({ webName: web.webName }, { $inc: { soldOut: 1 } });

    invalidateAdminUsersCache();
    req.flash("success", "Request Accepted");
    return res.redirect(redirectPath);
  })
);

// get expired websites (temporary scope only)
router.get(
  "/expired",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const userPurchased = toScopedDocs(
      await purchasedWeb
        .find({ date: { $lte: tenDaysAgo }, isTemporary: true })
        .select(REQUEST_CARD_SELECT)
        .sort({ _id: -1 })
        .lean(),
      REQUEST_SCOPE.DEFAULT
    );

    res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.DEFAULT,
      title: "Expired Websites - Admin | VishLink",
      description: "Admin panel to manage expired websites.",
      robots: "noindex, nofollow",
    });
  })
);

// get all live websites (supports default/permanent scope)
router.get(
  "/allLive",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const requestScope = getRequestScope(req);
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    const userPurchased = toScopedDocs(
      await PurchaseModel.find({ isLive: true })
        .select(REQUEST_CARD_SELECT)
        .sort({ _id: -1 })
        .lean(),
      requestScope
    );

    return res.render("requests", {
      userPurchased,
      requestScope,
      title:
        requestScope === REQUEST_SCOPE.PERMANENT
          ? "Live Permanent Websites - Admin | VishLink"
          : "Live Websites - Admin | VishLink",
      description: "Admin panel to view all live websites.",
      robots: "noindex, nofollow",
    });
  })
);

// delete purchased web
router.delete(
  "/delete/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const requestScope = getRequestScope(req);
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);
    const redirectPath = getDeleteRedirectPath(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/profile");
    }

    const toDelete = await PurchaseModel.findById(req.params.id);
    if (!toDelete) {
      return res.redirect(redirectPath);
    }

    const isOwner = String(toDelete.author) === String(req.user._id);
    if (!req.user?.isAdmin && !isOwner) {
      req.flash("error", "You are not allowed to delete this link.");
      return res.redirect("/profile");
    }

    if (requestScope === REQUEST_SCOPE.PERMANENT && !permanentCloudinaryOptions) {
      req.flash("error", "Permanent cloud storage is not configured.");
      return res.redirect(redirectPath);
    }

    const destroyOptions =
      requestScope === REQUEST_SCOPE.PERMANENT ? permanentCloudinaryOptions : null;
    const allPublicIds = [
      ...(Array.isArray(toDelete.images) ? toDelete.images.map((image) => image.filename) : []),
      toDelete.paymentProofUrl?.filename,
    ].filter(Boolean);

    await Promise.allSettled(
      allPublicIds.map((publicId) =>
        destroyOptions
          ? cloudinary.uploader.destroy(publicId, destroyOptions)
          : cloudinary.uploader.destroy(publicId)
      )
    );

    await PurchaseModel.findByIdAndDelete(req.params.id);
    invalidateAdminUsersCache();
    req.flash("success", "Deleted");
    return res.redirect(redirectPath);
  })
);

// edit permanent link
router.get(
  "/edit/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const requestScope = getRequestScope(req);
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    const userPurchased = await PurchaseModel.findById(req.params.id)
      .select("webName author price sender webUrl");
    if (!userPurchased) {
      req.flash("error", "Request not found.");
      return res.redirect(getRequestsHomePath(requestScope));
    }

    return res.render("edit", { userPurchased, requestScope });
  })
);

router.post(
  "/updateLink/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const requestScope = getRequestScope(req);
    const permanent = req.body.purchase || {};
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    await PurchaseModel.findByIdAndUpdate(id, {
      webUrl: permanent.url,
      isLive: true,
      adminInterected: true,
    });

    const userId = permanent.author;
    if (
      userId &&
      mongoose.Types.ObjectId.isValid(userId) &&
      mongoose.Types.ObjectId.isValid(id)
    ) {
      await user.updateOne(
        {
          _id: userId,
          "webCollection.purchasedId": new mongoose.Types.ObjectId(id),
        },
        {
          $set: {
            "webCollection.$.permanentLink": permanent.url,
          },
        }
      );
    }

    invalidateAdminUsersCache();
    req.flash("success", "Permanent link updated");
    return res.redirect(getRequestsHomePath(requestScope));
  })
);

router.get(
  "/userProfile/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid user id.");
      return res.redirect("/requests/users");
    }

    const profileUser = await user
      .findById(req.params.id)
      .select("_id username email winnerCount webCollection")
      .lean();
    if (!profileUser) {
      req.flash("error", "User not found.");
      return res.redirect("/requests/users");
    }

    const purchasedLinks = await loadMergedPurchases(req, req.params.id);
    const viewHistory = false;

    res.render("profile", {
      profileUser,
      totalLinksCreated: profileUser.webCollection?.length || 0,
      purchasedLinks,
      viewHistory,
      title: `${profileUser.username} - User Profile`,
      description: `Admin view for ${profileUser.username} profile and links.`,
      canonical: `https://wishlink-7j0a.onrender.com/requests/userProfile/${profileUser._id}`,
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/userProfileHistory/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid user id.");
      return res.redirect("/requests/users");
    }

    const profileUser = await user
      .findById(req.params.id)
      .select("_id username email winnerCount webCollection")
      .lean();
    if (!profileUser) {
      req.flash("error", "User not found.");
      return res.redirect("/requests/users");
    }

    const purchasedLinks = profileUser.webCollection || [];
    const viewHistory = true;

    res.render("profile", {
      profileUser,
      totalLinksCreated: profileUser.webCollection?.length || 0,
      purchasedLinks,
      viewHistory,
      title: `${profileUser.username} - User History`,
      description: `Admin history view for ${profileUser.username}.`,
      canonical: `https://wishlink-7j0a.onrender.com/requests/userProfileHistory/${profileUser._id}`,
      robots: "noindex, nofollow",
    });
  })
);

module.exports = router;
