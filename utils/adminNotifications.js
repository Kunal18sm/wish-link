const AdminNotification = require("../models/adminNotification.js");
const { invalidateAdminNotificationCache } = require("./runtimeCaches.js");
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

function toPublicAdminNotification(notificationDoc) {
  if (!notificationDoc) return null;

  const actor = notificationDoc.actor || {};

  return {
    id: String(notificationDoc._id),
    type: toTrimmedText(notificationDoc.type, "general", 40),
    title: toTrimmedText(notificationDoc.title, "Notification", 120),
    message: toTrimmedText(notificationDoc.message, "", 300),
    link: normalizeLink(notificationDoc.link),
    entityType: toTrimmedText(notificationDoc.entityType, "", 40),
    entityId: toTrimmedText(notificationDoc.entityId, "", 80),
    actorName: toTrimmedText(actor.username || "", "", 80),
    actorEmail: toTrimmedText(actor.email || "", "", 160),
    isRead: Boolean(notificationDoc.isRead),
    createdAt: notificationDoc.createdAt || null,
    updatedAt: notificationDoc.updatedAt || notificationDoc.createdAt || null,
  };
}

async function getAdminUnreadNotificationCount() {
  return AdminNotification.countDocuments({ isRead: false });
}

async function emitAdminNotificationCount(app, unreadCount = null) {
  const io = app?.get?.("io");
  if (!io) return Number(unreadCount || 0);

  const nextUnreadCount =
    unreadCount === null || unreadCount === undefined
      ? await getAdminUnreadNotificationCount()
      : Number(unreadCount) || 0;

  io.to("admins").emit("adminNotificationCountUpdated", {
    unreadCount: nextUnreadCount,
  });

  return nextUnreadCount;
}

async function emitAdminNotificationCreated(app, notificationDoc, unreadCount = null) {
  const io = app?.get?.("io");
  if (!io) return Number(unreadCount || 0);

  const serialized = toPublicAdminNotification(notificationDoc);
  if (!serialized) {
    return emitAdminNotificationCount(app, unreadCount);
  }

  const nextUnreadCount =
    unreadCount === null || unreadCount === undefined
      ? await getAdminUnreadNotificationCount()
      : Number(unreadCount) || 0;

  io.to("admins").emit("adminNotificationCreated", {
    notification: serialized,
    unreadCount: nextUnreadCount,
  });

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
  const shouldUpsertUnread = Boolean(options.upsertUnreadByDedupeKey);

  let notification;
  if (shouldUpsertUnread && normalizedPayload.dedupeKey) {
    notification = await AdminNotification.findOneAndUpdate(
      {
        dedupeKey: normalizedPayload.dedupeKey,
        isRead: false,
      },
      {
        $set: normalizedPayload,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
  } else {
    notification = await AdminNotification.create(normalizedPayload);
  }

  invalidateAdminNotificationCache();
  const unreadCount = await getAdminUnreadNotificationCount();
  await emitAdminNotificationCreated(app, notification, unreadCount);
  sendAdminPushNotification({
    title: normalizedPayload.title,
    body: normalizedPayload.message,
    link: normalizedPayload.link,
    tag: normalizedPayload.dedupeKey || `admin:${String(notification?._id || "")}`,
  }).catch((pushErr) => {
    // eslint-disable-next-line no-console
    console.log("Admin push notification warning:", pushErr?.message || pushErr);
  });

  return notification;
}

async function markAdminNotificationsAsRead(app, filter = {}) {
  const safeFilter = { ...filter, isRead: false };

  const result = await AdminNotification.updateMany(safeFilter, {
    $set: {
      isRead: true,
      readAt: new Date(),
    },
  });

  const modifiedCount = Number(result?.modifiedCount || 0);

  if (modifiedCount > 0) {
    invalidateAdminNotificationCache();
    await emitAdminNotificationCount(app);
  }

  return modifiedCount;
}

module.exports = {
  createAdminNotification,
  emitAdminNotificationCount,
  getAdminUnreadNotificationCount,
  markAdminNotificationsAsRead,
  toPublicAdminNotification,
};
