const express = require("express");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const purchasedWeb = require("../models/purchasedWeb.js");
const router = express.Router({ mergeParams: true });
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js");
const contactSchema = require("../models/contact.js");
const { createAuthToken, setAuthCookie, clearAuthCookie } = require("../utils/jwtAuth.js");
const { getCreditDateKey, getDailyRewardCredits } = require("../utils/creditUtils.js");
const { getHomeSamples, getCategorySamples } = require("../utils/webSampleCache.js");
const { getBannerSlides, BANNER_PAGES } = require("../utils/bannerConfigCache.js");

const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const googleOAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const REQUEST_SCOPE = {
  DEFAULT: "default",
  PERMANENT: "permanent",
};
const NEW_SIGNUP_CREDITS = 15;
const PROFILE_PURCHASE_SELECT = "webName webUrl receiver price isLive isTemporary date author";
const HERO_PRIMARY_IMAGE =
  "https://res.cloudinary.com/drzq6kjgp/image/upload/v1770794063/Gemini_Generated_Image_4qzfxy4qzfxy4qzf_l5tidy.png";

function getFrameTemplateModel(req) {
  return req.app.locals.permanentFrameTemplate || null;
}

function isCloudinaryUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return false;
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "https:" && parsedUrl.hostname === "res.cloudinary.com";
  } catch (_err) {
    return false;
  }
}

function toFrameProxyUrl(rawUrl) {
  const normalized = String(rawUrl || "").trim();
  if (!normalized) return "";
  if (!isCloudinaryUrl(normalized)) return normalized;
  return `/cdn/image?u=${encodeURIComponent(normalized)}`;
}

function toClientFrameTemplate(rawTemplate, res) {
  const frameImageUrl = String(rawTemplate?.frameImage?.url || "").trim();
  const previewWidth = Number(rawTemplate?.canvas?.width || 1000);
  const optimizedFrameUrl =
    typeof res?.locals?.getOptimizedCloudinaryUrl === "function"
      ? res.locals.getOptimizedCloudinaryUrl(frameImageUrl, "default", Math.min(previewWidth, 1400))
      : frameImageUrl;

  return {
    id: String(rawTemplate?._id || ""),
    name: String(rawTemplate?.name || "").trim(),
    slug: String(rawTemplate?.slug || "").trim(),
    description: String(rawTemplate?.description || "").trim(),
    isActive: Boolean(rawTemplate?.isActive),
    canvas: {
      width: Number(rawTemplate?.canvas?.width || 1080),
      height: Number(rawTemplate?.canvas?.height || 1080),
    },
    frameImage: {
      url: frameImageUrl,
      previewUrl: toFrameProxyUrl(optimizedFrameUrl),
      exportUrl: toFrameProxyUrl(frameImageUrl),
    },
    imageSlots: Array.isArray(rawTemplate?.imageSlots) ? rawTemplate.imageSlots : [],
    texts: Array.isArray(rawTemplate?.texts) ? rawTemplate.texts : [],
  };
}

function buildLcpImageMeta(res, cloudinaryUrl) {
  const resolvedUrl = String(cloudinaryUrl || "").trim();
  if (!resolvedUrl) {
    return {};
  }

  if (!res?.locals?.getOptimizedCloudinaryUrl || !res?.locals?.getResponsiveCloudinarySrcSet) {
    return {};
  }

  return {
    lcpImageUrl: res.locals.getOptimizedCloudinaryUrl(resolvedUrl, "banner"),
    lcpImageSrcSet: res.locals.getResponsiveCloudinarySrcSet(resolvedUrl, "banner"),
    lcpImageSizes: "(max-width: 640px) 92vw, (max-width: 1024px) 84vw, 840px",
  };
}

function getPrimaryBannerImageUrl(bannerSlides = []) {
  const firstSlide = Array.isArray(bannerSlides) ? bannerSlides[0] : null;
  const bannerImage = String(firstSlide?.imageUrl || "").trim();
  return bannerImage || HERO_PRIMARY_IMAGE;
}

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
  const permanentModel = req.app.locals.permanentPurchasedWeb;
  const normalQuery = purchasedWeb
    .find({ author: authorId })
    .select(PROFILE_PURCHASE_SELECT)
    .lean();
  const permanentQuery = permanentModel
    ? permanentModel.find({ author: authorId }).select(PROFILE_PURCHASE_SELECT).lean()
    : Promise.resolve([]);

  const [normalLinks, permanentLinks] = await Promise.all([normalQuery, permanentQuery]);
  const mergedLinks = normalLinks.map((item) => ({
    ...item,
    requestScope: REQUEST_SCOPE.DEFAULT,
  }));

  if (permanentLinks.length) {
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
  const [allSamples, bannerSlides] = await Promise.all([
    getHomeSamples(),
    getBannerSlides(BANNER_PAGES.HOME),
  ]);

  res.render("home", {
    allSamples,
    bannerSlides,
    designCssVariant: "lite",
    ...buildLcpImageMeta(res, getPrimaryBannerImageUrl(bannerSlides)),
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
  const [allSamples, bannerSlides] = await Promise.all([
    getCategorySamples(normalizedTag),
    getBannerSlides(BANNER_PAGES.COLLECTION),
  ]);

  res.render("collection", {
    allSamples,
    bannerSlides,
    activeTag: normalizedTag,
    designCssVariant: "lite",
    ...buildLcpImageMeta(res, getPrimaryBannerImageUrl(bannerSlides)),
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

router.get("/photo-frames", wrapAsync(async (req, res) => {
  const FrameTemplate = getFrameTemplateModel(req);
  const isAdminViewer = Boolean(req.user?.isAdmin);
  const frameTemplateQuery = isAdminViewer ? {} : { isActive: true };
  const templates = FrameTemplate
    ? await FrameTemplate.find(frameTemplateQuery)
      .select("name slug description frameImage canvas imageSlots texts isActive")
      .sort({ createdAt: -1 })
      .lean()
    : [];

  const clientTemplates = templates.map((template) => toClientFrameTemplate(template, res));

  return res.render("photoFrameTemplates", {
    frameTemplates: clientTemplates,
    permanentTemplatesReady: Boolean(FrameTemplate),
    isAdminViewer,
    title: "Photo Frame Templates - VishLink",
    description: "Browse beautiful photo frame templates and open one to create your final frame image.",
    canonical: `${SITE_URL}/photo-frames`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "VishLink Photo Frame Templates",
      url: `${SITE_URL}/photo-frames`,
      description:
        "Choose from ready-made birthday and celebration photo frame templates.",
    },
  });
}));

router.get("/photo-frames/:slug", wrapAsync(async (req, res) => {
  const FrameTemplate = getFrameTemplateModel(req);
  const selectedTemplateSlug = String(req.params.slug || "").trim().toLowerCase();
  const isAdminViewer = Boolean(req.user?.isAdmin);
  const templateQuery = isAdminViewer
    ? { slug: selectedTemplateSlug }
    : { isActive: true, slug: selectedTemplateSlug };
  const templateDoc = FrameTemplate
    ? await FrameTemplate.findOne(templateQuery)
      .select("name slug description frameImage canvas imageSlots texts")
      .lean()
    : null;

  if (!templateDoc) {
    req.flash("error", "Selected photo frame template not found.");
    return res.redirect("/photo-frames");
  }

  const selectedTemplate = toClientFrameTemplate(templateDoc, res);

  return res.render("photoFrameEditor", {
    frameTemplates: [selectedTemplate],
    selectedTemplateSlug,
    permanentTemplatesReady: Boolean(FrameTemplate),
    title: `${selectedTemplate.name} - Photo Frame Studio | VishLink`,
    description: `Customize ${selectedTemplate.name} with your photos and text, then download instantly.`,
    canonical: `${SITE_URL}/photo-frames/${encodeURIComponent(selectedTemplateSlug)}`,
    robots: "index, follow",
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
    const newUser = new user({
      email,
      username,
      winnerCount: NEW_SIGNUP_CREDITS,
    });

    const registeredUser = await user.register(newUser, password);
    const token = createAuthToken(registeredUser);
    setAuthCookie(res, token);
    req.flash("success", `Welcome to VishLink! +${NEW_SIGNUP_CREDITS} coins added.`);
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

    let existingUser = await user.findOne({ email }).select("_id username email isAdmin");
    if (!existingUser) {
      const username = await buildUniqueUsername(payload.name || email.split("@")[0] || "vishlink");
      const newUser = new user({
        email,
        username,
        winnerCount: NEW_SIGNUP_CREDITS,
      });
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

router.post("/credits/claim-daily", isLoggedIn, wrapAsync(async (req, res) => {
  const todayDateKey = getCreditDateKey();
  const rewardCredits = getDailyRewardCredits();
  const acceptHeader = String(req.get("accept") || "");
  const wantsJson = req.xhr || acceptHeader.includes("application/json");

  const updatedUser = await user.findOneAndUpdate(
    {
      _id: req.user._id,
      "dailyCreditClaim.dateKey": { $ne: todayDateKey },
    },
    {
      $inc: { winnerCount: rewardCredits },
      $set: {
        dailyCreditClaim: {
          dateKey: todayDateKey,
          amount: rewardCredits,
          claimedAt: new Date(),
        },
      },
    },
    {
      new: true,
      projection: { winnerCount: 1 },
    }
  );

  if (!updatedUser) {
    const message = "Daily reward already claimed for today.";
    if (wantsJson) {
      return res.status(409).json({
        ok: false,
        message,
      });
    }

    req.flash("error", message);
    return res.redirect(req.get("Referrer") || "/");
  }

  req.user.winnerCount = Number(updatedUser.winnerCount || 0);
  req.user.dailyCreditClaim = {
    dateKey: todayDateKey,
    amount: rewardCredits,
    claimedAt: new Date(),
  };

  if (wantsJson) {
    return res.json({
      ok: true,
      message: `Daily reward claimed: +${rewardCredits} credits.`,
      claimedCredits: rewardCredits,
      claimedDateKey: todayDateKey,
      totalCredits: Number(updatedUser.winnerCount || 0),
    });
  }

  req.flash("success", `Daily reward claimed: +${rewardCredits} credits.`);
  return res.redirect(req.get("Referrer") || "/");
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
  const [stats] = await user.aggregate([
    { $match: { _id: req.user._id } },
    {
      $project: {
        totalLinksCreated: {
          $size: {
            $ifNull: ["$webCollection", []],
          },
        },
      },
    },
  ]);
  const viewHistory = false;

  res.render("profile", {
    profileUser: req.user,
    totalLinksCreated: Number(stats?.totalLinksCreated || 0),
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
  const profileUser = await user
    .findById(req.user._id)
    .select("_id username email winnerCount webCollection")
    .lean();
  const purchasedLinks = Array.isArray(profileUser?.webCollection) ? profileUser.webCollection : [];
  const viewHistory = true;

  res.render("profile", {
    profileUser: profileUser || req.user,
    totalLinksCreated: purchasedLinks.length,
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
