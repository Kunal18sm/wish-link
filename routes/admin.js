const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");

const purchasedWeb = require("../models/purchasedWeb.js");
const WebSample = require("../models/WebSample.js");
const BannerConfig = require("../models/bannerConfig.js");
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const {
  cloudinary,
  storage,
  permanentCloudinaryOptions,
  frameTemplateCloudinaryOptions,
  FRAME_TEMPLATE_CLOUDINARY_FOLDER,
} = require("../cloudConfig.js");
const {
  getEditableBannerConfig,
  invalidateBannerConfigCache,
  BANNER_PAGES,
} = require("../utils/bannerConfigCache.js");
const {
  markAdminNotificationsAsRead,
  createAdminNotification,
} = require("../utils/adminNotifications.js");
const {
  getPushConfig,
  upsertAdminPushSubscription,
  removeAdminPushSubscription,
} = require("../utils/pushNotifications.js");
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
const DELETE_REASON = {
  DEFAULT: "default",
  FAKE_PAYMENT: "fake-payment",
};
const USERS_PAGE_LIMIT = 20;
const MONEY_PURCHASE_EXPIRY_MONTHS = 6;
const REQUEST_CARD_SELECT =
  "webName sender receiver price paymentProofUrl webUrl isLive isTemporary author date purchaseMode paidCredits expiresAt";
const PROFILE_PURCHASE_SELECT =
  "webName webUrl receiver price isLive isTemporary date author purchaseMode paidCredits expiresAt";
const MAX_BANNER_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FRAME_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const FRAME_SLOT_MAX_Z_INDEX = 999;
const FRAME_TEXT_MIN_Z_INDEX = 1000;
const FRAME_TEXT_MAX_Z_INDEX = 2000;
const ADMIN_DASHBOARD_CARDS = [
  {
    title: "Add Template",
    description: "Add a new website template.",
    href: "/web/new",
    icon: "\u2728",
    toneClass: "from-fuchsia-500/20 to-indigo-500/20 border-fuchsia-500/30",
  },
  {
    title: "Requests",
    description: "Manage pending temporary requests.",
    href: "/requests",
    icon: "\uD83D\uDCE5",
    toneClass: "from-indigo-500/20 to-sky-500/20 border-indigo-500/30",
  },
  {
    title: "Permanent Requests",
    description: "Review permanent link requests.",
    href: "/requests/permanent",
    icon: "\uD83E\uDDFE",
    toneClass: "from-violet-500/20 to-blue-500/20 border-violet-500/30",
  },
  {
    title: "Expired Requests",
    description: "View expired template links.",
    href: "/requests/expired",
    icon: "\u23F3",
    toneClass: "from-amber-500/20 to-orange-500/20 border-amber-500/30",
  },
  {
    title: "All Live",
    description: "Check live template link status.",
    href: "/requests/allLive",
    icon: "\uD83D\uDFE2",
    toneClass: "from-emerald-500/20 to-teal-500/20 border-emerald-500/30",
  },
  {
    title: "Permanent Live",
    description: "View all live permanent links.",
    href: "/requests/allLive?scope=permanent",
    icon: "\uD83D\uDC8E",
    toneClass: "from-cyan-500/20 to-indigo-500/20 border-cyan-500/30",
  },
  {
    title: "Users",
    description: "Manage users, credits, and profiles.",
    href: "/requests/users",
    icon: "\uD83D\uDC65",
    toneClass: "from-blue-500/20 to-slate-500/20 border-blue-500/30",
  },
  {
    title: "Banners",
    description: "Edit Home and Collection banners.",
    href: "/requests/banner",
    icon: "\uD83D\uDDBC\uFE0F",
    toneClass: "from-rose-500/20 to-pink-500/20 border-rose-500/30",
  },
  {
    title: "Frame Templates",
    description: "Create and update photo frame templates.",
    href: "/requests/frame-templates",
    icon: "\uD83E\uDDE9",
    toneClass: "from-indigo-500/20 to-purple-500/20 border-indigo-500/30",
  },
  {
    title: "Feedbacks",
    description: "Read user feedback and suggestions.",
    href: "/feedback/feedbackpage",
    icon: "\uD83D\uDCAC",
    toneClass: "from-sky-500/20 to-cyan-500/20 border-sky-500/30",
  },
  {
    title: "LeaderBoard",
    description: "View leaderboard and winners.",
    href: "/game/leaderboard",
    icon: "\uD83C\uDFC6",
    toneClass: "from-yellow-500/20 to-amber-500/20 border-yellow-500/30",
  },
  {
    title: "Chat Inbox",
    description: "Handle user support chats.",
    href: "/chat/admin",
    icon: "\uD83D\uDCE8",
    toneClass: "from-emerald-500/20 to-cyan-500/20 border-emerald-500/30",
  },
];
const ALLOWED_BANNER_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const ALLOWED_FRAME_UPLOAD_MIME_TYPES = new Set([
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

const frameUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_FRAME_UPLOAD_MIME_TYPES.has(file?.mimetype)) {
      return cb(new Error("Invalid frame file type. Only JPG, JPEG, PNG, and WEBP are allowed."));
    }
    return cb(null, true);
  },
  limits: {
    fileSize: MAX_FRAME_UPLOAD_SIZE_BYTES,
    files: 1,
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

function getFrameTemplateModel(req) {
  return req.app.locals.permanentFrameTemplate || null;
}

function runFrameUploadWithRedirect(getRedirectPath) {
  return (req, res, next) => {
    frameUpload.single("frameImage")(req, res, (err) => {
      if (!err) return next();
      req.flash("error", String(err?.message || "Frame image upload failed. Please try again."));
      const redirectPath =
        typeof getRedirectPath === "function" ? getRedirectPath(req) : "/requests/frame-templates";
      return res.redirect(redirectPath || "/requests/frame-templates");
    });
  };
}

const runSingleFrameUpload = runFrameUploadWithRedirect(() => "/requests/frame-templates");
const runOptionalFrameUploadForEdit = runFrameUploadWithRedirect(
  (req) => `/requests/frame-templates/${req.params.id}/edit`
);

function toSameOriginImageUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return "";
  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol === "https:" && parsedUrl.hostname === "res.cloudinary.com") {
      return `/cdn/image?u=${encodeURIComponent(rawUrl)}`;
    }
  } catch (_err) {
    return rawUrl;
  }
  return rawUrl;
}

function toFrameTemplateEditorDoc(rawTemplate = {}) {
  if (!rawTemplate?._id) return null;
  return {
    _id: String(rawTemplate._id),
    name: String(rawTemplate.name || ""),
    slug: String(rawTemplate.slug || ""),
    description: String(rawTemplate.description || ""),
    isActive: Boolean(rawTemplate.isActive),
    canvas: {
      width: Number(rawTemplate?.canvas?.width || 1080),
      height: Number(rawTemplate?.canvas?.height || 1080),
    },
    frameImage: {
      url: String(rawTemplate?.frameImage?.url || ""),
      previewUrl: toSameOriginImageUrl(rawTemplate?.frameImage?.url),
      publicId: String(rawTemplate?.frameImage?.publicId || ""),
    },
    imageSlots: Array.isArray(rawTemplate.imageSlots)
      ? rawTemplate.imageSlots.map((slot, index) => ({
        key: String(slot?.key || `slot_${index + 1}`),
        label: String(slot?.label || `Photo ${index + 1}`),
        x: Number(slot?.x || 0),
        y: Number(slot?.y || 0),
        width: Number(slot?.width || 200),
        height: Number(slot?.height || 200),
        borderRadius: Number(slot?.borderRadius || 0),
        zIndex: Math.min(FRAME_SLOT_MAX_Z_INDEX, Math.max(0, Number(slot?.zIndex || 0))),
        rotation: Number(slot?.rotation || 0),
      }))
      : [],
    texts: Array.isArray(rawTemplate.texts)
      ? rawTemplate.texts.map((textLayer, index) => ({
        key: String(textLayer?.key || `text_${index + 1}`),
        value: String(textLayer?.value || ""),
        editable: parseBooleanValue(textLayer?.editable, true),
        x: Number(textLayer?.x || 0),
        y: Number(textLayer?.y || 0),
        width: Number(textLayer?.width || 240),
        height: Number(textLayer?.height || 120),
        color: String(textLayer?.color || "#ffffff"),
        fontSize: Number(textLayer?.fontSize || 30),
        fontFamily: String(textLayer?.fontFamily || "Poppins"),
        fontWeight: String(textLayer?.fontWeight || "600"),
        textAlign: String(textLayer?.textAlign || "center"),
        lineHeight: Number(textLayer?.lineHeight || 1.2),
        letterSpacing: Number(textLayer?.letterSpacing || 0),
        zIndex: Math.min(
          FRAME_TEXT_MAX_Z_INDEX,
          Math.max(FRAME_TEXT_MIN_Z_INDEX, Number(textLayer?.zIndex || FRAME_TEXT_MIN_Z_INDEX))
        ),
        rotation: Number(textLayer?.rotation || 0),
      }))
      : [],
  };
}

function slugifyTemplateName(rawValue) {
  const slug = String(rawValue || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug || "frame-template";
}

async function buildUniqueTemplateSlug(FrameTemplate, rawSlug, excludeId = null) {
  const baseSlug = slugifyTemplateName(rawSlug);
  let candidate = baseSlug;
  let suffix = 1;

  while (true) {
    const query = { slug: candidate };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    // eslint-disable-next-line no-await-in-loop
    const exists = await FrameTemplate.exists(query);
    if (!exists) return candidate;

    candidate = `${baseSlug}-${suffix}`.slice(0, 140);
    suffix += 1;
  }
}

function parseJsonArrayPayload(rawPayload) {
  if (Array.isArray(rawPayload)) return rawPayload;
  if (typeof rawPayload !== "string") return [];
  const normalizedPayload = rawPayload.trim();
  if (!normalizedPayload) return [];

  const parsed = JSON.parse(normalizedPayload);
  return Array.isArray(parsed) ? parsed : [];
}

function toBoundedNumber(rawValue, fallback, min, max) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSlotPayload(rawSlots = []) {
  const normalizedSlots = (Array.isArray(rawSlots) ? rawSlots : [])
    .map((slot, index) => {
      const x = toBoundedNumber(slot?.x, 0, 0, 5000);
      const y = toBoundedNumber(slot?.y, 0, 0, 5000);
      const width = toBoundedNumber(slot?.width, 200, 20, 5000);
      const height = toBoundedNumber(slot?.height, 200, 20, 5000);

      return {
        key: String(slot?.key || `slot_${index + 1}`)
          .trim()
          .slice(0, 60),
        label: String(slot?.label || `Photo ${index + 1}`)
          .trim()
          .slice(0, 80),
        x,
        y,
        width,
        height,
        borderRadius: toBoundedNumber(slot?.borderRadius, 0, 0, 1000),
        zIndex: toBoundedNumber(slot?.zIndex, 0, 0, FRAME_SLOT_MAX_Z_INDEX),
        rotation: toBoundedNumber(slot?.rotation, 0, -360, 360),
      };
    })
    .filter((slot) => slot.width > 0 && slot.height > 0);

  if (!normalizedSlots.length) {
    throw new Error("At least one valid image slot is required.");
  }

  return normalizedSlots;
}

function normalizeTextPayload(rawTexts = []) {
  return (Array.isArray(rawTexts) ? rawTexts : [])
    .map((textLayer, index) => ({
      key: String(textLayer?.key || `text_${index + 1}`)
        .trim()
        .slice(0, 60),
      value: String(textLayer?.value || "")
        .trim()
        .slice(0, 240),
      editable: parseBooleanValue(textLayer?.editable, true),
      x: toBoundedNumber(textLayer?.x, 0, 0, 5000),
      y: toBoundedNumber(textLayer?.y, 0, 0, 5000),
      width: toBoundedNumber(textLayer?.width, 240, 20, 5000),
      height: toBoundedNumber(textLayer?.height, 120, 20, 5000),
      color: String(textLayer?.color || "#ffffff")
        .trim()
        .slice(0, 30),
      fontSize: toBoundedNumber(textLayer?.fontSize, 30, 8, 300),
      fontFamily: String(textLayer?.fontFamily || "Poppins")
        .trim()
        .slice(0, 80),
      fontWeight: String(textLayer?.fontWeight || "600")
        .trim()
        .slice(0, 20),
      textAlign: ["left", "center", "right"].includes(String(textLayer?.textAlign || "center"))
        ? String(textLayer.textAlign)
        : "center",
      lineHeight: toBoundedNumber(textLayer?.lineHeight, 1.2, 0.6, 3),
      letterSpacing: toBoundedNumber(textLayer?.letterSpacing, 0, -10, 30),
      zIndex: toBoundedNumber(
        textLayer?.zIndex,
        FRAME_TEXT_MIN_Z_INDEX,
        FRAME_TEXT_MIN_Z_INDEX,
        FRAME_TEXT_MAX_Z_INDEX
      ),
      rotation: toBoundedNumber(textLayer?.rotation, 0, -360, 360),
    }))
    .filter((textLayer) => textLayer.value || textLayer.editable);
}

function buildFrameTemplatePayload(formInput = {}, frameImageResult = null, existingTemplate = null) {
  const frameName = String(formInput?.name || "")
    .trim()
    .slice(0, 120);
  if (!frameName) {
    throw new Error("Template name is required.");
  }

  const imageSlots = normalizeSlotPayload(parseJsonArrayPayload(formInput?.slotsPayload));
  const texts = normalizeTextPayload(parseJsonArrayPayload(formInput?.textsPayload));
  const frameImageDoc = frameImageResult || existingTemplate?.frameImage || null;
  if (!frameImageDoc) {
    throw new Error("Frame image is required.");
  }

  const canvasWidth = toBoundedNumber(
    formInput?.canvasWidth,
    frameImageDoc?.width || existingTemplate?.canvas?.width || 1080,
    100,
    5000
  );
  const canvasHeight = toBoundedNumber(
    formInput?.canvasHeight,
    frameImageDoc?.height || existingTemplate?.canvas?.height || 1080,
    100,
    5000
  );

  return {
    name: frameName,
    slug: slugifyTemplateName(formInput?.slug || frameName),
    description: String(formInput?.description || "")
      .trim()
      .slice(0, 500),
    frameImage: {
      url: String(frameImageDoc?.secure_url || frameImageDoc?.url || "").trim(),
      publicId: String(frameImageDoc?.public_id || frameImageDoc?.publicId || "").trim(),
      width: Number(frameImageDoc?.width || canvasWidth),
      height: Number(frameImageDoc?.height || canvasHeight),
      format: String(frameImageDoc?.format || "").trim(),
    },
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
    imageSlots,
    texts,
    isActive: parseBooleanValue(formInput?.isActive, true),
  };
}

function uploadFrameImageToFrameTemplateCloudinary(file) {
  if (!frameTemplateCloudinaryOptions) {
    throw new Error("Photo frame template cloud storage is not configured.");
  }

  if (!file?.buffer) {
    throw new Error("Frame image is required.");
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        ...frameTemplateCloudinaryOptions,
        folder: FRAME_TEMPLATE_CLOUDINARY_FOLDER,
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

function extractCloudinaryCloudName(rawUrl) {
  const normalizedUrl = String(rawUrl || "").trim();
  if (!normalizedUrl) return "";

  try {
    const parsedUrl = new URL(normalizedUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com") {
      return "";
    }

    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    return String(pathSegments[0] || "").trim();
  } catch (_err) {
    return "";
  }
}

function getDestroyCloudinaryOptionsByImageUrl(imageUrl) {
  const sourceCloudName = extractCloudinaryCloudName(imageUrl);
  if (!sourceCloudName) return frameTemplateCloudinaryOptions || null;
  if (sourceCloudName === String(frameTemplateCloudinaryOptions?.cloud_name || "").trim()) {
    return frameTemplateCloudinaryOptions;
  }
  if (sourceCloudName === String(permanentCloudinaryOptions?.cloud_name || "").trim()) {
    return permanentCloudinaryOptions;
  }
  return frameTemplateCloudinaryOptions || null;
}

async function destroyFrameTemplateCloudinaryImage(publicId, imageUrl = "") {
  const normalizedPublicId = String(publicId || "").trim();
  if (!normalizedPublicId) return;
  const destroyOptions = getDestroyCloudinaryOptionsByImageUrl(imageUrl);

  if (destroyOptions) {
    await cloudinary.uploader.destroy(normalizedPublicId, destroyOptions);
    return;
  }

  await cloudinary.uploader.destroy(normalizedPublicId);
}

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

function getDeleteReason(req) {
  const rawReason = String(req.query.reason || "").trim().toLowerCase();
  if (rawReason === DELETE_REASON.FAKE_PAYMENT || rawReason === "fake_payment") {
    return DELETE_REASON.FAKE_PAYMENT;
  }
  return DELETE_REASON.DEFAULT;
}

function getPurchaseModelByScope(req, scope) {
  if (scope === REQUEST_SCOPE.DEFAULT) return purchasedWeb;

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (!permanentModel) return null;
  return permanentModel;
}

function getDateAfterAddingMonths(dateValue, monthsToAdd) {
  const baseDate = new Date(dateValue);
  if (Number.isNaN(baseDate.getTime())) return null;
  baseDate.setMonth(baseDate.getMonth() + monthsToAdd);
  return baseDate;
}

function isExpiredPurchase(rawPurchase) {
  const purchaseDoc =
    rawPurchase && typeof rawPurchase === "object" ? rawPurchase : { expiresAt: rawPurchase };
  const expiryDate = new Date(purchaseDoc?.expiresAt);
  if (!Number.isNaN(expiryDate.getTime())) {
    return expiryDate.getTime() <= Date.now();
  }

  // Legacy UPI docs may not have expiresAt. Fall back to purchase date + configured validity.
  const purchaseMode = String(purchaseDoc?.purchaseMode || "upi").toLowerCase();
  if (purchaseMode === "coins") return false;
  const legacyExpiryDate = getDateAfterAddingMonths(purchaseDoc?.date, MONEY_PURCHASE_EXPIRY_MONTHS);
  if (!legacyExpiryDate) return false;
  return legacyExpiryDate.getTime() <= Date.now();
}

function normalizePurchaseForView(rawPurchase) {
  const doc = rawPurchase && typeof rawPurchase.toObject === "function"
    ? rawPurchase.toObject()
    : { ...(rawPurchase || {}) };
  const isExpired = isExpiredPurchase(doc);

  return {
    ...doc,
    purchaseMode: String(doc.purchaseMode || "upi").toLowerCase() === "coins" ? "coins" : "upi",
    paidCredits: Number(doc.paidCredits || 0),
    isExpired,
    isLive: Boolean(doc.isLive) && !isExpired,
  };
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
  if (Array.isArray(rawValue)) {
    if (!rawValue.length) return fallback;
    return parseBooleanValue(rawValue[rawValue.length - 1], fallback);
  }
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
    ...normalizePurchaseForView(doc),
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
    ...normalizePurchaseForView(item),
    requestScope: REQUEST_SCOPE.DEFAULT,
  }));

  if (permanentLinks.length) {
    merged.push(
      ...permanentLinks.map((item) => ({
        ...normalizePurchaseForView(item),
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

router.get(
  "/dashboard",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    return res.render("adminDashboard", {
      adminCards: ADMIN_DASHBOARD_CARDS,
      adminNotifications: [],
      unreadNotificationCount: 0,
      title: "Admin Dashboard - VishLink",
      description: "Quick access dashboard for all admin tools and routes.",
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/api/notifications",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    return res.json({
      ok: true,
      unreadCount: 0,
      notifications: [],
    });
  })
);

router.get(
  "/api/notifications/unread-count",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    return res.json({
      ok: true,
      unreadCount: 0,
    });
  })
);

router.post(
  "/api/notifications/read-all",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const modifiedCount = await markAdminNotificationsAsRead(req.app, {});
    return res.json({
      ok: true,
      modifiedCount: Number(modifiedCount || 0),
    });
  })
);

router.post(
  "/api/notifications/:id/read",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    return res.json({
      ok: true,
      modifiedCount: 0,
    });
  })
);

router.get(
  "/api/push/public-key",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    const pushConfig = getPushConfig();
    return res.json({
      ok: true,
      enabled: Boolean(pushConfig.configured),
      publicKey: pushConfig.configured ? pushConfig.publicKey : "",
    });
  })
);

router.post(
  "/api/push/subscribe",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const pushConfig = getPushConfig();
    if (!pushConfig.configured) {
      return res.status(503).json({
        ok: false,
        message: "Push notification service is not configured.",
      });
    }

    const rawSubscription = req.body?.subscription || null;
    if (!rawSubscription || typeof rawSubscription !== "object") {
      return res.status(400).json({
        ok: false,
        message: "Invalid push subscription payload.",
      });
    }

    await upsertAdminPushSubscription(
      req.user,
      rawSubscription,
      String(req.get("user-agent") || "")
    );

    return res.json({
      ok: true,
      message: "Push subscription saved.",
    });
  })
);

router.post(
  "/api/push/unsubscribe",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const endpoint = String(req.body?.endpoint || "").trim();
    if (!endpoint) {
      return res.status(400).json({
        ok: false,
        message: "Missing subscription endpoint.",
      });
    }

    const deletedCount = await removeAdminPushSubscription(endpoint);
    return res.json({
      ok: true,
      deletedCount: Number(deletedCount || 0),
    });
  })
);

router.get(
  "/frame-templates",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const FrameTemplate = getFrameTemplateModel(req);
    const templates = FrameTemplate
      ? await FrameTemplate.find({})
        .select("name slug description frameImage canvas imageSlots texts isActive updatedAt")
        .sort({ createdAt: -1 })
        .lean()
      : [];

    return res.render("frameTemplateManager", {
      templates,
      frameTemplateStorageReady: Boolean(FrameTemplate && frameTemplateCloudinaryOptions),
      editorMode: "create",
      editableTemplate: null,
      title: "Frame Template Manager - VishLink Admin",
      description: "Create and manage reusable photo frame templates.",
      robots: "noindex, nofollow",
    });
  })
);

router.post(
  "/frame-templates",
  isLoggedIn,
  isAdmin,
  runSingleFrameUpload,
  wrapAsync(async (req, res) => {
    const FrameTemplate = getFrameTemplateModel(req);
    if (!FrameTemplate) {
      req.flash("error", "Permanent template database is not configured.");
      return res.redirect("/requests/frame-templates");
    }

    if (!frameTemplateCloudinaryOptions) {
      req.flash("error", "Photo frame template cloud storage is not configured.");
      return res.redirect("/requests/frame-templates");
    }

    if (!req.file) {
      req.flash("error", "Please upload a frame PNG/JPG image.");
      return res.redirect("/requests/frame-templates");
    }

    let uploadedFrame = null;

    try {
      uploadedFrame = await uploadFrameImageToFrameTemplateCloudinary(req.file);
      const payload = buildFrameTemplatePayload(req.body, uploadedFrame);
      payload.slug = await buildUniqueTemplateSlug(FrameTemplate, payload.slug);
      payload.createdBy = req.user?._id || null;
      payload.updatedBy = req.user?._id || null;

      const savedTemplate = await FrameTemplate.create(payload);

      try {
        await createAdminNotification(req.app, {
          type: "frame_template_created",
          title: "New Frame Template Added",
          message: `${req.user?.username || "Admin"} added ${savedTemplate?.name || "a frame template"}.`,
          link: `/requests/frame-templates/${savedTemplate?._id}/edit`,
          entityType: "frame-template",
          entityId: String(savedTemplate?._id || ""),
          actor: req.user,
          meta: {
            templateName: savedTemplate?.name || "",
          },
        });
      } catch (notifyErr) {
        console.log("Admin frame-template notification warning:", notifyErr?.message || notifyErr);
      }

      req.flash("success", "Frame template saved successfully.");
      return res.redirect("/requests/frame-templates");
    } catch (err) {
      if (uploadedFrame?.public_id) {
        await destroyFrameTemplateCloudinaryImage(uploadedFrame.public_id, uploadedFrame?.secure_url);
      }

      req.flash("error", String(err?.message || "Frame template save failed."));
      return res.redirect("/requests/frame-templates");
    }
  })
);

router.get(
  "/frame-templates/:id/edit",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const FrameTemplate = getFrameTemplateModel(req);
    if (!FrameTemplate) {
      req.flash("error", "Permanent template database is not configured.");
      return res.redirect("/requests/frame-templates");
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid template id.");
      return res.redirect("/requests/frame-templates");
    }

    const [templates, selectedTemplate] = await Promise.all([
      FrameTemplate.find({})
        .select("name slug description frameImage canvas imageSlots texts isActive updatedAt")
        .sort({ createdAt: -1 })
        .lean(),
      FrameTemplate.findById(req.params.id)
        .select("name slug description frameImage canvas imageSlots texts isActive")
        .lean(),
    ]);

    if (!selectedTemplate) {
      req.flash("error", "Template not found.");
      return res.redirect("/requests/frame-templates");
    }

    return res.render("frameTemplateManager", {
      templates,
      frameTemplateStorageReady: Boolean(FrameTemplate && frameTemplateCloudinaryOptions),
      editorMode: "edit",
      editableTemplate: toFrameTemplateEditorDoc(selectedTemplate),
      title: "Edit Frame Template - VishLink Admin",
      description: "Edit reusable photo frame template layout.",
      robots: "noindex, nofollow",
    });
  })
);

router.put(
  "/frame-templates/:id",
  isLoggedIn,
  isAdmin,
  runOptionalFrameUploadForEdit,
  wrapAsync(async (req, res) => {
    const FrameTemplate = getFrameTemplateModel(req);
    if (!FrameTemplate) {
      req.flash("error", "Permanent template database is not configured.");
      return res.redirect("/requests/frame-templates");
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid template id.");
      return res.redirect("/requests/frame-templates");
    }

    const existingTemplate = await FrameTemplate.findById(req.params.id).lean();
    if (!existingTemplate) {
      req.flash("error", "Template not found.");
      return res.redirect("/requests/frame-templates");
    }

    let uploadedFrame = null;
    try {
      if (req.file) {
        uploadedFrame = await uploadFrameImageToFrameTemplateCloudinary(req.file);
      }

      const payload = buildFrameTemplatePayload(req.body, uploadedFrame, existingTemplate);
      payload.slug = await buildUniqueTemplateSlug(FrameTemplate, payload.slug, req.params.id);
      payload.updatedBy = req.user?._id || null;

      await FrameTemplate.findByIdAndUpdate(req.params.id, payload, { new: true });

      const previousPublicId = String(existingTemplate?.frameImage?.publicId || "").trim();
      if (uploadedFrame?.public_id && previousPublicId && previousPublicId !== uploadedFrame.public_id) {
        await destroyFrameTemplateCloudinaryImage(previousPublicId, existingTemplate?.frameImage?.url);
      }

      req.flash("success", "Frame template updated successfully.");
      return res.redirect(`/requests/frame-templates/${req.params.id}/edit`);
    } catch (err) {
      if (uploadedFrame?.public_id) {
        await destroyFrameTemplateCloudinaryImage(uploadedFrame.public_id, uploadedFrame?.secure_url);
      }
      req.flash("error", String(err?.message || "Template update failed."));
      return res.redirect(`/requests/frame-templates/${req.params.id}/edit`);
    }
  })
);

router.post(
  "/frame-templates/:id/toggle",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const FrameTemplate = getFrameTemplateModel(req);
    if (!FrameTemplate) {
      req.flash("error", "Permanent template database is not configured.");
      return res.redirect("/requests/frame-templates");
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid template id.");
      return res.redirect("/requests/frame-templates");
    }

    const template = await FrameTemplate.findById(req.params.id).select("isActive");
    if (!template) {
      req.flash("error", "Template not found.");
      return res.redirect("/requests/frame-templates");
    }

    template.isActive = !template.isActive;
    template.updatedBy = req.user?._id || null;
    await template.save();

    req.flash("success", template.isActive ? "Template activated." : "Template hidden.");
    return res.redirect("/requests/frame-templates");
  })
);

router.post(
  "/frame-templates/:id/delete",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const FrameTemplate = getFrameTemplateModel(req);
    if (!FrameTemplate) {
      req.flash("error", "Permanent template database is not configured.");
      return res.redirect("/requests/frame-templates");
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid template id.");
      return res.redirect("/requests/frame-templates");
    }

    const deletedTemplate = await FrameTemplate.findByIdAndDelete(req.params.id)
      .select("frameImage.publicId frameImage.url")
      .lean();

    if (!deletedTemplate) {
      req.flash("error", "Template not found.");
      return res.redirect("/requests/frame-templates");
    }

    await destroyFrameTemplateCloudinaryImage(
      deletedTemplate?.frameImage?.publicId,
      deletedTemplate?.frameImage?.url
    );
    req.flash("success", "Template deleted.");
    return res.redirect("/requests/frame-templates");
  })
);

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

// get expired websites (explicit expiresAt + legacy UPI fallback)
router.get(
  "/expired",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const now = new Date();
    const legacyMoneyCutoffDate = new Date(now);
    legacyMoneyCutoffDate.setMonth(legacyMoneyCutoffDate.getMonth() - MONEY_PURCHASE_EXPIRY_MONTHS);
    const expiredByDateOrModeQuery = {
      $or: [
        { expiresAt: { $lte: now } },
        {
          purchaseMode: { $ne: "coins" },
          date: { $lte: legacyMoneyCutoffDate },
          $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }],
        },
      ],
    };

    const permanentModel = getPurchaseModelByScope(req, REQUEST_SCOPE.PERMANENT);
    const [defaultExpired, permanentExpired] = await Promise.all([
      purchasedWeb
        .find(expiredByDateOrModeQuery)
        .select(REQUEST_CARD_SELECT)
        .sort({ _id: -1 })
        .lean(),
      permanentModel
        ? permanentModel
          .find(expiredByDateOrModeQuery)
          .select(REQUEST_CARD_SELECT)
          .sort({ _id: -1 })
          .lean()
        : Promise.resolve([]),
    ]);

    const userPurchased = [
      ...toScopedDocs(defaultExpired, REQUEST_SCOPE.DEFAULT),
      ...toScopedDocs(permanentExpired, REQUEST_SCOPE.PERMANENT),
    ]
      .map((item) => ({
        ...item,
        isExpired: true,
        isLive: false,
      }))
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.DEFAULT,
      title: "Expired Websites - Admin | VishLink",
      description: "Admin panel to manage expired websites based on purchase expiry windows.",
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

    const liveDocs = await PurchaseModel.find({ isLive: true })
      .select(REQUEST_CARD_SELECT)
      .sort({ _id: -1 })
      .lean();
    const userPurchased = toScopedDocs(
      liveDocs.filter((doc) => !isExpiredPurchase(doc)),
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
    const deleteReason = getDeleteReason(req);

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

    const isFakePaymentDelete =
      Boolean(req.user?.isAdmin) && deleteReason === DELETE_REASON.FAKE_PAYMENT;

    if (isFakePaymentDelete) {
      const ownerId = String(toDelete.author || "").trim();
      if (mongoose.Types.ObjectId.isValid(ownerId)) {
        await user.updateOne(
          {
            _id: new mongoose.Types.ObjectId(ownerId),
            "webCollection.purchasedId": new mongoose.Types.ObjectId(toDelete._id),
          },
          {
            $set: {
              "webCollection.$.isFakePaymentProof": true,
              "webCollection.$.adminFakePaymentNote":
                "Fake payment proof submitted. Template request/link was deleted by admin.",
              "webCollection.$.adminActionAt": new Date(),
              "webCollection.$.permanentLink": "",
            },
          }
        );
      }
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
    req.flash("success", isFakePaymentDelete ? "Fake payment marked and request deleted." : "Deleted");
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

    const purchasedLinks = Array.isArray(profileUser.webCollection)
      ? profileUser.webCollection.map((item) => normalizePurchaseForView(item))
      : [];
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

