const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js")
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { saveRedirectUrl } = require("../middleware.js");
const passport = require("passport");
const { isAdmin } = require("../middleware.js")

const multer = require("multer");
const { storage } = require("../cloudConfig.js");
const upload = multer({ storage });

const { v4: uuidv4 } = require("uuid");

const { cloudinary } = require("../cloudConfig.js");

//home route
router.get("/", wrapAsync(async (req, res) => {
  res.locals.message = req.flash("success");
  let allSamples = await WebSample.find();
  res.render("home", { allSamples });
}))

// form to add new web
router.get("/new", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  res.render("addNewWeb")
}))

// add new sample website (ADMIN)
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
    const finalWebUrl = `${selectedWeb.webUrl}/${purchaseId}`;
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

// Get signUp form 
router.get("/signUpForm", wrapAsync(async (req, res) => {
  if (req.isAuthenticated()) {
    req.flash("error", "you are already logged in")
    res.redirect("/");
  }
  res.render("signUp");
}))

// User signUp 
router.post("/signUp", wrapAsync(async (req, res) => {
  try {
    let { username, password, email } = req.body;
    const newUser = new user({ email, username });
    const registeredUser = await user.register(newUser, password);

    // instant login after signUp
    req.login(registeredUser, (err) => {
      if (err) {
        return next(err);
      }
      req.flash("success", "Welcome to WishLink");
      res.redirect("/");
    })

  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/signUpForm");
  }
}))

// get login form
router.get("/logInForm", wrapAsync(async (req, res) => {
  res.render("logIn");
}))

// login 
router.post("/login",
  passport.authenticate("local", {
    failureRedirect: "/logInForm",
    failureFlash: true,
  }),
  async (req, res) => {
    req.flash("success", "Welcome Back!");
    res.redirect("/");
  }
);


// logOut 
router.get("/logout", isLoggedIn, (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.flash("success", "you are logged out")
    res.redirect("/");
  });
});


// render profile page
router.get("/profile", isLoggedIn, async (req, res) => {
  let purchasedLinks = await purchasedWeb.find({ author: req.user._id });

  res.render("profile", { purchasedLinks });
})

// requests page
router.get("/requests", isLoggedIn, isAdmin, async (req, res) => {
  let userPurchased = await purchasedWeb.find({ adminInterected: false });
  res.render("requests", { userPurchased });
})

// request accept
router.get("/request/accept/:id", isLoggedIn, isAdmin, async (req, res) => {
  const { id } = req.params;
  const web = await purchasedWeb.findByIdAndUpdate(id, {
    isLive: true,
    adminInterected: true
  })
  req.flash("success","Request Accepted")
  res.redirect("/requests");
})

// get expired websites 
router.get("/request/expired", isLoggedIn, isAdmin, async (req, res) => {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  let userPurchased = await purchasedWeb.find({ date: { $lte: tenDaysAgo } });
  res.render("requests", { userPurchased });
})


// delete purchased web
router.delete("/request/delete/:id", isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const toDelete = await purchasedWeb.findById(id);
    if (!toDelete) {
      return res.redirect("/request/expired");
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
    res.redirect("/request/expired");
  } catch (err) {
    console.error(err);
    res.redirect("/request/expired");
  }
});


module.exports = router;