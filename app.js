if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const { Server } = require("socket.io");
const methodOverride = require("method-override");
const path = require("path");

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
let permanentDbConnection = null;

app.locals.permanentPurchasedWeb = null;

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
    return "Only JPG, JPEG, and PNG images are allowed.";
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

app.use(methodOverride("_method"));
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

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
  saveUninitialized: true,
  cookie: {
    expires: Date.now() + 1000 * 60 * 60 * 5 * 24,
    maxAge: 1000 * 60 * 60 * 5 * 24, // 5 days
    httpOnly: true,
  },
};

const sessionMiddleware = session(sessionOptions);
app.use(sessionMiddleware);
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(user.authenticate()));
passport.serializeUser(user.serializeUser());
passport.deserializeUser(user.deserializeUser());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  res.locals.hideFooter = false;
  res.locals.chatLayout = false;
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

function hasChatAccess(currentUser, chatDoc) {
  if (!currentUser || !chatDoc) return false;
  if (currentUser.isAdmin) return true;
  return String(chatDoc.user) === String(currentUser._id);
}

io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

io.use((socket, next) => {
  const currentUser = socket.request.user;
  if (!currentUser) {
    return next(new Error("Unauthorized"));
  }

  socket.user = currentUser;
  next();
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
