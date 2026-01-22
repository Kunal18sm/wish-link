const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const user = require("../models/user.js");

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
  res.render("addNewWeb", {
    title: "Add New Website – WishLink",
    description: "Admin panel to add new wishing website templates.",
    robots: "noindex, nofollow"
  });
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
    description: formData.description,
    imageNeeded: formData.imageNeeded,
    tags: formData.category,
  })
  const Saved = await newSample.save();
  req.flash("success", "Added new website");
  res.redirect("/");
}))

// Form to purchase website link
router.get("/purchase/:id", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const selectedWeb = await WebSample.findById(id);
  res.render("purchaseForm", {
    selectedWeb,
    id,
    title: `Purchase ${selectedWeb.webName} – WishLink`,
    description: `Purchase and personalize the ${selectedWeb.webName} wishing website.`,
    canonical: `https://wishlink-7j0a.onrender.com/web/purchase/${id}`,
    robots: "noindex, nofollow"
  });
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
    const selectedWeb = await WebSample.findOneAndUpdate(
      { _id: id },          // kaunsa document update hoga
      { $inc: { soldOut: 1 } }, // sirf soldout +1
      { new: true }         // updated data return karega
    )


    const buyinfo = req.body.purchase;
    const specialMsgarr = [buyinfo.specialMsg];
    const purchaseId = uuidv4();
    const finalWebUrl = `${selectedWeb.webUrl}${purchaseId}`;
    const isLive = buyinfo.price == "0" ? true : false;
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
      isLive: isLive,
    });

    //save details in user collection array
    const userId = req.user._id;;
    const saveInUser = await user.findByIdAndUpdate(userId, {
      $push: {
        webCollection: {
          webName: buyinfo.webName,
          dateOfBuy: new Date(),
          receiver: buyinfo.receiver,
          price: buyinfo.price,
          paymentProofUrl: paymentImg,
        }
      }
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