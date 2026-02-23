const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin, validatepurchase } = require("../middleware.js");
const {
  storage,
  permanentStorage,
  cloudinary,
  permanentCloudinaryOptions,
} = require("../cloudConfig.js");

const router = express.Router({ mergeParams: true });
const upload = multer({ storage });
const uploadPermanent = multer({ storage: permanentStorage });

const purchaseUploadFields = [
  { name: "images", maxCount: 5 },
  { name: "paymentImage", maxCount: 1 },
];

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
  return "Purchase failed. Please try again.";
};

const parseIsTemporary = (value) => {
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
};

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

      const paymentImg = req.files?.paymentImage?.[0]
        ? {
            url: req.files.paymentImage[0].path,
            filename: req.files.paymentImage[0].filename,
          }
        : null;

      const { id } = req.params;
      const selectedWeb = await WebSample.findById(id);

      if (!selectedWeb) {
        throw new Error("Selected website template not found.");
      }

      const parsedPrice = Number(buyinfo.price);
      const price = Number.isFinite(parsedPrice) ? parsedPrice : 0;
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

      const userId = req.user._id;

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

        if (isTemporary && selectedWeb.priceForTemporary > 0) {
          const userData = await user.findById(userId);
          if (userData?.winnerCount > 0) {
            userData.winnerCount -= 1;
            await userData.save();
          }
        }
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

// form to add new web
router.get(
  "/new",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    res.render("addNewWeb", {
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
    let url = req.file.path;
    let filename = req.file.filename;
    const formData = req.body.formData;

    const newSample = new WebSample({
      webName: formData.webName,
      priceForTemporary: formData.priceForTemporary,
      priceForPermanent: formData.priceForPermanent,
      imageUrl: { url, filename },
      webUrl: formData.webUrl,
      description: formData.description,
      imageNeeded: formData.imageNeeded,
      tags: Array.isArray(formData.category) ? formData.category : [formData.category],
      articleTitle: formData.title,
      articleContent: formData.content,
    });
    await newSample.save();
    req.flash("success", "Added new website");
    res.redirect("/");
  })
);

// Form to purchase temporary website link
router.get(
  "/purchase/temporary/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const selectedWeb = await WebSample.findById(id);
    const isTemporary = true;
    const winnerCount = req.user.winnerCount || 0;
    res.render("purchaseForm", {
      selectedWeb,
      id,
      title: `Purchase ${selectedWeb.webName} - VishLink`,
      description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
      canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
      robots: "noindex, nofollow",
      isTemporary,
      winnerCount,
    });
  })
);

// Form to purchase permanent website link
router.get(
  "/purchase/permanent/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const selectedWeb = await WebSample.findById(id);
    const isTemporary = false;
    const winnerCount = 0;
    res.render("purchaseForm", {
      selectedWeb,
      id,
      title: `Purchase ${selectedWeb.webName} - VishLink`,
      description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
      canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
      robots: "noindex, nofollow",
      isTemporary,
      winnerCount,
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
