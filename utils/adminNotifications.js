const AdminNotification = require("../models/adminNotification.js");
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

async function getUnreadCountFromDb() {
  try {
    return await AdminNotification.countDocuments({
      $and: [
        { read: { $ne: true } },
        { isRead: { $ne: true } },
      ],
    });
  } catch (_err) {
    return 0;
  }
}

async function emitAdminNotificationCount(app, unreadCount = null) {
  const io = app?.get?.("io");
  let nextUnreadCount = Number(unreadCount);
  if (Number.isNaN(nextUnreadCount) || unreadCount === null) {
    nextUnreadCount = await getUnreadCountFromDb();
  }

  if (io) {
    io.to("admins").emit("adminNotificationCountUpdated", {
      unreadCount: nextUnreadCount,
    });
  }

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
    meta: payload.meta || payload.details || null,
    isRead: false,
    readAt: null,
  };
}

async function createAdminNotification(app, payload = {}, options = {}) {
  const normalizedPayload = buildNotificationPayload(payload);
  void options;

  let savedDoc = null;
  try {
    const doc = new AdminNotification({
      type: normalizedPayload.type,
      title: normalizedPayload.title,
      message: normalizedPayload.message,
      link: normalizedPayload.link,
      entityType: normalizedPayload.entityType,
      entityId: normalizedPayload.entityId,
      dedupeKey: normalizedPayload.dedupeKey,
      actor: normalizedPayload.actor,
      details: normalizedPayload.meta || {},
      meta: normalizedPayload.meta || {},
      read: false,
      isRead: false,
    });
    savedDoc = await doc.save();
  } catch (err) {
    console.error("Failed to save Admin notification to DB:", err?.message || err);
  }

  const unreadCount = await getUnreadCountFromDb();
  await emitAdminNotificationCount(app, unreadCount);

  sendAdminPushNotification({
    title: normalizedPayload.title,
    body: normalizedPayload.message,
    link: normalizedPayload.link,
    tag: normalizedPayload.dedupeKey || `admin:${savedDoc?._id || Date.now()}`,
  }).catch((pushErr) => {
    console.log("Admin push notification warning:", pushErr?.message || pushErr);
  });

  return savedDoc
    ? {
        ...normalizedPayload,
        _id: savedDoc._id,
        createdAt: savedDoc.createdAt,
        updatedAt: savedDoc.updatedAt,
      }
    : {
        ...normalizedPayload,
        _id: null,
        createdAt: null,
        updatedAt: null,
      };
}

async function markAdminNotificationsAsRead(app, filter = {}) {
  try {
    const updateFilter = filter.id
      ? { _id: filter.id }
      : { $and: [{ read: { $ne: true } }, { isRead: { $ne: true } }] };

    const result = await AdminNotification.updateMany(updateFilter, {
      $set: { read: true, isRead: true, readAt: new Date() },
    });

    const unreadCount = await getUnreadCountFromDb();
    await emitAdminNotificationCount(app, unreadCount);

    return Number(result?.modifiedCount || 0);
  } catch (err) {
    console.error("Failed to mark admin notifications as read:", err?.message || err);
    return 0;
  }
}

module.exports = {
  createAdminNotification,
  markAdminNotificationsAsRead,
  getUnreadCountFromDb,
};
