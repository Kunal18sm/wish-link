const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin } = require("../middleware.js")

const multer = require("multer");
const { storage } = require("../cloudConfig.js");
const upload = multer({ storage });

const { v4: uuidv4 } = require("uuid");



// form to add new web
router.get("/new", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  res.render("addNewWeb")
}))

// save new website
router.post("/new", isLoggedIn, isAdmin, upload.single("imageUrl"), wrapAsync(async (req, res) => {

  let url = req.file.path;
  let filename = req.file.filename;

  const formData = req.body.listing;
  const newSample = new WebSample({
    webName: formData.webName,
    price: formData.price,
    imageUrl: { url, filename },
    webUrl: formData.webUrl,
    description: formData.description
  })
  const Saved = await newSample.save();
  req.flash("success","Added new website");
  res.redirect("/");
})) 

// Form to purchase website link
router.get("/purchase/:id", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const selectedWeb = await WebSample.findById(id);
  res.render("purchaseForm", { selectedWeb, id });
}))

// Save Purchased 
router.post("/purchase/:id", isLoggedIn,

  upload.fields([
    { name: "images", maxCount: 5 },        // multiple images
    { name: "paymentImage", maxCount: 1 }   // single image
  ]),

  wrapAsync(async (req, res) => {

    const imagesArr = req.files.images
      ? req.files.images.map(file => ({
        url: file.path,
        filename: file.filename
      }))
      : [];

    const paymentImg = req.files.paymentImage
      ? {
        url: req.files.paymentImage[0].path,
        filename: req.files.paymentImage[0].filename
      }
      : null;

    const { id } = req.params;
    const selectedWeb = await WebSample.findById(id);

    const buyinfo = req.body.purchase;
    const specialMsgarr = [buyinfo.specialMsg];
    const purchaseId = uuidv4();
    const finalWebUrl = `${selectedWeb.webUrl}${purchaseId}`;
    // const imageUrlarr = [buyinfo.imageUrl]
    const newPurchase = new purchasedWeb({
      purchaseId: purchaseId,
      webUrl: finalWebUrl,
      sender: buyinfo.sender,
      receiver: buyinfo.receiver,
      price: buyinfo.price,
      images: imagesArr,
      paymentProofUrl: paymentImg,
      specialMsg: specialMsgarr,
      author: req.user._id,
      webName: buyinfo.webName,
    })

    try {
      const save = await newPurchase.save();
      req.flash("success", "Purchase Success");
      res.redirect("/");
    } catch (err) {
      console.log(err);
      res.redirect("/");
    }
}))



module.exports = router;