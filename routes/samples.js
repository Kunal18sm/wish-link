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
const LIGHT_PALETTE_OPTIONS = new Set(["blue", "pink"]);
const PHOTO_FRAME_DOWNLOAD_CREDITS = Math.max(
  1,
  Number.parseInt(process.env.PHOTO_FRAME_DOWNLOAD_CREDITS || "1", 10) || 1
);
const NEW_SIGNUP_CREDITS = 15;
const PROFILE_PURCHASE_SELECT = "webName webUrl receiver price isLive isTemporary date author";
const HERO_PRIMARY_IMAGE =
  "https://res.cloudinary.com/drzq6kjgp/image/upload/v1770794063/Gemini_Generated_Image_4qzfxy4qzfxy4qzf_l5tidy.png";
const SEO_LANDING_PAGES = {
  "birthday-gift-website": {
    heading: "Birthday Gift Website Creator",
    title: "Birthday Gift Website Creator | VishLink",
    description:
      "Create a personalized birthday gift website with photos, messages and shareable link in minutes on VishLink.",
    keywords:
      "birthday gift website, birthday website maker, online birthday surprise, birthday wish website, VishLink",
    intro: [
      "VishLink helps you create a digital birthday surprise website with your own photos, message, and custom greeting flow.",
      "Instead of sending a simple text, you can share one beautiful link that feels premium and personal.",
    ],
    categoryLinks: [
      { label: "Birthday Templates", href: "/category/birthday" },
      { label: "Top Website Templates", href: "/" },
      { label: "Photo Frame Templates", href: "/photo-frames" },
    ],
    faqs: [
      {
        question: "Can I create a birthday website without coding?",
        answer: "Yes. VishLink templates are ready to use and require no coding.",
      },
      {
        question: "Can I add personal photos and message?",
        answer: "Yes. You can upload images and add your own special message while creating the link.",
      },
      {
        question: "Can I share it instantly?",
        answer: "Yes. Once the link is created, you can share it on WhatsApp or any social app.",
      },
    ],
  },
  "anniversary-gift-website": {
    heading: "Anniversary Website Maker",
    title: "Anniversary Website Maker | VishLink",
    description:
      "Create romantic anniversary surprise websites online with personalized photos and heartfelt wishes using VishLink.",
    keywords:
      "anniversary website maker, anniversary gift website, romantic surprise website, couple website, VishLink",
    intro: [
      "Design a romantic anniversary website that captures your memories in one shareable link.",
      "Choose a template, upload moments, and deliver a thoughtful digital gift that feels memorable.",
    ],
    categoryLinks: [
      { label: "Anniversary Templates", href: "/category/anniversary" },
      { label: "Couple Templates", href: "/category/couple" },
      { label: "Valentine's Templates", href: "/category/valentine%27s" },
    ],
    faqs: [
      {
        question: "Is VishLink good for anniversary surprises?",
        answer: "Yes. It is designed for personalized celebrations including anniversaries and couple moments.",
      },
      {
        question: "Can I use it for wedding anniversaries?",
        answer: "Yes. You can use anniversary and wedding style templates as per your need.",
      },
      {
        question: "Do I need design skills?",
        answer: "No. The templates are pre-designed and easy to customize.",
      },
    ],
  },
  "online-wishing-website-maker": {
    heading: "Online Wishing Website Maker",
    title: "Online Wishing Website Maker | VishLink",
    description:
      "Build personalized wishing websites online for birthdays, anniversaries, festivals and special occasions with VishLink.",
    keywords:
      "wishing website maker, online greeting website, personalized wish website, digital wishes link, VishLink",
    intro: [
      "VishLink is an easy platform for creating personalized wishing websites for every celebration.",
      "From birthday and anniversary to festive greetings, you can create and share in a few minutes.",
    ],
    categoryLinks: [
      { label: "All Templates", href: "/category/all" },
      { label: "Festival Templates", href: "/category/festival" },
      { label: "New Year Templates", href: "/category/new year" },
    ],
    faqs: [
      {
        question: "Which events can I use this for?",
        answer: "You can use VishLink for birthdays, anniversaries, festivals, friends and family wishes.",
      },
      {
        question: "Can I create and share from mobile?",
        answer: "Yes. VishLink works on mobile and desktop browsers.",
      },
      {
        question: "How fast can I publish?",
        answer: "You can create and share your wishing link in just a few steps.",
      },
    ],
  },
  "digital-gift-ideas": {
    heading: "Digital Gift Ideas with Personalized Links",
    title: "Digital Gift Ideas - Personalized Website Gifts | VishLink",
    description:
      "Explore digital gift ideas like personalized birthday and anniversary website links that feel unique and memorable.",
    keywords:
      "digital gift ideas, online gift ideas, personalized link gift, birthday surprise ideas, anniversary surprise ideas, VishLink",
    intro: [
      "If you are searching for meaningful digital gift ideas, personalized website links are a creative and modern option.",
      "With VishLink, each gift link can include photos, custom message and celebration theme in one place.",
    ],
    categoryLinks: [
      { label: "Birthday Gift Ideas", href: "/birthday-gift-website" },
      { label: "Anniversary Gift Ideas", href: "/anniversary-gift-website" },
      { label: "Wishing Website Maker", href: "/online-wishing-website-maker" },
    ],
    faqs: [
      {
        question: "Are digital gifts better than normal text wishes?",
        answer: "Digital gift links feel more personal because they include visual memories and custom storytelling.",
      },
      {
        question: "Is this useful for long-distance celebrations?",
        answer: "Yes. A shareable personalized link works perfectly for long-distance gifting.",
      },
      {
        question: "Can I reuse templates for different events?",
        answer: "Yes. You can choose different templates based on the event and audience.",
      },
    ],
  },
};

function setNoStoreHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

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

function normalizeLightPalette(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LIGHT_PALETTE_OPTIONS.has(normalized) ? normalized : null;
}

function toTitleCase(rawValue) {
  return String(rawValue || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
  const FrameTemplate = getFrameTemplateModel(req);
  const [allSamples, bannerSlides, rawTopPhotoFrameTemplates] = await Promise.all([
    getHomeSamples(),
    getBannerSlides(BANNER_PAGES.HOME),
    FrameTemplate
      ? FrameTemplate.find({ isActive: true })
        .select("name slug description frameImage canvas imageSlots texts isActive")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
      : Promise.resolve([]),
  ]);
  const topTemplates = allSamples.slice(0, 10);
  const topPhotoFrameTemplates = rawTopPhotoFrameTemplates.map((template) =>
    toClientFrameTemplate(template, res)
  );

  res.render("home", {
    allSamples,
    topTemplates,
    topPhotoFrameTemplates,
    bannerSlides,
    designCssVariant: "lite",
    ...buildLcpImageMeta(res, getPrimaryBannerImageUrl(bannerSlides)),
    title: "VishLink - Birthday, Anniversary & Personalized Wishing Website Creator",
    description:
      "Create personalized birthday, anniversary, and celebration wishing websites. Share a unique gift link instantly with VishLink.",
    keywords:
      "VishLink, birthday website creator, anniversary website maker, personalized wishing website, digital gift link",
    canonical: `${SITE_URL}/`,
    structuredData: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Personalized Wishing Website Templates",
        url: `${SITE_URL}/`,
        description:
          "Browse personalized wishing website templates for birthdays, anniversaries, and special moments.",
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Top Wishing Website Templates",
        itemListElement: topTemplates.slice(0, 10).map((template, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: String(template?.webName || "").trim(),
          url: String(template?.webUrl || "").trim() || `${SITE_URL}/`,
        })),
      },
    ],
  });
}));

// category route
router.get("/category/:tag", wrapAsync(async (req, res) => {
  const { tag } = req.params;
  const normalizedTag = String(tag || "").trim();
  const normalizedTagTitle = toTitleCase(normalizedTag);
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
    title: `${normalizedTagTitle} Wishing Website Templates | VishLink`,
    description: `Explore personalized ${normalizedTag} wishing website templates for gifts and celebrations on VishLink.`,
    keywords: `${normalizedTag} wishing websites, ${normalizedTag} gift ideas, ${normalizedTag} templates, VishLink`,
    canonical: `${SITE_URL}/category/${encodedTag}`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${normalizedTagTitle} Wishing Website Templates`,
      url: `${SITE_URL}/category/${encodedTag}`,
      description: `Explore ${normalizedTag} wishing website templates on VishLink.`
    }
  });
}));

function buildFaqStructuredData(faqs = []) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function buildBreadcrumbStructuredData(urlPath, heading) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: heading,
        item: `${SITE_URL}${urlPath}`,
      },
    ],
  };
}

const SEO_LANDING_PATHS = Object.keys(SEO_LANDING_PAGES).map((slug) => `/${slug}`);

router.get(SEO_LANDING_PATHS,
  wrapAsync(async (req, res) => {
    const seoSlug = String(req.path || "").replace(/^\/+/, "").trim().toLowerCase();
    const pageData = SEO_LANDING_PAGES[seoSlug];
    if (!pageData) {
      return res.redirect("/");
    }

    const canonicalPath = `/${seoSlug}`;
    const pageUrl = `${SITE_URL}${canonicalPath}`;

    return res.render("pages/seoLanding", {
      pageData,
      keywords: pageData.keywords,
      title: pageData.title,
      description: pageData.description,
      canonical: pageUrl,
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: pageData.title,
          description: pageData.description,
          url: pageUrl,
          inLanguage: "en-IN",
        },
        buildFaqStructuredData(pageData.faqs),
        buildBreadcrumbStructuredData(canonicalPath, pageData.heading),
      ],
    });
  })
);

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
    disableDesignCss: true,
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
    photoFrameDownloadCredits: PHOTO_FRAME_DOWNLOAD_CREDITS,
    disableDesignCss: true,
    title: `${selectedTemplate.name} - Photo Frame Studio | VishLink`,
    description: `Customize ${selectedTemplate.name} with your photos and text, then download instantly.`,
    canonical: `${SITE_URL}/photo-frames/${encodeURIComponent(selectedTemplateSlug)}`,
    robots: "index, follow",
  });
}));

router.post("/photo-frames/download/unlock", wrapAsync(async (req, res) => {
  const acceptHeader = String(req.get("accept") || "");
  const wantsJson = req.xhr || acceptHeader.includes("application/json");
  const requiredCredits = PHOTO_FRAME_DOWNLOAD_CREDITS;

  if (!req.user?._id) {
    const message = "Please login to download this photo frame.";
    if (wantsJson) {
      return res.status(401).json({
        ok: false,
        message,
        loginRequired: true,
      });
    }
    req.flash("error", message);
    return res.redirect("/logInForm");
  }

  const updatedUser = await user.findOneAndUpdate(
    {
      _id: req.user._id,
      winnerCount: { $gte: requiredCredits },
    },
    {
      $inc: { winnerCount: -requiredCredits },
    },
    {
      new: true,
      projection: { winnerCount: 1 },
    }
  );

  if (!updatedUser) {
    const message = `Insufficient credits. You need ${requiredCredits} credit${requiredCredits === 1 ? "" : "s"} to download this frame.`;
    if (wantsJson) {
      return res.status(400).json({
        ok: false,
        message,
        requiredCredits,
        currentCredits: Number(req.user?.winnerCount || 0),
      });
    }
    req.flash("error", message);
    return res.redirect(req.get("Referrer") || "/photo-frames");
  }

  req.user.winnerCount = Number(updatedUser.winnerCount || 0);

  if (wantsJson) {
    return res.json({
      ok: true,
      chargedCredits: requiredCredits,
      remainingCredits: Number(updatedUser.winnerCount || 0),
    });
  }

  req.flash("success", `${requiredCredits} credit${requiredCredits === 1 ? "" : "s"} used for frame download.`);
  return res.redirect(req.get("Referrer") || "/photo-frames");
}));

// Get signUp form
router.get("/signUpForm", wrapAsync(async (req, res) => {
  setNoStoreHeaders(res);
  if (req.user) {
    req.flash("success", "You are already logged in.");
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
  setNoStoreHeaders(res);
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
  setNoStoreHeaders(res);
  if (req.user) {
    req.flash("success", "You are already logged in.");
    return res.redirect("/");
  }

  res.render("logIn", {
    title: "Login - VishLink",
    description: "Login to VishLink to manage and share your personalized wishing websites.",
    canonical: `${SITE_URL}/logInForm`,
    robots: "noindex, nofollow"
  });
}));

router.post("/auth/google", wrapAsync(async (req, res) => {
  setNoStoreHeaders(res);
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
  setNoStoreHeaders(res);
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
  setNoStoreHeaders(res);
  clearAuthCookie(res);
  req.flash("success", "you are logged out");
  return res.redirect("/");
});

router.post("/profile/light-palette", isLoggedIn, wrapAsync(async (req, res) => {
  const palette = normalizeLightPalette(req.body?.palette);
  const acceptHeader = String(req.get("accept") || "");
  const wantsJson = req.xhr || acceptHeader.includes("application/json");

  if (!palette) {
    const message = "Invalid light theme palette.";
    if (wantsJson) {
      return res.status(400).json({
        ok: false,
        message,
      });
    }
    req.flash("error", message);
    return res.redirect("/profile");
  }

  const updatedUser = await user.findByIdAndUpdate(
    req.user._id,
    { $set: { lightPalette: palette } },
    {
      new: true,
      projection: { lightPalette: 1 },
    }
  );

  if (!updatedUser) {
    const message = "Unable to save light theme palette right now.";
    if (wantsJson) {
      return res.status(404).json({
        ok: false,
        message,
      });
    }
    req.flash("error", message);
    return res.redirect("/profile");
  }

  req.user.lightPalette = updatedUser.lightPalette;

  if (wantsJson) {
    return res.json({
      ok: true,
      palette: updatedUser.lightPalette,
    });
  }

  req.flash("success", "Light theme palette updated.");
  return res.redirect("/profile");
}));

// render profile page
router.get("/profile", isLoggedIn, wrapAsync(async (req, res) => {
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
}));

// render all creation page
router.get("/viewHistory", isLoggedIn, wrapAsync(async (req, res) => {
  const profileUser = await user
    .findById(req.user._id)
    .select("_id username email winnerCount lightPalette webCollection")
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
}));

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
