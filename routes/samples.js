const express = require("express");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const WebSample = require("../models/WebSample.js");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js");
const contactSchema = require("../models/contact.js");
const { createAuthToken, setAuthCookie, clearAuthCookie } = require("../utils/jwtAuth.js");

const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const googleOAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const REQUEST_SCOPE = {
  DEFAULT: "default",
  PERMANENT: "permanent",
};

function makeUsernameSlug(rawValue) {
  const normalized = String(rawValue || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);

  return normalized || "vishlink_user";
}

async function buildUniqueUsername(seedText) {
  const base = makeUsernameSlug(seedText);
  let candidate = base;
  let suffix = 1;

  while (await user.exists({ username: candidate })) {
    candidate = `${base}_${suffix}`.slice(0, 28);
    suffix += 1;
  }

  return candidate;
}

async function loadMergedPurchases(req, authorId) {
  const normalLinks = await purchasedWeb.find({ author: authorId }).lean();
  const mergedLinks = normalLinks.map((item) => ({
    ...item,
    requestScope: REQUEST_SCOPE.DEFAULT,
  }));

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (permanentModel) {
    const permanentLinks = await permanentModel.find({ author: authorId }).lean();
    mergedLinks.push(
      ...permanentLinks.map((item) => ({
        ...item,
        requestScope: REQUEST_SCOPE.PERMANENT,
      }))
    );
  }

  mergedLinks.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return mergedLinks;
}

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
  if (req.user) {
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
router.post("/signUp", wrapAsync(async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const newUser = new user({ email, username });

    const registeredUser = await user.register(newUser, password);
    const token = createAuthToken(registeredUser);
    setAuthCookie(res, token);
    req.flash("success", "Welcome to VishLink");
    return res.redirect("/");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/signUpForm");
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

router.post("/auth/google", wrapAsync(async (req, res) => {
  if (!googleOAuthClient || !GOOGLE_CLIENT_ID) {
    return res.status(503).json({
      ok: false,
      message: "Google authentication is not configured on server.",
    });
  }

  const credential = String(req.body?.credential || "");
  if (!credential) {
    return res.status(400).json({ ok: false, message: "Missing Google credential." });
  }

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload() || {};

    const email = String(payload.email || "").toLowerCase().trim();
    if (!email || payload.email_verified !== true) {
      return res.status(401).json({
        ok: false,
        message: "Google account email is not verified.",
      });
    }

    let existingUser = await user.findOne({ email });
    if (!existingUser) {
      const username = await buildUniqueUsername(payload.name || email.split("@")[0] || "vishlink");
      const newUser = new user({ email, username });
      const randomPassword = crypto.randomBytes(32).toString("hex");
      existingUser = await user.register(newUser, randomPassword);
    }

    const token = createAuthToken(existingUser);
    setAuthCookie(res, token);

    return res.json({
      ok: true,
      redirectTo: "/",
    });
  } catch (_err) {
    return res.status(401).json({
      ok: false,
      message: "Google sign-in failed. Please try again.",
    });
  }
}));

function authenticateUserByPassword(username, password) {
  return new Promise((resolve, reject) => {
    user.authenticate()(username, password, (err, authenticatedUser, info = {}) => {
      if (err) return reject(err);
      if (!authenticatedUser) {
        return resolve({
          ok: false,
          message: info.message || "Invalid username or password.",
        });
      }
      return resolve({ ok: true, user: authenticatedUser });
    });
  });
}

// login
router.post("/login", wrapAsync(async (req, res) => {
  const { username, password } = req.body;
  const authResult = await authenticateUserByPassword(username, password);

  if (!authResult.ok) {
    req.flash("error", authResult.message);
    return res.redirect("/logInForm");
  }

  const token = createAuthToken(authResult.user);
  setAuthCookie(res, token);
  req.flash("success", "Welcome Back!");
  return res.redirect("/");
}));

// logOut
router.get("/logout", isLoggedIn, (req, res) => {
  clearAuthCookie(res);
  req.flash("success", "you are logged out");
  return res.redirect("/");
});

// render profile page
router.get("/profile", isLoggedIn, async (req, res) => {
  const purchasedLinks = await loadMergedPurchases(req, req.user._id);
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
