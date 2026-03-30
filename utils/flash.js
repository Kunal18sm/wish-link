"use strict";

function normalizeFlashMessages(raw) {
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  if (raw === undefined || raw === null) return [];
  return [String(raw)];
}

function flashMiddleware(req, _res, next) {
  if (!req.session) {
    return next(new Error("Session middleware is required before flash middleware."));
  }

  req.flash = (type, ...messages) => {
    const key = String(type || "").trim();
    if (!key) return [];

    const flashBucket = req.session.flash && typeof req.session.flash === "object"
      ? req.session.flash
      : {};
    req.session.flash = flashBucket;

    if (!messages.length) {
      const queued = normalizeFlashMessages(flashBucket[key]);
      delete flashBucket[key];
      return queued;
    }

    const mergedMessage = messages.join(" ");
    const nextMessages = normalizeFlashMessages(flashBucket[key]);
    nextMessages.push(mergedMessage);
    flashBucket[key] = nextMessages;
    return nextMessages.length;
  };

  next();
}

module.exports = {
  flashMiddleware,
};
