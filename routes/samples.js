const express = require("express");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js");
const passport = require("passport");
const contactSchema = require("../models/contact.js");

const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");

// home route
router.get("/", wrapAsync(async (req, res) => {
  res.locals.message = req.flash("success");
  const allSamples = await WebSample.find().sort({ _id: -1 });

  res.render("home", {
    allSamples,
    title: "Create Personalized Wishing Websites | VishLink",
    description: "Create beautiful personalized birthday, anniversary and love wishing websites. Share a unique link instantly.",
    canonical: `${SITE_URL}/`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Personalized Wishing Website Templates",
      url: `${SITE_URL}/`,
      description: "Browse personalized wishing website templates for birthdays, anniversaries, and special moments."
    }
  });
}));

// category route
router.get("/category/:tag", wrapAsync(async (req, res) => {
  const { tag } = req.params;
  const normalizedTag = String(tag || "").trim();
  const encodedTag = encodeURIComponent(normalizedTag);

  res.locals.message = req.flash("success");
  const allSamples = await WebSample.find({ tags: normalizedTag }).sort({ _id: -1 });

  res.render("collection", {
    allSamples,
    activeTag: normalizedTag,
    title: `${normalizedTag} Wishing Websites | VishLink`,
    description: `Create personalized ${normalizedTag} wishing websites and share memorable moments.`,
    canonical: `${SITE_URL}/category/${encodedTag}`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${normalizedTag} Wishing Website Templates`,
      url: `${SITE_URL}/category/${encodedTag}`,
      description: `Explore ${normalizedTag} wishing website templates on VishLink.`
    }
  });
}));

// Get signUp form
router.get("/signUpForm", wrapAsync(async (req, res) => {
  if (req.isAuthenticated()) {
    req.flash("error", "you are already logged in");
    return res.redirect("/");
  }

  res.render("signUp", {
    title: "Sign Up - VishLink",
    description: "Create a free VishLink account and start building personalized wishing websites.",
    canonical: `${SITE_URL}/signUpForm`,
    robots: "noindex, nofollow"
  });
}));

// User signUp
router.post("/signUp", wrapAsync(async (req, res, next) => {
  try {
    const { username, password, email } = req.body;
    const newUser = new user({ email, username });

    const registeredUser = await user.register(newUser, password);

    // instant login after signUp
    req.login(registeredUser, (err) => {
      if (err) {
        return next(err);
      }
      req.flash("success", "Welcome to VishLink");
      res.redirect("/");
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/signUpForm");
  }
}));

// get login form
router.get("/logInForm", wrapAsync(async (req, res) => {
  res.render("logIn", {
    title: "Login - VishLink",
    description: "Login to VishLink to manage and share your personalized wishing websites.",
    canonical: `${SITE_URL}/logInForm`,
    robots: "noindex, nofollow"
  });
}));

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
    req.flash("success", "you are logged out");
    res.redirect("/");
  });
});

// render profile page
router.get("/profile", isLoggedIn, async (req, res) => {
  const purchasedLinks = await purchasedWeb.find({ author: req.user._id });
  const viewHistory = false;

  res.render("profile", {
    purchasedLinks,
    viewHistory,
    title: "My Profile - VishLink",
    description: "Manage your VishLink profile and purchased wishing websites.",
    canonical: `${SITE_URL}/profile`,
    robots: "noindex, nofollow"
  });
});

// render all creation page
router.get("/viewHistory", isLoggedIn, async (req, res) => {
  const purchasedLinks = await req.user.webCollection;
  const viewHistory = true;

  res.render("profile", {
    purchasedLinks,
    viewHistory,
    title: "My Profile - VishLink",
    description: "Manage your VishLink profile and purchased wishing websites.",
    canonical: `${SITE_URL}/profile`,
    robots: "noindex, nofollow"
  });
});

// footer pages
router.get("/about", (req, res) => {
  res.render("pages/about", {
    title: "About VishLink - Personalized Digital Celebration Platform",
    description: "Learn how VishLink helps you create personalized digital wishing websites for birthdays, anniversaries, and special moments.",
    canonical: `${SITE_URL}/about`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      name: "About VishLink",
      url: `${SITE_URL}/about`
    }
  });
});

router.get("/contact", (req, res) => {
  res.render("pages/contact", {
    title: "Contact VishLink",
    description: "Contact VishLink for support, suggestions, or partnership inquiries about personalized wishing websites.",
    canonical: `${SITE_URL}/contact`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      name: "Contact VishLink",
      url: `${SITE_URL}/contact`
    }
  });
});

router.get("/terms", (req, res) => {
  res.render("pages/terms", {
    title: "Terms and Conditions - VishLink",
    description: "Read VishLink terms and conditions for using personalized wishing website services.",
    canonical: `${SITE_URL}/terms`
  });
});

router.get("/privacy-policy", (req, res) => {
  res.render("pages/privacy-policy", {
    title: "Privacy Policy - VishLink",
    description: "Read the VishLink privacy policy to understand how your data is collected, used, and protected.",
    canonical: `${SITE_URL}/privacy-policy`
  });
});

router.post("/sent", wrapAsync(async (req, res) => {
  const contactData = req.body.contactData;
  try {
    const newcontact = new contactSchema({
      name: contactData.name,
      email: contactData.email,
      subject: contactData.subject,
      message: contactData.msg
    });
    await newcontact.save();
    req.flash("success", "Message sent successfully.");
    res.redirect("/");
  } catch (_error) {
    res.redirect("/");
  }
}));

module.exports = router;
