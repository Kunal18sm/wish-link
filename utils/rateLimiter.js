function createWindowRateLimiter({
  windowMs,
  max,
  keyGenerator,
  skip,
  onLimitReached,
}) {
  const store = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (!entry || entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, Math.max(windowMs, 60 * 1000)).unref();

  return (req, res, next) => {
    if (typeof skip === "function" && skip(req)) {
      return next();
    }

    const key = String((typeof keyGenerator === "function" ? keyGenerator(req) : req.ip) || "anonymous");
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
    }

    entry.count += 1;
    store.set(key, entry);

    const remaining = Math.max(max - entry.count, 0);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      if (typeof onLimitReached === "function") {
        return onLimitReached(req, res, entry);
      }

      return res.status(429).json({
        ok: false,
        message: "Too many requests. Please try again later.",
      });
    }

    return next();
  };
}

module.exports = {
  createWindowRateLimiter,
};
