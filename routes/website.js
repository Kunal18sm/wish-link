const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { createAdminNotification } = require("../utils/adminNotifications.js");
const { isLoggedIn, isAdmin, validatepurchase } = require("../middleware.js");
const { getTemplateByIdCached, invalidateWebSampleCache } = require("../utils/webSampleCache.js");
const {
  storage,
  permanentStorage,
  cloudinary,
  permanentCloudinaryOptions,
} = require("../cloudConfig.js");

const router = express.Router({ mergeParams: true });
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

const imageFileFilter = (_req, file, cb) => {
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error("Invalid file type. Only JPG, JPEG, PNG, and WEBP images are allowed."));
  }
  return cb(null, true);
};

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 6 },
});

const uploadPermanent = multer({
  storage: permanentStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 6 },
});
const getFirstEnvValue = (...keys) => {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
};

const DEFAULT_PAYMENT_QR_IMAGE_URL =
  "https://res.cloudinary.com/dcw90tnk1/image/upload/v1768291694/wishLink_dev/gedbuqpryaj7oqo8c3v1.png";
const PAYMENT_UPI_ID = getFirstEnvValue("PAYMENT_UPI_ID", "UPI_ID", "UPI_PA", "UPI_VPA");
const PAYMENT_UPI_NAME = getFirstEnvValue("PAYMENT_UPI_NAME", "UPI_NAME", "UPI_PN");
const PAYMENT_UPI_NOTE = getFirstEnvValue("PAYMENT_UPI_NOTE", "UPI_NOTE") || "VishLink Purchase";
const PAYMENT_QR_IMAGE_URL =
  getFirstEnvValue("PAYMENT_QR_IMAGE_URL", "UPI_QR_IMAGE_URL") || DEFAULT_PAYMENT_QR_IMAGE_URL;
const PAYMENT_CURRENCY = "INR";

const purchaseUploadFields = [
  { name: "images", maxCount: 5 },
  { name: "paymentImage", maxCount: 1 },
];
const TEMPLATE_CATEGORIES = [
  "all",
  "free",
  "birthday",
  "valentine's",
  "sorry",
  "girlfriend",
  "family",
  "funny",
  "males",
  "females",
  "single",
  "couple",
  "anniversary",
  "wedding",
  "best friend",
  "parents",
  "festival",
  "new year",
  "christmas",
  "diwali",
  "eid",
  "holi",
];
const PURCHASE_TEMPLATE_SELECT = "webName webUrl priceForTemporary priceForPermanent";
const PREVIEW_TEMPLATE_SELECT = "webUrl";
const PURCHASE_FORM_TEMPLATE_SELECT =
  "webName webUrl priceForTemporary priceForPermanent imageNeeded description";
const EDIT_TEMPLATE_SELECT =
  "webName priceForTemporary priceForPermanent imageUrl webUrl description imageNeeded tags articleTitle articleContent priority";

const getRedirectBack = (req) => req.get("Referrer") || "/";

const getPurchaseFailureMessage = (err) => {
  const message = String(err?.message || "").toLowerCase();
  if (message.includes("selected website template not found")) {
    return "Template not found. Please open the form again.";
  }
  if (message.includes("invalid purchase type")) {
    return "Purchase type mismatch. Please reopen the form and try again.";
  }
  if (message.includes("permanent database is not configured")) {
    return "Permanent link service is not configured right now.";
  }
  if (message.includes("permanent cloudinary is not configured")) {
    return "Permanent image storage is not configured right now.";
  }
  if (message.includes("payment screenshot is required")) {
    return "Please upload payment screenshot to continue.";
  }
  return "Purchase failed. Please try again.";
};

const parseIsTemporary = (value) => {
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
};

const toFiniteNumberOrDefault = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toCurrencyAmount = (value) =>
  Number(Math.max(0, toFiniteNumberOrDefault(value, 0)).toFixed(2));

const buildUpiPaymentQuery = (amount, templateName = "", purchaseType = "") => {
  if (!PAYMENT_UPI_ID || amount <= 0) return "";

  const noteParts = [PAYMENT_UPI_NOTE];
  if (templateName) noteParts.push(templateName);
  if (purchaseType) noteParts.push(purchaseType);
  const paymentNote = noteParts.filter(Boolean).join(" | ").slice(0, 120);
  const payeeName = PAYMENT_UPI_NAME || "VishLink";

  const params = new URLSearchParams({
    pa: PAYMENT_UPI_ID,
    pn: payeeName,
    am: amount.toFixed(2),
    cu: PAYMENT_CURRENCY,
  });

  if (paymentNote) {
    params.set("tn", paymentNote);
  }

  return params.toString();
};

const buildUpiPaymentLinks = (amount, templateName = "", purchaseType = "") => {
  const query = buildUpiPaymentQuery(amount, templateName, purchaseType);
  if (!query) {
    return {
      upi: "",
      intent: "",
      gpay: "",
      phonepe: "",
      paytm: "",
    };
  }

  return {
    upi: `upi://pay?${query}`,
    intent: `intent://pay?${query}#Intent;scheme=upi;end`,
    gpay: `tez://upi/pay?${query}`,
    phonepe: `phonepe://pay?${query}`,
    paytm: `paytmmp://pay?${query}`,
  };
};

const normalizeTemplateCategories = (rawCategories) => {
  const values = Array.isArray(rawCategories) ? rawCategories : [rawCategories];
  const uniqueCategories = new Set();

  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || !TEMPLATE_CATEGORIES.includes(normalized)) continue;
    uniqueCategories.add(normalized);
  }

  return Array.from(uniqueCategories);
};

const buildTemplatePayload = (formData = {}) => ({
  webName: String(formData.webName || "").trim(),
  priceForTemporary: toFiniteNumberOrDefault(formData.priceForTemporary, 0),
  priceForPermanent: toFiniteNumberOrDefault(formData.priceForPermanent, 0),
  webUrl: String(formData.webUrl || "").trim(),
  description: String(formData.description || "").trim(),
  imageNeeded: toFiniteNumberOrDefault(formData.imageNeeded, 5),
  priority: toFiniteNumberOrDefault(formData.priority, 0),
  tags: normalizeTemplateCategories(formData.category),
  articleTitle: String(formData.title || "").trim(),
  articleContent: String(formData.content || "").trim(),
});

const buildPurchasedWebUrl = (baseWebUrl, purchaseId, isTemporary) => {
  const sanitizedBase = String(baseWebUrl || "").replace(/\/+$/, "");
  if (!sanitizedBase) return isTemporary ? `${purchaseId}` : `tulipParisBMW/${purchaseId}`;
  if (isTemporary) return `${sanitizedBase}/${purchaseId}`;
  return `${sanitizedBase}/tulipParisBMW/${purchaseId}`;
};

const getPurchaseModelForType = (req, isTemporary) => {
  if (isTemporary) return purchasedWeb;

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (!permanentModel) {
    throw new Error("Permanent database is not configured.");
  }

  return permanentModel;
};

const createPurchaseHandler = (expectedIsTemporary) =>
  wrapAsync(async (req, res) => {
    const buyinfo = req.body.purchase || {};
    const isTemporary = parseIsTemporary(buyinfo.isTemporary);
    const isPermanentPurchase = !isTemporary;
    const destroyOptions = isPermanentPurchase ? permanentCloudinaryOptions : null;
    const userId = req.user?._id;

    const uploadedPublicIds = [
      ...(req.files?.images || []).map((file) => file.filename),
      ...(req.files?.paymentImage || []).map((file) => file.filename),
    ];

    const cleanupUploads = async () => {
      if (!uploadedPublicIds.length) return;
      await Promise.allSettled(
        uploadedPublicIds.map((publicId) =>
          destroyOptions
            ? cloudinary.uploader.destroy(publicId, destroyOptions)
            : cloudinary.uploader.destroy(publicId)
        )
      );
    };

    try {
      if (isTemporary !== expectedIsTemporary) {
        throw new Error("Invalid purchase type for this form.");
      }

      const PurchaseModel = getPurchaseModelForType(req, isTemporary);
      const imagesArr = (req.files?.images || []).map((file) => ({
        url: file.path,
        filename: file.filename,
      }));

      let paymentImg = req.files?.paymentImage?.[0]
        ? {
            url: req.files.paymentImage[0].path,
            filename: req.files.paymentImage[0].filename,
          }
        : null;

      const { id } = req.params;
      const selectedWeb = await WebSample.findById(id)
        .select(PURCHASE_TEMPLATE_SELECT)
        .lean();

      if (!selectedWeb) {
        throw new Error("Selected website template not found.");
      }

      const temporaryPrice = Math.max(0, toFiniteNumberOrDefault(selectedWeb.priceForTemporary, 0));
      const permanentPrice = Math.max(0, toFiniteNumberOrDefault(selectedWeb.priceForPermanent, 0));
      const paymentAmount = isTemporary ? temporaryPrice : permanentPrice;
      const requiresPaymentProof = paymentAmount > 0;
      if (requiresPaymentProof && !paymentImg) {
        throw new Error("Payment screenshot is required.");
      }

      if (!requiresPaymentProof) {
        paymentImg = null;
      }

      const price = paymentAmount;
      const sender =
        typeof buyinfo.sender === "string" && buyinfo.sender.trim()
          ? buyinfo.sender.trim()
          : "Anonymous";
      const receiver = typeof buyinfo.receiver === "string" ? buyinfo.receiver.trim() : "";
      const specialMsgText =
        typeof buyinfo.specialMsg === "string" && buyinfo.specialMsg.trim()
          ? buyinfo.specialMsg.trim()
          : "Best wishes!";

      const purchaseId = uuidv4();
      const finalWebUrl = buildPurchasedWebUrl(selectedWeb.webUrl, purchaseId, isTemporary);
      const isLive = price <= 15;

      const savedPurchase = await new PurchaseModel({
        purchaseId,
        webUrl: finalWebUrl,
        sender,
        receiver,
        price,
        images: imagesArr,
        paymentProofUrl: paymentImg,
        specialMsg: [specialMsgText],
        author: req.user._id,
        webName: buyinfo.webName || selectedWeb.webName,
        isLive,
        isTemporary,
      }).save();

      try {
        await createAdminNotification(req.app, {
          type: "purchase_request",
          title: isTemporary ? "New Temporary Request" : "New Permanent Request",
          message: `${sender} requested ${selectedWeb.webName} for ${receiver || "a recipient"}.`,
          link: isTemporary ? "/requests" : "/requests/permanent",
          entityType: "purchase",
          entityId: String(savedPurchase._id),
          actor: req.user,
          meta: {
            requestScope: isTemporary ? "default" : "permanent",
            templateName: selectedWeb.webName,
            sender,
            receiver,
            price,
            isTemporary,
          },
        });
      } catch (notifyErr) {
        console.log("Admin purchase notification warning:", notifyErr?.message || notifyErr);
      }

      // Non-critical updates should not block a successful purchase document save.
      try {
        await user.findByIdAndUpdate(userId, {
          $push: {
            webCollection: {
              webName: buyinfo.webName || selectedWeb.webName,
              dateOfBuy: new Date(),
              receiver,
              price,
              paymentProofUrl: paymentImg,
              purchasedId: savedPurchase._id,
              permanentLink: isTemporary ? "" : finalWebUrl,
            },
          },
        });

        await WebSample.findByIdAndUpdate(id, { $inc: { soldOut: 1 } });
      } catch (postSaveErr) {
        console.log("Post-save sync warning:", postSaveErr.message);
      }

      req.flash("success", "Purchase Success");
      return res.redirect("/profile");
    } catch (err) {
      await cleanupUploads();
      console.log("Purchase failed:", err.message);
      req.flash("error", getPurchaseFailureMessage(err));
      return res.redirect(getRedirectBack(req));
    }
  });

router.post(
  "/template/:id/preview/unlock",
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const selectedWeb = await getTemplateByIdCached(id, PREVIEW_TEMPLATE_SELECT, 30 * 1000);

    if (!selectedWeb || !selectedWeb.webUrl) {
      return res.status(404).json({
        ok: false,
        message: "Template preview not found.",
      });
    }

    return res.json({
      ok: true,
      redirectUrl: selectedWeb.webUrl,
      chargedCredits: 0,
    });
  })
);

// form to add new web
router.get(
  "/new",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    res.render("addNewWeb", {
      categories: TEMPLATE_CATEGORIES,
      title: "Add New Website - VishLink",
      description: "Admin panel to add new wishing website templates.",
      robots: "noindex, nofollow",
    });
  })
);

// save new website
router.post(
  "/new",
  isLoggedIn,
  isAdmin,
  upload.single("imageUrl"),
  wrapAsync(async (req, res) => {
    const url = req.file.path;
    const filename = req.file.filename;
    const formData = req.body.formData;
    const payload = buildTemplatePayload(formData);

    const newSample = new WebSample({
      webName: payload.webName,
      priceForTemporary: payload.priceForTemporary,
      priceForPermanent: payload.priceForPermanent,
      previewCredits: 0,
      purchaseCredits: 0,
      imageUrl: { url, filename },
      webUrl: payload.webUrl,
      description: payload.description,
      imageNeeded: payload.imageNeeded,
      tags: payload.tags,
      articleTitle: payload.articleTitle,
      articleContent: payload.articleContent,
      priority: payload.priority,
    });
    await newSample.save();
    invalidateWebSampleCache(newSample._id);

    try {
      await createAdminNotification(req.app, {
        type: "template_created",
        title: "New Website Template Added",
        message: `${req.user?.username || "Admin"} added ${newSample.webName}.`,
        link: `/web/template/${newSample._id}/edit`,
        entityType: "template",
        entityId: String(newSample._id),
        actor: req.user,
        meta: {
          templateName: newSample.webName,
          tags: newSample.tags || [],
        },
      });
    } catch (notifyErr) {
      console.log("Admin template notification warning:", notifyErr?.message || notifyErr);
    }

    req.flash("success", "Added new website");
    res.redirect("/");
  })
);

// form to edit template
router.get(
  "/template/:id/edit",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const selectedWeb = await getTemplateByIdCached(req.params.id, EDIT_TEMPLATE_SELECT, 30 * 1000);
    if (!selectedWeb) {
      req.flash("error", "Template not found.");
      return res.redirect("/");
    }

    return res.render("editTemplate", {
      selectedWeb,
      categories: TEMPLATE_CATEGORIES,
      title: `Edit ${selectedWeb.webName} - VishLink`,
      description: "Admin panel to edit website template details and priority.",
      robots: "noindex, nofollow",
    });
  })
);

// update template
router.put(
  "/template/:id",
  isLoggedIn,
  isAdmin,
  upload.single("imageUrl"),
  wrapAsync(async (req, res) => {
    const selectedWeb = await WebSample.findById(req.params.id).select("imageUrl").lean();
    if (!selectedWeb) {
      req.flash("error", "Template not found.");
      return res.redirect("/");
    }

    const payload = buildTemplatePayload(req.body.formData);
    const updateData = {
      webName: payload.webName,
      priceForTemporary: payload.priceForTemporary,
      priceForPermanent: payload.priceForPermanent,
      previewCredits: 0,
      purchaseCredits: 0,
      webUrl: payload.webUrl,
      description: payload.description,
      imageNeeded: payload.imageNeeded,
      tags: payload.tags,
      articleTitle: payload.articleTitle,
      articleContent: payload.articleContent,
      priority: payload.priority,
    };

    if (req.file) {
      updateData.imageUrl = {
        url: req.file.path,
        filename: req.file.filename,
      };
    }

    await WebSample.findByIdAndUpdate(req.params.id, updateData);
    invalidateWebSampleCache(req.params.id);

    if (req.file && selectedWeb.imageUrl?.filename) {
      await cloudinary.uploader.destroy(selectedWeb.imageUrl.filename);
    }

    req.flash("success", "Template updated");
    return res.redirect("/");
  })
);

// Form to purchase temporary website link
router.get(
  "/purchase/temporary/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const selectedWeb = await getTemplateByIdCached(id, PURCHASE_FORM_TEMPLATE_SELECT, 30 * 1000);
    if (!selectedWeb) {
      req.flash("error", "Template not found.");
      return res.redirect("/");
    }
    const isTemporary = true;
    const paymentAmount = toCurrencyAmount(selectedWeb.priceForTemporary);
    const upiLinks = buildUpiPaymentLinks(
      paymentAmount,
      selectedWeb.webName,
      "Temporary Link"
    );
    res.render("purchaseForm", {
      selectedWeb,
      id,
      title: `Purchase ${selectedWeb.webName} - VishLink`,
      description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
      canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
      robots: "noindex, nofollow",
      isTemporary,
      paymentAmount,
      autoPaymentLink: upiLinks.upi,
      upiLinks,
      paymentQrImageUrl: PAYMENT_QR_IMAGE_URL,
      paymentUpiId: PAYMENT_UPI_ID,
    });
  })
);

// Form to purchase permanent website link
router.get(
  "/purchase/permanent/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const selectedWeb = await getTemplateByIdCached(id, PURCHASE_FORM_TEMPLATE_SELECT, 30 * 1000);
    if (!selectedWeb) {
      req.flash("error", "Template not found.");
      return res.redirect("/");
    }
    const isTemporary = false;
    const paymentAmount = toCurrencyAmount(selectedWeb.priceForPermanent);
    const upiLinks = buildUpiPaymentLinks(
      paymentAmount,
      selectedWeb.webName,
      "Permanent Link"
    );
    res.render("purchaseForm", {
      selectedWeb,
      id,
      title: `Purchase ${selectedWeb.webName} - VishLink`,
      description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
      canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
      robots: "noindex, nofollow",
      isTemporary,
      paymentAmount,
      autoPaymentLink: upiLinks.upi,
      upiLinks,
      paymentQrImageUrl: PAYMENT_QR_IMAGE_URL,
      paymentUpiId: PAYMENT_UPI_ID,
    });
  })
);

// Save purchased temporary link (primary DB + primary Cloudinary)
router.post(
  "/purchase/temporary/:id",
  isLoggedIn,
  upload.fields(purchaseUploadFields),
  validatepurchase,
  createPurchaseHandler(true)
);

// Save purchased permanent link (secondary DB + secondary Cloudinary)
router.post(
  "/purchase/permanent/:id",
  isLoggedIn,
  uploadPermanent.fields(purchaseUploadFields),
  validatepurchase,
  createPurchaseHandler(false)
);

module.exports = router;
