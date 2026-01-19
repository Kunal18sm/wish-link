const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js")
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const passport = require("passport");


//home route
router.get("/", wrapAsync(async (req, res) => {
  res.locals.message = req.flash("success");
  let allSamples = await WebSample.find().sort({ _id: -1 });
  res.render("home", { allSamples });
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
    failureFlash:true,
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






module.exports = router;