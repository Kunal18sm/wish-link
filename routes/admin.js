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
const user = require("../models/user.js");
const { render } = require("ejs");
const mongoose = require("mongoose");


// get requests page
router.get("/", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  let userPurchased = await purchasedWeb.find({ adminInterected: false });
  res.render("requests", {
    userPurchased,
    title: "Admin Requests – VishLink",
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
  let userPurchased = await purchasedWeb.find({ date: { $lte: tenDaysAgo }, isTemporary: true });
  res.render("requests", {
    userPurchased,
    title: "Expired Websites – Admin | VishLink",
    description: "Admin panel to manage expired websites.",
    robots: "noindex, nofollow"
  });
}));

// get allLive websites 
router.get("/allLive", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  let userPurchased = await purchasedWeb.find({ isLive: true }).sort({ _id: -1 });
  res.render("requests", {
    userPurchased,
    title: "Live Websites – Admin | VishLink",
    description: "Admin panel to view all live websites.",
    robots: "noindex, nofollow"
  });
}))

// delete purchased web
router.delete("/delete/:id", isLoggedIn, wrapAsync(async (req, res) => {
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
    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    res.redirect("/profile");
  }
}))

// edit permanent link
router.get("/edit/:id", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  let userPurchased = await purchasedWeb.findById(req.params.id);
  res.render("edit", { userPurchased });
}))

router.post("/updateLink/:id", isAdmin, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const permanent = req.body.purchase;

  const web = await purchasedWeb.findByIdAndUpdate(id, {
    webUrl: permanent.url,
  })

  const userId = permanent.author;
  console.log("userId:", userId);
  console.log("userId type:", typeof userId);
  // const test = await user.findOne({
  //   _id: userId,
  //   "webCollection.purchasedId": new mongoose.Types.ObjectId(id)
  // });

  // console.log(test ? "MATCH FOUND" : "NO MATCH");

  const result = await user.updateOne(
    {
      _id: userId,
      "webCollection.purchasedId": new mongoose.Types.ObjectId(id)
    },
    {
      $set: {
        "webCollection.$.permanentLink": permanent.url
      }
    }
  );

  // console.log(result);

  req.flash("success", "Purchase Success");
  res.redirect("/requests");
}))

router.get("/userProfile/:id",isAdmin,wrapAsync(async(req,res)=>{
  const {id} = req.params;
  let purchasedLinks = await purchasedWeb.find({ author: id });
    const viewHistory = false;
    res.render("profile", {
      purchasedLinks,viewHistory,
      title: "My Profile – VishLink",
      description: "Manage your VishLink profile and purchased wishing websites.",
      canonical: "https://wishlink-7j0a.onrender.com/profile",
      robots: "noindex, nofollow"
    });
}))

router.get("/userProfileHistory/:id",isAdmin,wrapAsync(async(req,res)=>{
  const {id} = req.params;
  let purchasedLinks = await purchasedWeb.find({ author: id });
    const viewHistory = true;
    res.render("profile", {
      purchasedLinks,viewHistory,
      title: "My Profile – VishLink",
      description: "Manage your VishLink profile and purchased wishing websites.",
      canonical: "https://wishlink-7j0a.onrender.com/profile",
      robots: "noindex, nofollow"
    });
}))
module.exports = router;