const express = require("express");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin } = require("../middleware.js")
const { cloudinary } = require("../cloudConfig.js");
const { findOne } = require("../models/user.js");
const WebSample = require("../models/WebSample.js");
const feedback = require("../models/feedback.js");



// get requests page
router.get("/", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  let userPurchased = await purchasedWeb.find({ adminInterected: false });
  res.render("requests", {
    userPurchased,
    title: "Admin Requests – WishLink",
    description: "Admin panel to manage user purchase requests.",
    robots: "noindex, nofollow"
  });
}))


// request accepted
router.get("/accept/:id", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const web = await purchasedWeb.findByIdAndUpdate(id, {
    isLive: true,
    adminInterected: true
  })

  //increasing soldout count
  const purchasedWebsiteName = web.webName;
  const updatedSoldCount = await WebSample.findOneAndUpdate(
    { webName: purchasedWebsiteName },         // current user
    { $inc: { soldOut: 1 } },
  );


  req.flash("success", "Request Accepted")
  res.redirect("/requests");
}))

// get expired websites 
router.get("/expired", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  let userPurchased = await purchasedWeb.find({ date: { $lte: tenDaysAgo } });
  res.render("requests", {
    userPurchased,
    title: "Expired Websites – Admin | WishLink",
    description: "Admin panel to manage expired websites.",
    robots: "noindex, nofollow"
  });
}));

// get allLive websites 
router.get("/allLive", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  let userPurchased = await purchasedWeb.find({ isLive: true });
  res.render("requests", {
    userPurchased,
    title: "Live Websites – Admin | WishLink",
    description: "Admin panel to view all live websites.",
    robots: "noindex, nofollow"
  });
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

    await purchasedWeb.findByIdAndDelete(id);
    req.flash("success", "Deleted")
    res.redirect("/requests/expired");
  } catch (err) {
    console.error(err);
    res.redirect("/requests/expired");
  }
}))


module.exports = router;