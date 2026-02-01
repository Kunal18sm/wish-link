const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js")
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const passport = require("passport");
const contactSchema = require("../models/contact.js")

//home route
router.get("/", wrapAsync(async (req, res) => {
  res.locals.message = req.flash("success");
  let allSamples = await WebSample.find().sort({ _id: -1 });
  res.render("home", {
    allSamples,
    title: "Create Personalized Wishing Websites | VishLink",
    description:
      "Create beautiful personalized birthday, anniversary and love wishing websites. Share a unique link instantly.",
    canonical: "https://wishlink-7j0a.onrender.com/"
  });

}))

//category route
router.get("/category/:tag", wrapAsync(async (req, res) => {
  const { tag } = req.params;
  res.locals.message = req.flash("success");
  let allSamples = await WebSample.find({ tags: tag }).sort({ _id: -1 });
  res.render("collection", {
    allSamples,
    activeTag: tag,
    title: `${tag} Wishing Websites | VishLink`,
    description: `Create personalized ${tag} wishing websites and share memorable moments.`,
    canonical: `https://wishlink-7j0a.onrender.com/category/${tag}`
  });
}));


// Get signUp form 
router.get("/signUpForm", wrapAsync(async (req, res) => {
  if (req.isAuthenticated()) {
    req.flash("error", "you are already logged in")
    res.redirect("/");
  }
  res.render("signUp", {
    title: "Sign Up – VishLink",
    description: "Create a free VishLink account and start building personalized wishing websites.",
    canonical: "https://wishlink-7j0a.onrender.com/signUpForm"
  });
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
      req.flash("success", "Welcome to VishLink");
      res.redirect("/");
    })

  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/signUpForm");
  }
}))

// get login form
router.get("/logInForm", wrapAsync(async (req, res) => {
  res.render("logIn", {
    title: "Login – VishLink",
    description: "Login to VishLink to manage and share your personalized wishing websites.",
    canonical: "https://wishlink-7j0a.onrender.com/logInForm"
  });
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

  res.render("profile", {
    purchasedLinks,
    title: "My Profile – VishLink",
    description: "Manage your VishLink profile and purchased wishing websites.",
    canonical: "https://wishlink-7j0a.onrender.com/profile",
    robots: "noindex, nofollow"
  });
})



// footer pages 

router.get("/about", (req, res) => {
  res.render("pages/about")
})

router.get("/contact", (req, res) => {
  res.render("pages/contact")
})

router.get("/terms", (req, res) => {
  res.render("pages/terms")
})

router.get("/privacy-policy", (req, res) => {
  res.render("pages/privacy-policy")
})

router.post("/sent", wrapAsync(async (req, res) => {
  const contactData = req.body.contactData;
  try {
    const newcontact = new contactSchema({
      name: contactData.name,
      email: contactData.email,
      subject: contactData.subject,
      message: contactData.msg

    })
    await newcontact.save();
    req.flash("success","Message sent successfully.")
    res.redirect("/");
  } catch (error) {
    res.redirect("/");
  }


}))




module.exports = router;