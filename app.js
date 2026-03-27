if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const flash = require("connect-flash");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const methodOverride = require("method-override");
const path = require("path");
const { createWindowRateLimiter } = require("./utils/rateLimiter.js");
const { toOptimizedCloudinaryUrl } = require("./utils/cloudinaryUrl.js");
const {
  getCreditDateKey,
  getDailyRewardCredits,
  getCreditWeekdayKey,
  DAILY_REWARD_BY_DAY,
} = require("./utils/creditUtils.js");
const {
  extractTokenFromRequest,
  verifyAuthToken,
  clearAuthCookie,
  extractTokenFromCookieHeader,
} = require("./utils/jwtAuth.js");

const routes = require("./routes/samples.js");
const webRoutes = require("./routes/website.js");
const adminRoutes = require("./routes/admin.js");
const feedbackRouted = require("./routes/feedback.js");
const gameRoutes = require("./routes/game.js");
const chatRoutes = require("./routes/chat.js");

const user = require("./models/user.js");
const Chat = require("./models/chat.js");
const getPermanentPurchasedWebModel = require("./models/permanentPurchasedWeb.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8080;
const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const ASSET_VERSION = process.env.ASSET_VERSION || "20260327a";
const MUTATING_REQUEST_WINDOW_MS = Number(process.env.MUTATING_REQUEST_WINDOW_MS || 10 * 60 * 1000);
const MUTATING_REQUEST_LIMIT = Number(process.env.MUTATING_REQUEST_LIMIT || 5);
const MUTATING_REQUEST_WINDOW_MINUTES = Math.max(1, Math.round(MUTATING_REQUEST_WINDOW_MS / (60 * 1000)));
const RATE_LIMIT_MESSAGE = `Rate limit exceeded: ${MUTATING_REQUEST_LIMIT} requests allowed every ${MUTATING_REQUEST_WINDOW_MINUTES} minutes.`;
let permanentDbConnection = null;
const socketChatRateStore = new Map();

function shouldSkipGlobalRateLimit(req) {
  const requestPath = String(req.path || "");
  if (requestPath === "/credits/claim-daily") return true;
  if (requestPath.startsWith("/web/template/") && requestPath.endsWith("/preview/unlock")) return true;
  return false;
}

app.locals.permanentPurchasedWeb = null;
function getResponsiveWidth(variant) {
  const normalizedVariant = String(variant || "default").toLowerCase();
  if (normalizedVariant === "avatar") return 220;
  if (normalizedVariant === "payment") return 1200;
  return 1200;
}

function buildCloudinaryTransforms(variant, width) {
  const normalizedVariant = String(variant || "default").toLowerCase();
  const finalWidth = Number(width) > 0 ? Number(width) : getResponsiveWidth(normalizedVariant);

  if (normalizedVariant === "avatar") {
    return ["f_auto", "q_80", "c_limit", `w_${finalWidth}`, "dpr_auto"];
  }

  return ["f_auto", "q_80", "c_limit", `w_${finalWidth}`, "dpr_auto"];
}

app.locals.getOptimizedCloudinaryUrl = (url, variant = "default", width) =>
  toOptimizedCloudinaryUrl(url, buildCloudinaryTransforms(variant, width));

app.locals.getResponsiveCloudinarySrcSet = (url, variant = "default") =>
  [480, 768, 1200]
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
  next();
});

const staticAssetCacheControl = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg", ".gif", ".mp3", ".woff", ".woff2"].includes(ext)) {
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    return;
  }

  if ([".css", ".js", ".mjs", ".json", ".webmanifest"].includes(ext)) {
    res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
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
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MongoDB_URL);

    // Cleanup old per-message timestamps to keep chat payload minimal.
    await Chat.updateMany(
      { "messages.createdAt": { $exists: true } },
      { $unset: { "messages.$[].createdAt": "" } }
    );

    console.log("DataBase Connected");
  } catch (err) {
    console.log(err);
  }

  try {
    if (!process.env.PERMANENT_MONGODB_URL) {
      console.log("PERMANENT_MONGODB_URL not configured. Permanent requests are disabled.");
      return;
    }

    permanentDbConnection = mongoose.createConnection(process.env.PERMANENT_MONGODB_URL);
    await permanentDbConnection.asPromise();

    app.locals.permanentPurchasedWeb = getPermanentPurchasedWebModel(permanentDbConnection);
    console.log("Permanent DataBase Connected");
  } catch (err) {
    app.locals.permanentPurchasedWeb = null;
    console.log("Permanent DB connection failed:", err.message);
  }
};

const sessionOptions = {
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    expires: Date.now() + 1000 * 60 * 60 * 5 * 24,
    maxAge: 1000 * 60 * 60 * 5 * 24, // 5 days
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
app.use(flash());

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

    const loggedInUser = await user.findById(payload.sub);
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

app.use((req, res, next) => {
  const todayCreditDateKey = getCreditDateKey();
  const hasClaimedDailyCredit =
    String(req.user?.dailyCreditClaim?.dateKey || "") === todayCreditDateKey;

  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
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
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.getOptimizedCloudinaryUrl = app.locals.getOptimizedCloudinaryUrl;
  res.locals.getResponsiveCloudinarySrcSet = app.locals.getResponsiveCloudinarySrcSet;
  next();
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
  const statusCode = err.statusCode || 500;
  const message = err.message || "Something went wrong.";
  const redirectBack = req.get("Referrer") || "/";

  console.log("Unhandled error:", err.message);

  if (req.originalUrl.startsWith("/web/purchase/")) {
    req.flash("error", getPurchaseErrorMessage(err));
    return res.redirect(redirectBack);
  }

  return res.status(statusCode).send(message);
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

    const currentUser = await user.findById(payload.sub);
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

      const chat = await Chat.findById(chatId);
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
      await chat.populate("user", "username email");

      const latestMessage = chat.messages[chat.messages.length - 1];
      const room = `chat:${chat._id}`;
      socket.join(room);

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
        userName: chat.user?.username || "Unknown User",
        userEmail: chat.user?.email || "No email",
        lastMessage: chat.lastMessage || "",
        lastMessageAt: chat.lastMessageAt,
        adminUnreadCount: chat.adminUnreadCount || 0,
      });

      if (typeof cb === "function") cb({ ok: true, chatId: String(chat._id) });
    } catch (_err) {
      if (typeof cb === "function") cb({ ok: false, error: "Failed to send message." });
    }
  });
});

server.listen(PORT, async () => {
  console.log(`Listning to port ${PORT}`);
  connectDb();
});
