const express = require("express");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin } = require("../middleware.js")
const { cloudinary } = require("../cloudConfig.js");
const { findOne } = require("../models/user.js");
const WebSample = require("../models/WebSample.js");



// get requests page
router.get("/", isLoggedIn, isAdmin,wrapAsync( async (req, res) => {
  let userPurchased = await purchasedWeb.find({ adminInterected: false });
  res.render("requests", { userPurchased });
}))

// request accepted
router.get("/accept/:id", isLoggedIn, isAdmin,wrapAsync(async (req, res) => {
  const { id } = req.params;
  const web = await purchasedWeb.findByIdAndUpdate(id, {
    isLive: true,
    adminInterected: true
  })

  //increasing soldout count
  const purchasedWebsiteName = web.webName;
  const updatedSoldCount = await WebSample.findOneAndUpdate(
    {webName:purchasedWebsiteName},         // current user
    { $inc: { soldOut: 1 } }, 
  );


  req.flash("success","Request Accepted")
  res.redirect("/requests");
}))

// get expired websites 
router.get("/expired", isLoggedIn, isAdmin,wrapAsync( async (req, res) => {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  let userPurchased = await purchasedWeb.find({ date: { $lte: tenDaysAgo } });
  res.render("requests", { userPurchased });
}))

// delete purchased web
router.delete("/delete/:id", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  try {
    const { id } = req.params;

    const toDelete = await purchasedWeb.findById(id);
    if (!toDelete) {
      return res.redirect("/requests/expired");
    }

    // delete images from cloudinary
    await Promise.all(
      toDelete.images.map(image =>
        cloudinary.uploader.destroy(image.filename)
      )
    );

    // if (toDelete.paymentProofUrl.url) {
    //   await cloudinary.uploader.destroy(toDelete.paymentProofUrl.url);
    // }

    await purchasedWeb.findByIdAndDelete(id);
    req.flash("success","Deleted")
    res.redirect("/requests/expired");
  } catch (err) {
    console.error(err);
    res.redirect("/requests/expired");
  }
}))


module.exports = router;