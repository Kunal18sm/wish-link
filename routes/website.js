const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const user = require("../models/user.js");

const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin, validatepurchase } = require("../middleware.js")

const multer = require("multer");
const { storage, cloudinary } = require("../cloudConfig.js");
const upload = multer({ storage });

const { v4: uuidv4 } = require("uuid");

const getRedirectBack = (req) => req.get("Referrer") || "/";
const getPurchaseFailureMessage = (err) => {
  const message = String(err?.message || "").toLowerCase();
  if (message.includes("selected website template not found")) {
    return "Template not found. Please open the form again.";
  }
  return "Purchase failed. Please try again.";
};





// form to add new web
router.get("/new", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  res.render("addNewWeb", {
    title: "Add New Website – VishLink",
    description: "Admin panel to add new wishing website templates.",
    robots: "noindex, nofollow"
  });
}))

// save new website
router.post("/new", isLoggedIn, isAdmin, upload.single("imageUrl"), wrapAsync(async (req, res) => {

  let url = req.file.path;
  let filename = req.file.filename;

  const formData = req.body.formData;
  // Build article object safely

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
  })
  const Saved = await newSample.save();
  req.flash("success", "Added new website");
  res.redirect("/");
}))


// Form to purchase temprary website link
router.get("/purchase/temporary/:id", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const selectedWeb = await WebSample.findById(id);
  const isTemporary = true;
  const winnerCount = req.user.winnerCount || 0;
  res.render("purchaseForm", {
    selectedWeb,
    id,
    title: `Purchase ${selectedWeb.webName} – VishLink`,
    description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
    canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
    robots: "noindex, nofollow",
    isTemporary, winnerCount
  });
}))

// Form to purchase website link
router.get("/purchase/permanent/:id", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const selectedWeb = await WebSample.findById(id);
  const isTemporary = false;
  const winnerCount = 0;
  res.render("purchaseForm", {
    selectedWeb,
    id,
    title: `Purchase ${selectedWeb.webName} – VishLink`,
    description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
    canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
    robots: "noindex, nofollow",
    isTemporary, winnerCount
  });
}))

// Save Purchased 
router.post("/purchase/:id", isLoggedIn,

  upload.fields([
    { name: "images", maxCount: 5 },        // multiple images
    { name: "paymentImage", maxCount: 1 }   // single image
  ]),

  validatepurchase,

  wrapAsync(async (req, res) => {
    const uploadedPublicIds = [
      ...(req.files?.images || []).map((file) => file.filename),
      ...(req.files?.paymentImage || []).map((file) => file.filename),
    ];

    const cleanupUploads = async () => {
      if (!uploadedPublicIds.length) return;
      await Promise.allSettled(
        uploadedPublicIds.map((publicId) => cloudinary.uploader.destroy(publicId))
      );
    };

    try {
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

      const buyinfo = req.body.purchase || {};
      const parsedPrice = Number(buyinfo.price);
      const price = Number.isFinite(parsedPrice) ? parsedPrice : 0;
      const sender =
        typeof buyinfo.sender === "string" && buyinfo.sender.trim()
          ? buyinfo.sender.trim()
          : "Anonymous";
      const receiver =
        typeof buyinfo.receiver === "string" ? buyinfo.receiver.trim() : "";
      const specialMsgText =
        typeof buyinfo.specialMsg === "string" && buyinfo.specialMsg.trim()
          ? buyinfo.specialMsg.trim()
          : "Best wishes!";
      const purchaseId = uuidv4();
      const finalWebUrl = `${selectedWeb.webUrl || ""}${purchaseId}`;
      const isLive = price <= 15;
      const isTemporary =
        typeof buyinfo.isTemporary === "boolean"
          ? buyinfo.isTemporary
          : String(buyinfo.isTemporary).toLowerCase() === "true";

      const savedPurchase = await new purchasedWeb({
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
              permanentLink: "",
            },
          },
        });

        await WebSample.findByIdAndUpdate(id, { $inc: { soldOut: 1 } });

        if (selectedWeb.priceForTemporary > 0) {
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

  }))



module.exports = router;
