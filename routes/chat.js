const express = require("express");
const mongoose = require("mongoose");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const Chat = require("../models/chat.js");
const user = require("../models/user.js");
const {
  createAdminNotification,
  markAdminNotificationsAsRead,
} = require("../utils/adminNotifications.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const {
  cache,
  getChatInboxCacheKey,
  invalidateChatInboxCache,
} = require("../utils/runtimeCaches.js");

const MAX_MESSAGE_LENGTH = 1500;
const CHAT_INBOX_SELECT = "user lastMessage lastMessageAt adminUnreadCount";

function parseMessage(req) {
  const raw = req.body?.chat?.message ?? req.body?.message ?? "";
  if (typeof raw !== "string") return "";
  return raw.trim();
}

function wantsJson(req) {
  const accept = req.headers?.accept || "";
  return req.xhr || accept.includes("application/json");
}

function canAccessChat(currentUser, chat) {
  if (!currentUser || !chat) return false;
  if (currentUser.isAdmin) return true;
  return String(chat.user) === String(currentUser._id);
}

function parseAfterMessageId(raw) {
  if (!raw || typeof raw !== "string") return null;
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return String(raw);
}

function isAfterMessageId(messageId, cursorId) {
  if (!messageId || !cursorId) return false;
  return String(messageId) > String(cursorId);
}

function serializeMessage(messageDoc) {
  return {
    _id: String(messageDoc._id),
    text: messageDoc.text,
    senderRole: messageDoc.senderRole,
  };
}

async function loadAdminInboxChats() {
  return cache.getOrSet(getChatInboxCacheKey(), async () => {
    return Chat.find({})
      .select(CHAT_INBOX_SELECT)
      .populate({
        path: "user",
        select: "username email",
        options: { lean: true },
      })
      .sort({ lastMessageAt: -1 })
      .lean();
  }, 5 * 1000);
}

// User chat with admin
router.get(
  "/",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    if (req.user.isAdmin) {
      return res.redirect("/chat/admin");
    }

    await Chat.updateOne(
      { user: req.user._id, userUnreadCount: { $gt: 0 } },
      { $set: { userUnreadCount: 0 } }
    );

    const chat = await Chat.findOne({ user: req.user._id })
      .select("user messages lastMessageAt")
      .lean();

    res.render("chat/userChat", {
      chat,
      title: "Chat With Admin - VishLink",
      description: "Talk directly with VishLink admin.",
      canonical: "https://wishlink-7j0a.onrender.com/chat",
      robots: "noindex, nofollow",
      hideFooter: true,
      chatLayout: true,
    });
  })
);

router.post(
  "/message",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    if (req.user.isAdmin) {
      req.flash("error", "Admins should use the admin chat panel.");
      return res.redirect("/chat/admin");
    }

    const message = parseMessage(req);
    if (!message) {
      req.flash("error", "Message cannot be empty.");
      return res.redirect("/chat");
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      req.flash("error", `Message is too long. Max ${MAX_MESSAGE_LENGTH} characters.`);
      return res.redirect("/chat");
    }

    let chat = await Chat.findOne({ user: req.user._id });
    if (!chat) {
      chat = new Chat({ user: req.user._id, messages: [] });
    }

    chat.messages.push({
      sender: req.user._id,
      senderRole: "user",
      text: message,
    });
    chat.lastMessage = message;
    chat.lastMessageAt = new Date();
    chat.adminUnreadCount += 1;

    await chat.save();
    invalidateChatInboxCache();
    const latestMessage = chat.messages[chat.messages.length - 1];

    try {
      await createAdminNotification(
        req.app,
        {
          type: "chat_message",
          title: "New Chat Message",
          message: `${req.user?.username || "A user"} sent: ${message}`,
          link: `/chat/admin/${chat._id}`,
          entityType: "chat",
          entityId: String(chat._id),
          dedupeKey: `chat:${chat._id}`,
          actor: req.user,
          meta: {
            chatId: String(chat._id),
          },
        },
        {
          upsertUnreadByDedupeKey: true,
        }
      );
    } catch (notifyErr) {
      console.log("Admin chat notification warning:", notifyErr?.message || notifyErr);
    }

    const io = req.app.get("io");
    if (io) {
      const chatId = String(chat._id);

      io.to(`chat:${chatId}`).emit("newChatMessage", {
        chatId,
        message: {
          _id: String(latestMessage._id),
          text: latestMessage.text,
          senderRole: latestMessage.senderRole,
          senderName: req.user.username,
        },
      });

      io.to("admins").emit("chatThreadUpdated", {
        chatId,
        userName: req.user.username || "Unknown User",
        userEmail: req.user.email || "No email",
        lastMessage: chat.lastMessage || "",
        lastMessageAt: chat.lastMessageAt,
        adminUnreadCount: chat.adminUnreadCount || 0,
      });
    }

    if (wantsJson(req)) {
      return res.json({
        ok: true,
        chatId: String(chat._id),
        message: serializeMessage(latestMessage),
      });
    }

    req.flash("success", "Message sent to admin.");
    res.redirect("/chat");
  })
);

// Admin inbox (all users chat requests)
router.get(
  "/admin",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const chats = await loadAdminInboxChats();

    res.render("chat/adminInbox", {
      chats,
      title: "Chat Requests - Admin | VishLink",
      description: "View and manage all user chat requests.",
      canonical: "https://wishlink-7j0a.onrender.com/chat/admin",
      robots: "noindex, nofollow",
      hideFooter: true,
    });
  })
);

// Admin opens a specific chat
router.get(
  "/admin/:chatId",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      req.flash("error", "Invalid chat id.");
      return res.redirect("/chat/admin");
    }

    const chat = await Chat.findById(chatId)
      .select("user messages adminUnreadCount")
      .populate({
        path: "user",
        select: "username email",
        options: { lean: true },
      })
      .lean();

    if (!chat) {
      req.flash("error", "Chat not found.");
      return res.redirect("/chat/admin");
    }

    if (chat.adminUnreadCount > 0) {
      await Chat.updateOne(
        { _id: chatId, adminUnreadCount: { $gt: 0 } },
        { $set: { adminUnreadCount: 0 } }
      );
      invalidateChatInboxCache();
    }

    await markAdminNotificationsAsRead(req.app, {
      type: "chat_message",
      entityType: "chat",
      entityId: String(chatId),
    });

    res.render("chat/adminChat", {
      chat,
      title: `Chat - ${chat.user?.username || "User"} | Admin`,
      description: "Reply to user chat request.",
      canonical: `https://wishlink-7j0a.onrender.com/chat/admin/${chatId}`,
      robots: "noindex, nofollow",
      hideFooter: true,
      chatLayout: true,
    });
  })
);

// Admin reply to user
router.post(
  "/admin/:chatId/message",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      req.flash("error", "Invalid chat id.");
      return res.redirect("/chat/admin");
    }

    const message = parseMessage(req);
    if (!message) {
      req.flash("error", "Message cannot be empty.");
      return res.redirect(`/chat/admin/${chatId}`);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      req.flash("error", `Message is too long. Max ${MAX_MESSAGE_LENGTH} characters.`);
      return res.redirect(`/chat/admin/${chatId}`);
    }

    const chat = await Chat.findById(chatId).select(
      "user messages lastMessage lastMessageAt userUnreadCount adminUnreadCount"
    );
    if (!chat) {
      req.flash("error", "Chat not found.");
      return res.redirect("/chat/admin");
    }

    chat.messages.push({
      sender: req.user._id,
      senderRole: "admin",
      text: message,
    });
    chat.lastMessage = message;
    chat.lastMessageAt = new Date();
    chat.userUnreadCount += 1;

    await chat.save();
    invalidateChatInboxCache();
    const latestMessage = chat.messages[chat.messages.length - 1];
    const chatOwner = await user.findById(chat.user).select("username email").lean();

    const io = req.app.get("io");
    if (io) {
      const currentChatId = String(chat._id);

      io.to(`chat:${currentChatId}`).emit("newChatMessage", {
        chatId: currentChatId,
        message: {
          _id: String(latestMessage._id),
          text: latestMessage.text,
          senderRole: latestMessage.senderRole,
          senderName: req.user.username,
        },
      });

      io.to("admins").emit("chatThreadUpdated", {
        chatId: currentChatId,
        userName: chatOwner?.username || "Unknown User",
        userEmail: chatOwner?.email || "No email",
        lastMessage: chat.lastMessage || "",
        lastMessageAt: chat.lastMessageAt,
        adminUnreadCount: chat.adminUnreadCount || 0,
      });
    }

    if (wantsJson(req)) {
      return res.json({
        ok: true,
        chatId: String(chat._id),
        message: serializeMessage(latestMessage),
      });
    }

    res.redirect(`/chat/admin/${chatId}`);
  })
);

router.delete(
  "/admin/:chatId",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      req.flash("error", "Invalid chat id.");
      return res.redirect("/chat/admin");
    }

    const deletedChat = await Chat.findByIdAndDelete(chatId);
    if (!deletedChat) {
      req.flash("error", "Chat not found.");
      return res.redirect("/chat/admin");
    }

    invalidateChatInboxCache();
    await markAdminNotificationsAsRead(req.app, {
      entityType: "chat",
      entityId: String(chatId),
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`chat:${chatId}`).emit("chatThreadDeleted", { chatId });
      io.to("admins").emit("chatThreadDeleted", { chatId });
    }

    req.flash("success", "Chat thread deleted successfully.");
    res.redirect("/chat/admin");
  })
);

router.get(
  "/api/user-thread",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    if (req.user.isAdmin) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const chat = await Chat.findOne({ user: req.user._id })
      .select("messages lastMessageAt")
      .lean();
    if (!chat) {
      return res.json({ ok: true, chat: null });
    }

    return res.json({
      ok: true,
      chat: {
        chatId: String(chat._id),
        messages: chat.messages.map(serializeMessage),
        lastMessageAt: chat.lastMessageAt,
      },
    });
  })
);

router.get(
  "/api/thread/:chatId",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { chatId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ ok: false, error: "Invalid chat id." });
    }

    const chat = await Chat.findById(chatId).select("user messages lastMessageAt").lean();
    if (!chat || !canAccessChat(req.user, chat)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const afterMessageId = parseAfterMessageId(req.query.afterMessageId);
    const messages = afterMessageId
      ? chat.messages.filter((m) => isAfterMessageId(m._id, afterMessageId))
      : chat.messages;

    return res.json({
      ok: true,
      chatId: String(chat._id),
      messages: messages.map(serializeMessage),
      lastMessageAt: chat.lastMessageAt,
    });
  })
);

router.get(
  "/api/admin/inbox",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (_req, res) => {
    const chats = await loadAdminInboxChats();

    return res.json({
      ok: true,
      chats: chats.map((chat) => ({
        chatId: String(chat._id),
        userName: chat.user?.username || "Unknown User",
        userEmail: chat.user?.email || "No email",
        lastMessage: chat.lastMessage || "",
        lastMessageAt: chat.lastMessageAt,
        adminUnreadCount: chat.adminUnreadCount || 0,
      })),
    });
  })
);

module.exports = router;
