const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js")
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const {saveRedirectUrl} = require("../middleware.js");
const passport = require("passport");
const {isAdmin} = require("../middleware.js")
// adding sample data 
router.post("/home", wrapAsync(async (req, res) => {
  const testData = new WebSample({
    webName: "testweb1",
    price: "1",
    imageUrl: "testimgurl1",
    webUrl: "testwebUrl1",
  })

  try {
    const saving = await testData.save();
    console.log(saving);
    console.log("saved data");
    res.send("saved test data")
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "failed to save" });
  }

}))

router.get("/", wrapAsync(async (req, res) => {
  res.locals.message = req.flash("success");
  let allSamples = await WebSample.find();
  res.render("home", { allSamples });
}))

// show all samples
router.get("/home", wrapAsync(async (req, res) => {
  let allSamples = await WebSample.find();
  res.render("home", { allSamples });
}))

// form to add new web
router.get("/new",isAdmin, wrapAsync(async (req, res) => {
  res.render("addNewWeb")
}))

// add new sample website (ADMIN)
router.post("/new", wrapAsync(async (req, res) => {
  const formData = req.body.listing;
  const newSample = new WebSample({
    webName: formData.webName,
    price: formData.price,
    imageUrl: formData.imageUrl,
    webUrl: formData.webUrl,
    description: formData.description
  })
  const Saved = await newSample.save();
  console.log(Saved);
  res.redirect("/");
}))

// Form to purchase website link
router.get("/purchase/:id", isLoggedIn, wrapAsync(async (req, res) => {
  console.log(req.user);

  const { id } = req.params;
  const selectedWeb = await WebSample.findById(id);
  res.render("purchaseForm", { selectedWeb, id });
}))

// Save Purchased 
router.post("/purchase/:id", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const buyinfo = req.body.purchase;
  const specialMsgarr = [buyinfo.specialMsg];

  const imageUrlarr = [buyinfo.imageUrl]
  const newPurchase = new purchasedWeb({
    webId: id,
    sender: buyinfo.sender,
    receiver: buyinfo.receiver,
    price: buyinfo.price,
    imageUrl: imageUrlarr,
    paymentProofUrl: buyinfo.paymentProofUrl,
    specialMsg: specialMsgarr,
    author: req.user._id,
    webName: buyinfo.webName ,
  })

  try {
    const save = await newPurchase.save();
    console.log("Purchase success");
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
    console.log("chala ja bcdk");

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
router.get("/profile",isLoggedIn, async(req,res)=>{
  let purchasedLinks = await purchasedWeb.find({author:req.user._id});
  
  res.render("profile",{purchasedLinks});
})



router.get("/all", async (req, res) => {
  let allSamples = await WebSample.find();
  res.render("home", { allSamples });
})

module.exports = router;