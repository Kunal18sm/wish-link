if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const methodOverride = require("method-override");
const path = require("path");
const { createWindowRateLimiter } = require("./utils/rateLimiter.js");
const { toOptimizedCloudinaryUrl } = require("./utils/cloudinaryUrl.js");
const {
  invalidateChatInboxCache,
} = require("./utils/runtimeCaches.js");
const {
  createAdminNotification,
} = require("./utils/adminNotifications.js");
const {
  getCreditDateKey,
  getDailyRewardCredits,
  getCreditWeekdayKey,
  DAILY_REWARD_BY_DAY,
} = require("./utils/creditUtils.js");
const {
  AUTH_COOKIE_NAME,
  extractTokenFromRequest,
  verifyAuthToken,
  clearAuthCookie,
  extractTokenFromCookieHeader,
} = require("./utils/jwtAuth.js");
const { flashMiddleware } = require("./utils/flash.js");

const routes = require("./routes/samples.js");
const webRoutes = require("./routes/website.js");
const adminRoutes = require("./routes/admin.js");
const feedbackRouted = require("./routes/feedback.js");
const gameRoutes = require("./routes/game.js");
const chatRoutes = require("./routes/chat.js");

const user = require("./models/user.js");
const Chat = require("./models/chat.js");
const getPermanentPurchasedWebModel = require("./models/permanentPurchasedWeb.js");
const getPermanentFrameTemplateModel = require("./models/permanentFrameTemplate.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8080;
const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const ASSET_VERSION = process.env.ASSET_VERSION || "20260329l";
const ENABLE_CLOUDINARY_IMAGE_PROXY = process.env.CLOUDINARY_IMAGE_PROXY !== "false";
const ENABLE_ANALYTICS = process.env.ENABLE_ANALYTICS === "true";
const MUTATING_REQUEST_WINDOW_MS = Number(process.env.MUTATING_REQUEST_WINDOW_MS || 10 * 60 * 1000);
const MUTATING_REQUEST_LIMIT = Number(process.env.MUTATING_REQUEST_LIMIT || 5);
const MUTATING_REQUEST_WINDOW_MINUTES = Math.max(1, Math.round(MUTATING_REQUEST_WINDOW_MS / (60 * 1000)));
const RATE_LIMIT_MESSAGE = `Rate limit exceeded: ${MUTATING_REQUEST_LIMIT} requests allowed every ${MUTATING_REQUEST_WINDOW_MINUTES} minutes.`;
const AUTH_USER_SELECT = "_id username email isAdmin winnerCount dailyCreditClaim lightPalette";
const SOCKET_USER_SELECT = "_id username email isAdmin";
const SESSION_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 5;
const MONGODB_CONNECT_OPTIONS = {
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
  serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
  maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_TIME_MS || 30000),
  heartbeatFrequencyMS: Number(process.env.MONGO_HEARTBEAT_FREQUENCY_MS || 10000),
  autoIndex: process.env.NODE_ENV !== "production",
};
const RUN_CHAT_MESSAGE_CLEANUP = process.env.RUN_CHAT_CREATED_AT_CLEANUP === "true";
let permanentDbConnection = null;
const socketChatRateStore = new Map();

function getFirstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function resolvePermanentMongoUrl() {
  return getFirstEnv(
    "PERMANENT_MONGODB_URL",
    "PERMANENT_MONGO_URL",
    "PERMANENT_DB_URL",
    "SECONDARY_MONGODB_URL",
    "SECONDARY_MONGO_URL",
    "MongoDB_URL"
  );
}

function resolveSessionMongoUrl() {
  return getFirstEnv(
    "SESSION_MONGODB_URL",
    "SESSION_MONGO_URL",
    "MongoDB_URL"
  );
}

function shouldSkipGlobalRateLimit(req) {
  const requestPath = String(req.path || "");
  if (requestPath === "/credits/claim-daily") return true;
  if (requestPath.startsWith("/web/template/") && requestPath.endsWith("/preview/unlock")) return true;
  if (requestPath === "/photo-frames/download/unlock") return true;
  return false;
}

function wantsJsonResponse(req) {
  const acceptHeader = String(req.get("accept") || "");
  return req.xhr || acceptHeader.includes("application/json");
}

function normalizeUpstreamFailureStatus(statusCode) {
  const numericStatus = Number(statusCode);
  if (!Number.isInteger(numericStatus) || numericStatus < 400 || numericStatus > 599) {
    return 502;
  }

  if (numericStatus >= 500) return 502;
  return numericStatus;
}

function isServiceUnavailableError(err) {
  const statusCode = Number(err?.statusCode);
  if (statusCode === 503) return true;

  const errorName = String(err?.name || "");
  if (
    errorName === "MongooseServerSelectionError" ||
    errorName === "MongoServerSelectionError" ||
    errorName === "MongoNetworkError" ||
    errorName === "MongoTopologyClosedError"
  ) {
    return true;
  }

  const normalizedMessage = String(err?.message || "").toLowerCase();
  return (
    normalizedMessage.includes("server selection timed out") ||
    normalizedMessage.includes("failed to connect to server") ||
    normalizedMessage.includes("topology is closed") ||
    normalizedMessage.includes("econnrefused")
  );
}

function toErrorResponseMessage(err, statusCode) {
  if (statusCode === 503) {
    return "Service is temporarily unavailable. Please try again in a moment.";
  }

  if (statusCode >= 500) {
    return "Something went wrong on our side. Please try again.";
  }

  return String(err?.message || "Something went wrong.");
}

function appendVaryHeader(res, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) return;

  const existingHeader = String(res.getHeader("Vary") || "");
  const existingValues = existingHeader
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const alreadyExists = existingValues.some(
    (item) => item.toLowerCase() === normalizedValue.toLowerCase()
  );

  if (alreadyExists) return;

  const updatedValues = existingValues.concat(normalizedValue);
  res.setHeader("Vary", updatedValues.join(", "));
}

app.locals.permanentPurchasedWeb = null;
app.locals.permanentFrameTemplate = null;
function getResponsiveWidth(variant) {
  const normalizedVariant = String(variant || "default").toLowerCase();
  if (normalizedVariant === "avatar") return 220;
  if (normalizedVariant === "payment") return 1200;
  if (normalizedVariant === "banner") return 840;
  if (normalizedVariant === "card") return 640;
  return 640;
}

function buildCloudinaryTransforms(variant, width) {
  const finalWidth = Number(width) > 0 ? Number(width) : getResponsiveWidth(variant);

  return ["f_auto", "q_auto:eco", "c_limit", `w_${finalWidth}`];
}

function getResponsiveSrcWidths(variant) {
  const normalizedVariant = String(variant || "default").toLowerCase();
  if (normalizedVariant === "avatar") return [96, 160, 220];
  if (normalizedVariant === "payment") return [480, 768, 1024, 1200];
  if (normalizedVariant === "banner") return [320, 480, 640, 840];
  return [200, 320, 480, 640];
}

function isCloudinaryImageUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return false;

  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "https:" && parsedUrl.hostname === "res.cloudinary.com";
  } catch (_err) {
    return false;
  }
}

function toSameOriginImageUrl(url) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) return rawUrl;
  if (!ENABLE_CLOUDINARY_IMAGE_PROXY) return rawUrl;
  if (!isCloudinaryImageUrl(rawUrl)) return rawUrl;

  return `/cdn/image?u=${encodeURIComponent(rawUrl)}`;
}

app.locals.getOptimizedCloudinaryUrl = (url, variant = "default", width) => {
  const optimizedUrl = toOptimizedCloudinaryUrl(url, buildCloudinaryTransforms(variant, width));
  return toSameOriginImageUrl(optimizedUrl);
};

app.locals.getResponsiveCloudinarySrcSet = (url, variant = "default") =>
  getResponsiveSrcWidths(variant)
    .map((width) => `${app.locals.getOptimizedCloudinaryUrl(url, variant, width)} ${width}w`)
    .join(", ");

function getPurchaseErrorMessage(err) {
  const rawMessage = String(err?.message || "");
  const normalizedMessage = rawMessage.toLowerCase();

  if (err?.code === "LIMIT_UNEXPECTED_FILE") {
    if (err.field === "images") return "Please upload up to 5 images only.";
    if (err.field === "paymentImage") return "Please upload only one payment screenshot.";
    return "Some uploaded files are invalid. Please recheck and try again.";
  }

  if (normalizedMessage.includes("file too large")) {
    return "Uploaded file is too large. Please choose a smaller image.";
  }

  if (
    normalizedMessage.includes("invalid file type") ||
    normalizedMessage.includes("unsupported format")
  ) {
    return "Only JPG, JPEG, PNG, and WEBP images are allowed.";
  }

  if (normalizedMessage.includes("selected website template not found")) {
    return "Template not found. Please open the form again.";
  }

  return "Purchase failed. Please recheck details and try again.";
}

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("io", io);
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(methodOverride("_method"));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

const staticAssetCacheControl = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg", ".gif", ".mp3", ".woff", ".woff2"].includes(ext)) {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    return;
  }

  if ([".css", ".js", ".mjs", ".json", ".webmanifest"].includes(ext)) {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
};

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true,
    setHeaders: staticAssetCacheControl,
  })
);

// Lightweight health endpoint for uptime checks.
app.get("/ping", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).type("text/plain").send("OK");
});

app.get("/cdn/image", async (req, res) => {
  if (!ENABLE_CLOUDINARY_IMAGE_PROXY) {
    return res.status(404).send("Image proxy is disabled.");
  }

  const targetUrl = String(req.query?.u || "").trim();
  if (!isCloudinaryImageUrl(targetUrl)) {
    return res.status(400).send("Invalid image url.");
  }

  const abortController = new AbortController();
  const timeoutRef = setTimeout(() => abortController.abort(), 10 * 1000);

  try {
    const acceptHeader = String(req.get("accept") || "*/*");
    const remoteResponse = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: abortController.signal,
      headers: {
        Accept: acceptHeader,
      },
    });

    if (!remoteResponse.ok) {
      return res
        .status(normalizeUpstreamFailureStatus(remoteResponse.status))
        .send("Image not available.");
    }

    const contentType = String(remoteResponse.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return res.status(415).send("Unsupported asset type.");
    }

    const eTagHeader = remoteResponse.headers.get("etag");
    const lastModifiedHeader = remoteResponse.headers.get("last-modified");
    const cacheControlHeader = remoteResponse.headers.get("cache-control");

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Cache-Control",
      cacheControlHeader || "public, max-age=2592000, stale-while-revalidate=86400"
    );

    if (eTagHeader) res.setHeader("ETag", eTagHeader);
    if (lastModifiedHeader) res.setHeader("Last-Modified", lastModifiedHeader);

    const imageBuffer = Buffer.from(await remoteResponse.arrayBuffer());
    return res.send(imageBuffer);
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).send("Image request timed out.");
    }
    return res.status(502).send("Unable to fetch remote image.");
  } finally {
    clearTimeout(timeoutRef);
  }
});

app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.locals.primaryDbReady = false;

const connectDb = async () => {
  const primaryMongoUrl = String(process.env.MongoDB_URL || "").trim();
  const permanentMongoUrl = resolvePermanentMongoUrl();

  try {
    if (!primaryMongoUrl) {
      throw new Error("MongoDB_URL is not configured.");
    }

    await mongoose.connect(primaryMongoUrl, MONGODB_CONNECT_OPTIONS);
    app.locals.primaryDbReady = true;

    // One-time optional migration cleanup (kept behind env flag to speed cold starts).
    if (RUN_CHAT_MESSAGE_CLEANUP) {
      await Chat.updateMany(
        { "messages.createdAt": { $exists: true } },
        { $unset: { "messages.$[].createdAt": "" } }
      );
      console.log("Chat message timestamp cleanup completed.");
    }

    console.log("DataBase Connected");
  } catch (err) {
    app.locals.primaryDbReady = false;
    console.log("Primary DB connection failed:", err.message);
  }

  try {
    if (!permanentMongoUrl) {
      console.log("PERMANENT_MONGODB_URL not configured. Permanent requests are disabled.");
      return;
    }

    if (permanentMongoUrl === primaryMongoUrl) {
      permanentDbConnection = mongoose.connection;
      console.log("Permanent DataBase Connected (shared primary connection)");
    } else {
      permanentDbConnection = mongoose.createConnection(
        permanentMongoUrl,
        MONGODB_CONNECT_OPTIONS
      );
      await permanentDbConnection.asPromise();
      console.log("Permanent DataBase Connected");
    }

    app.locals.permanentPurchasedWeb = getPermanentPurchasedWebModel(permanentDbConnection);
    app.locals.permanentFrameTemplate = getPermanentFrameTemplateModel(permanentDbConnection);
  } catch (err) {
    app.locals.permanentPurchasedWeb = null;
    app.locals.permanentFrameTemplate = null;
    console.log("Permanent DB connection failed:", err.message);
  }
};

mongoose.connection.on("connected", () => {
  app.locals.primaryDbReady = true;
});

mongoose.connection.on("disconnected", () => {
  app.locals.primaryDbReady = false;
  console.log("Primary DB disconnected.");
});

mongoose.connection.on("error", (err) => {
  app.locals.primaryDbReady = false;
  console.log("Primary DB runtime error:", err.message);
});

const sessionOptions = {
  secret: String(process.env.SESSION_SECRET || "").trim() || `wishlo-dev-session-${process.pid}`,
  proxy: process.env.NODE_ENV === "production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

const sessionMongoUrl = resolveSessionMongoUrl();
let sessionStore = null;

if (sessionMongoUrl) {
  try {
    sessionStore = MongoStore.create({
      mongoUrl: sessionMongoUrl,
      collectionName: "sessions",
      ttl: Math.floor(SESSION_COOKIE_MAX_AGE_MS / 1000),
      autoRemove: "native",
      stringify: false,
    });

    sessionStore.on("error", (err) => {
      console.log("Session store runtime error:", err.message);
    });
  } catch (err) {
    console.log("Session store setup failed. Falling back to MemoryStore:", err.message);
  }
} else {
  console.log("SESSION_MONGODB_URL is not configured. Falling back to MemoryStore.");
}

if (sessionStore) {
  sessionOptions.store = sessionStore;
}

if (!process.env.SESSION_SECRET) {
  console.log("SESSION_SECRET is not configured. Using a temporary in-memory secret.");
}

const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
app.use(flashMiddleware);

app.use(async (req, res, next) => {
  const token = extractTokenFromRequest(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const payload = verifyAuthToken(token);
    if (!payload?.sub) {
      req.user = null;
      clearAuthCookie(res);
      return next();
    }

    const loggedInUser = await user.findById(payload.sub).select(AUTH_USER_SELECT).lean();
    if (!loggedInUser) {
      req.user = null;
      clearAuthCookie(res);
      return next();
    }

    req.user = loggedInUser;
    return next();
  } catch (_err) {
    req.user = null;
    clearAuthCookie(res);
    return next();
  }
});

const mutatingRequestLimiter = createWindowRateLimiter({
  windowMs: MUTATING_REQUEST_WINDOW_MS,
  max: MUTATING_REQUEST_LIMIT,
  keyGenerator: (req) => {
    if (req.user?._id) return `user:${req.user._id}`;
    return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
  },
  skip: (req) =>
    req.user?.isAdmin ||
    shouldSkipGlobalRateLimit(req) ||
    !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  onLimitReached: (req, res, entry) => {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    const acceptHeader = String(req.get("accept") || "");
    const wantsJson = req.xhr || acceptHeader.includes("application/json");
    if (wantsJson) {
      return res.status(429).json({
        ok: false,
        message: RATE_LIMIT_MESSAGE,
      });
    }

    req.flash("error", RATE_LIMIT_MESSAGE);
    return res.status(429).redirect(req.get("Referrer") || "/");
  },
});

app.use(mutatingRequestLimiter);

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of socketChatRateStore.entries()) {
    if (!entry || entry.resetAt <= now) {
      socketChatRateStore.delete(key);
    }
  }
}, Math.max(MUTATING_REQUEST_WINDOW_MS, 60 * 1000)).unref();

app.use(async (req, res, next) => {
  const todayCreditDateKey = getCreditDateKey();
  const hasClaimedDailyCredit =
    String(req.user?.dailyCreditClaim?.dateKey || "") === todayCreditDateKey;
  const adminUnreadNotificationCount = 0;

  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  res.locals.userLightPalette = req.user?.lightPalette === "pink" ? "pink" : "blue";
  res.locals.adminUnreadNotificationCount = Number(adminUnreadNotificationCount || 0);
  res.locals.userCredits = Number(req.user?.winnerCount || 0);
  res.locals.hideFooter = false;
  res.locals.chatLayout = false;
  res.locals.showInstallPrompt = req.path === "/";
  res.locals.todayCreditDateKey = todayCreditDateKey;
  res.locals.dailyRewardByDay = DAILY_REWARD_BY_DAY;
  res.locals.dailyCreditReward =
    req.user && !req.user.isAdmin && !hasClaimedDailyCredit
      ? {
          credits: getDailyRewardCredits(),
          todayKey: getCreditWeekdayKey(),
        }
      : null;
  res.locals.googleClientId = GOOGLE_CLIENT_ID;
  res.locals.enableAnalytics = ENABLE_ANALYTICS;
  res.locals.designCssVariant = "full";
  res.locals.disableDesignCss = false;
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.getOptimizedCloudinaryUrl = app.locals.getOptimizedCloudinaryUrl;
  res.locals.getResponsiveCloudinarySrcSet = app.locals.getResponsiveCloudinarySrcSet;
  return next();
});

app.use((req, res, next) => {
  const rawPath = req.originalUrl.split("?")[0] || "/";
  const canonicalUrl = new URL(rawPath, SITE_URL);
  canonicalUrl.search = "";
  canonicalUrl.hash = "";

  let normalizedCanonical = canonicalUrl.toString();
  if (normalizedCanonical.length > SITE_URL.length + 1 && normalizedCanonical.endsWith("/")) {
    normalizedCanonical = normalizedCanonical.slice(0, -1);
  }

  res.locals.siteUrl = SITE_URL;
  res.locals.siteName = "VishLink";
  res.locals.locale = "en_IN";
  res.locals.title = "VishLink - Create Personalized Wishing Websites";
  res.locals.description =
    "Create beautiful personalized birthday, anniversary and love wishing websites using VishLink.";
  res.locals.canonical = normalizedCanonical;
  res.locals.robots = "index, follow";
  res.locals.ogTitle = res.locals.title;
  res.locals.ogDescription = res.locals.description;
  res.locals.ogImage = `${SITE_URL}/og-image.png`;
  res.locals.ogUrl = res.locals.canonical;
  res.locals.ogType = "website";
  res.locals.twitterCard = "summary_large_image";
  next();
});

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }

  // Keep cache keys separate for guest vs authenticated requests.
  appendVaryHeader(res, "Cookie");

  const hasAuthCookie = Boolean(req.cookies?.[AUTH_COOKIE_NAME]);
  const hasFlashMessages =
    (Array.isArray(res.locals.success) && res.locals.success.length > 0) ||
    (Array.isArray(res.locals.error) && res.locals.error.length > 0);
  const requestPath = String(req.path || "");
  const shouldDisablePublicCache =
    requestPath === "/logInForm" || requestPath === "/signUpForm" || hasFlashMessages;

  if (req.user || hasAuthCookie || shouldDisablePublicCache) {
    res.setHeader("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
    return next();
  }

  const seoLandingPaths = new Set([
    "/birthday-gift-website",
    "/anniversary-gift-website",
    "/online-wishing-website-maker",
    "/digital-gift-ideas",
  ]);
  const isPublicCacheablePath =
    requestPath === "/" ||
    requestPath === "/about" ||
    requestPath === "/contact" ||
    requestPath === "/terms" ||
    requestPath === "/privacy-policy" ||
    seoLandingPaths.has(requestPath) ||
    requestPath.startsWith("/category/");

  if (isPublicCacheablePath) {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  } else {
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
  }

  return next();
});

app.use("/", routes);
app.use("/requests", adminRoutes);
app.use("/web", webRoutes);
app.use("/feedback", feedbackRouted);
app.use("/game", gameRoutes);
app.use("/chat", chatRoutes);

app.use((req, res) => {
  res.status(404).render("404", {
    title: "Page Not Found - VishLink",
    description: "The page you are looking for does not exist.",
    canonical: `${SITE_URL}/404`,
    robots: "noindex, nofollow",
  });
});

app.use((err, req, res, _next) => {
  const requestedStatus = Number(err?.statusCode);
  const normalizedRequestedStatus =
    Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;
  const statusCode = isServiceUnavailableError(err) ? 503 : normalizedRequestedStatus;
  const responseMessage = toErrorResponseMessage(err, statusCode);
  const redirectBack = req.get("Referrer") || "/";

  console.log("Unhandled error:", {
    name: err?.name || "Error",
    statusCode,
    message: err?.message || "Unknown error",
    path: req.originalUrl,
  });

  if (req.originalUrl.startsWith("/web/purchase/")) {
    req.flash("error", getPurchaseErrorMessage(err));
    return res.redirect(redirectBack);
  }

  if (wantsJsonResponse(req)) {
    return res.status(statusCode).json({
      ok: false,
      message: responseMessage,
    });
  }

  return res.status(statusCode).send(responseMessage);
});

function normalizeChatMessage(rawMessage) {
  if (typeof rawMessage !== "string") return "";
  return rawMessage.trim().slice(0, 1500);
}

function getSocketRateState(userId) {
  const key = String(userId || "anonymous");
  const now = Date.now();
  let entry = socketChatRateStore.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + MUTATING_REQUEST_WINDOW_MS };
  }

  entry.count += 1;
  socketChatRateStore.set(key, entry);
  return entry;
}

function hasChatAccess(currentUser, chatDoc) {
  if (!currentUser || !chatDoc) return false;
  if (currentUser.isAdmin) return true;
  return String(chatDoc.user) === String(currentUser._id);
}

io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.request?.headers?.cookie || "";
    const token = extractTokenFromCookieHeader(cookieHeader);
    if (!token) return next(new Error("Unauthorized"));

    const payload = verifyAuthToken(token);
    if (!payload?.sub) return next(new Error("Unauthorized"));

    const currentUser = await user.findById(payload.sub).select(SOCKET_USER_SELECT).lean();
    if (!currentUser) return next(new Error("Unauthorized"));

    socket.user = currentUser;
    return next();
  } catch (_err) {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  if (socket.user?.isAdmin) {
    socket.join("admins");
  }

  socket.on("joinChat", async (payload = {}, cb) => {
    try {
      const chatId = payload.chatId;
      if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        if (typeof cb === "function") cb({ ok: false, error: "Invalid chat id." });
        return;
      }

      const chat = await Chat.findById(chatId).select("user").lean();
      if (!chat || !hasChatAccess(socket.user, chat)) {
        if (typeof cb === "function") cb({ ok: false, error: "Access denied." });
        return;
      }

      socket.join(`chat:${chat._id}`);
      if (typeof cb === "function") cb({ ok: true, chatId: String(chat._id) });
    } catch (_err) {
      if (typeof cb === "function") cb({ ok: false, error: "Failed to join chat." });
    }
  });

  socket.on("sendChatMessage", async (payload = {}, cb) => {
    try {
      const socketRateState = socket.user?.isAdmin ? null : getSocketRateState(socket.user?._id);
      if (socketRateState && socketRateState.count > MUTATING_REQUEST_LIMIT) {
        if (typeof cb === "function") {
          cb({
            ok: false,
            error: RATE_LIMIT_MESSAGE,
          });
        }
        return;
      }

      const messageText = normalizeChatMessage(payload.text);
      if (!messageText) {
        if (typeof cb === "function") cb({ ok: false, error: "Message cannot be empty." });
        return;
      }

      const senderRole = socket.user.isAdmin ? "admin" : "user";
      let chat = null;
      const payloadChatId = payload.chatId;

      if (payloadChatId && mongoose.Types.ObjectId.isValid(payloadChatId)) {
        chat = await Chat.findById(payloadChatId);
      }

      if (!chat && !socket.user.isAdmin) {
        chat = await Chat.findOne({ user: socket.user._id });
      }

      if (!chat && !socket.user.isAdmin) {
        chat = new Chat({ user: socket.user._id, messages: [] });
      }

      if (!chat) {
        if (typeof cb === "function") cb({ ok: false, error: "Chat not found." });
        return;
      }

      if (!hasChatAccess(socket.user, chat)) {
        if (typeof cb === "function") cb({ ok: false, error: "Access denied." });
        return;
      }

      chat.messages.push({
        sender: socket.user._id,
        senderRole,
        text: messageText,
      });

      chat.lastMessage = messageText;
      chat.lastMessageAt = new Date();

      if (senderRole === "admin") {
        chat.userUnreadCount += 1;
      } else {
        chat.adminUnreadCount += 1;
      }

      await chat.save();
      invalidateChatInboxCache();

      const latestMessage = chat.messages[chat.messages.length - 1];
      const room = `chat:${chat._id}`;
      socket.join(room);
      const chatOwner =
        senderRole === "admin"
          ? await user.findById(chat.user).select("username email").lean()
          : socket.user;

      io.to(room).emit("newChatMessage", {
        chatId: String(chat._id),
        message: {
          _id: String(latestMessage._id),
          text: latestMessage.text,
          senderRole: latestMessage.senderRole,
          senderName: socket.user.username,
        },
      });

      io.to("admins").emit("chatThreadUpdated", {
        chatId: String(chat._id),
        userName: chatOwner?.username || "Unknown User",
        userEmail: chatOwner?.email || "No email",
        lastMessage: chat.lastMessage || "",
        lastMessageAt: chat.lastMessageAt,
        adminUnreadCount: chat.adminUnreadCount || 0,
      });

      if (senderRole !== "admin") {
        createAdminNotification(
          app,
          {
            type: "chat_message",
            title: "New Chat Message",
            message: `${socket.user?.username || "A user"} sent: ${messageText}`,
            link: `/chat/admin/${chat._id}`,
            entityType: "chat",
            entityId: String(chat._id),
            dedupeKey: `chat:${chat._id}`,
            actor: socket.user,
            meta: {
              chatId: String(chat._id),
            },
          },
          {
            upsertUnreadByDedupeKey: true,
          }
        ).catch((notifyErr) => {
          console.log("Admin chat notification warning:", notifyErr?.message || notifyErr);
        });
      }

      if (typeof cb === "function") cb({ ok: true, chatId: String(chat._id) });
    } catch (_err) {
      if (typeof cb === "function") cb({ ok: false, error: "Failed to send message." });
    }
  });
});

process.on("unhandledRejection", (reason) => {
  console.log("Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.log("Uncaught Exception:", error);
});

server.listen(PORT, async () => {
  console.log(`Listening on port ${PORT}`);
  connectDb();
});
