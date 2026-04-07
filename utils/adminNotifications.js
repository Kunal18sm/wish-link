const { sendAdminPushNotification } = require("./pushNotifications.js");

const DEFAULT_LINK = "/requests/dashboard";

function toTrimmedText(value, fallback = "", maxLength = 120) {
  const normalized = String(value || fallback)
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return String(fallback || "").trim().slice(0, maxLength);
  return normalized.slice(0, maxLength);
}

function normalizeLink(value) {
  const link = String(value || "").trim();
  if (!link) return DEFAULT_LINK;
  if (!link.startsWith("/")) return DEFAULT_LINK;
  return link.slice(0, 400);
}

function normalizeActor(actor = {}) {
  return {
    id: toTrimmedText(actor?._id || actor?.id || "", "", 80),
    username: toTrimmedText(actor?.username || "", "", 80),
    email: toTrimmedText(actor?.email || "", "", 160),
  };
}

async function emitAdminNotificationCount(app, unreadCount = null) {
  const io = app?.get?.("io");
  if (!io) return Number(unreadCount || 0);

  const nextUnreadCount = Number(unreadCount) || 0;

  io.to("admins").emit("adminNotificationCountUpdated", {
    unreadCount: nextUnreadCount,
  });

  return nextUnreadCount;
}

function buildNotificationPayload(payload = {}) {
  return {
    type: toTrimmedText(payload.type, "general", 40) || "general",
    title: toTrimmedText(payload.title, "Notification", 120) || "Notification",
    message: toTrimmedText(payload.message, "New activity received.", 300) || "New activity received.",
    link: normalizeLink(payload.link),
    entityType: toTrimmedText(payload.entityType, "", 40),
    entityId: toTrimmedText(payload.entityId, "", 80),
    dedupeKey: toTrimmedText(payload.dedupeKey, "", 120),
    actor: normalizeActor(payload.actor),
    meta: payload.meta || null,
    isRead: false,
    readAt: null,
  };
}

async function createAdminNotification(app, payload = {}, options = {}) {
  const normalizedPayload = buildNotificationPayload(payload);
  void options;
  await emitAdminNotificationCount(app, 0);
  sendAdminPushNotification({
    title: normalizedPayload.title,
    body: normalizedPayload.message,
    link: normalizedPayload.link,
    tag: normalizedPayload.dedupeKey || `admin:ephemeral:${Date.now()}`,
  }).catch((pushErr) => {
    // eslint-disable-next-line no-console
    console.log("Admin push notification warning:", pushErr?.message || pushErr);
  });

  return {
    ...normalizedPayload,
    _id: null,
    isRead: false,
    createdAt: null,
    updatedAt: null,
  };
}

async function markAdminNotificationsAsRead(app, filter = {}) {
  void filter;
  await emitAdminNotificationCount(app, 0);
  return 0;
}

module.exports = {
  createAdminNotification,
  markAdminNotificationsAsRead,
};
