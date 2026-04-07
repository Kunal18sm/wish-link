const webPush = require("web-push");

const AdminPushSubscription = require("../models/adminPushSubscription.js");

const DEFAULT_PUSH_ICON = "/assets/icon-192.png";
const DEFAULT_PUSH_BADGE = "/assets/icon-192.png";
const DEFAULT_PUSH_URL = "/requests/dashboard#adminNotifications";

let webPushConfigured = false;

function getTrimmedEnv(name) {
  return String(process.env[name] || "").trim();
}

function getPushConfig() {
  const publicKey = getTrimmedEnv("VAPID_PUBLIC_KEY");
  const privateKey = getTrimmedEnv("VAPID_PRIVATE_KEY");
  const subject = getTrimmedEnv("VAPID_SUBJECT");

  return {
    publicKey,
    privateKey,
    subject,
    configured: Boolean(publicKey && privateKey && subject),
  };
}

function ensureWebPushConfigured() {
  if (webPushConfigured) return;

  const config = getPushConfig();
  if (!config.configured) return;

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  webPushConfigured = true;
}

function toDateOrNull(value) {
  if (!value && value !== 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSubscription(rawSubscription = {}) {
  const endpoint = String(rawSubscription?.endpoint || "").trim();
  const p256dh = String(rawSubscription?.keys?.p256dh || "").trim();
  const auth = String(rawSubscription?.keys?.auth || "").trim();
  const expirationTime = toDateOrNull(rawSubscription?.expirationTime);

  if (!endpoint || !p256dh || !auth) {
    throw new Error("Invalid push subscription.");
  }

  return {
    endpoint,
    expirationTime,
    keys: {
      p256dh,
      auth,
    },
  };
}

function toPushPayload(rawPayload = {}) {
  const title = String(rawPayload.title || "VishLink Admin").trim().slice(0, 80) || "VishLink Admin";
  const body = String(rawPayload.body || rawPayload.message || "New update available.")
    .trim()
    .slice(0, 180) || "New update available.";
  const url = String(rawPayload.url || rawPayload.link || DEFAULT_PUSH_URL).trim();
  const tag = String(rawPayload.tag || "").trim().slice(0, 100);
  const icon = String(rawPayload.icon || DEFAULT_PUSH_ICON).trim() || DEFAULT_PUSH_ICON;
  const badge = String(rawPayload.badge || DEFAULT_PUSH_BADGE).trim() || DEFAULT_PUSH_BADGE;

  return {
    title,
    body,
    url: url.startsWith("/") ? url : DEFAULT_PUSH_URL,
    tag,
    icon,
    badge,
    data: {
      url: url.startsWith("/") ? url : DEFAULT_PUSH_URL,
    },
  };
}

function buildWebPushSubscription(doc) {
  return {
    endpoint: String(doc?.endpoint || ""),
    expirationTime: doc?.expirationTime || null,
    keys: {
      p256dh: String(doc?.keys?.p256dh || ""),
      auth: String(doc?.keys?.auth || ""),
    },
  };
}

async function upsertAdminPushSubscription(user, rawSubscription, userAgent = "") {
  const userId = String(user?._id || "").trim();
  if (!userId) {
    throw new Error("Unauthorized.");
  }

  const normalizedSubscription = normalizeSubscription(rawSubscription);
  const safeUserAgent = String(userAgent || "").trim().slice(0, 500);

  return AdminPushSubscription.findOneAndUpdate(
    { endpoint: normalizedSubscription.endpoint },
    {
      $set: {
        user: userId,
        endpoint: normalizedSubscription.endpoint,
        expirationTime: normalizedSubscription.expirationTime,
        keys: normalizedSubscription.keys,
        userAgent: safeUserAgent,
      },
      $setOnInsert: {
        lastUsedAt: null,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );
}

async function removeAdminPushSubscription(endpoint) {
  const normalizedEndpoint = String(endpoint || "").trim();
  if (!normalizedEndpoint) return 0;

  const result = await AdminPushSubscription.deleteOne({
    endpoint: normalizedEndpoint,
  });
  return Number(result?.deletedCount || 0);
}

async function removeAdminPushSubscriptionsByEndpoints(endpoints = []) {
  const normalizedEndpoints = Array.isArray(endpoints)
    ? endpoints.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!normalizedEndpoints.length) return 0;

  const result = await AdminPushSubscription.deleteMany({
    endpoint: { $in: normalizedEndpoints },
  });
  return Number(result?.deletedCount || 0);
}

async function sendAdminPushNotification(rawPayload = {}) {
  ensureWebPushConfigured();
  const config = getPushConfig();
  if (!config.configured) {
    return {
      configured: false,
      sentCount: 0,
      removedCount: 0,
      totalSubscriptions: 0,
    };
  }

  const subscriptions = await AdminPushSubscription.find({})
    .select("endpoint expirationTime keys user")
    .lean();
  if (!subscriptions.length) {
    return {
      configured: true,
      sentCount: 0,
      removedCount: 0,
      totalSubscriptions: 0,
    };
  }

  const payload = toPushPayload(rawPayload);
  const serializedPayload = JSON.stringify(payload);
  const invalidEndpoints = [];
  let sentCount = 0;

  const deliveryResults = await Promise.allSettled(
    subscriptions.map(async (subscriptionDoc) => {
      const webPushSubscription = buildWebPushSubscription(subscriptionDoc);
      try {
        await webPush.sendNotification(webPushSubscription, serializedPayload, {
          TTL: 60,
          urgency: "high",
        });
        sentCount += 1;
        await AdminPushSubscription.updateOne(
          { _id: subscriptionDoc._id },
          { $set: { lastUsedAt: new Date() } }
        );
      } catch (err) {
        const statusCode = Number(err?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          invalidEndpoints.push(webPushSubscription.endpoint);
        } else {
          throw err;
        }
      }
    })
  );

  for (const result of deliveryResults) {
    if (result.status === "rejected") {
      // keep non-expired failures non-fatal
      // eslint-disable-next-line no-console
      console.log("Web push send warning:", result.reason?.message || result.reason);
    }
  }

  let removedCount = 0;
  if (invalidEndpoints.length) {
    removedCount = await removeAdminPushSubscriptionsByEndpoints(invalidEndpoints);
  }

  return {
    configured: true,
    sentCount,
    removedCount,
    totalSubscriptions: subscriptions.length,
  };
}

module.exports = {
  getPushConfig,
  normalizeSubscription,
  upsertAdminPushSubscription,
  removeAdminPushSubscription,
  sendAdminPushNotification,
};
