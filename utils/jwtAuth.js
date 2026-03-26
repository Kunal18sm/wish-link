const jwt = require("jsonwebtoken");

const AUTH_COOKIE_NAME = "vishlink_auth_token";
const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const COOKIE_MAX_AGE_MS = Number(process.env.JWT_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);

function getJwtSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET;
}

function createAuthToken(userDoc) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error("JWT secret is not configured.");
  }

  return jwt.sign(
    {
      sub: String(userDoc._id),
      username: userDoc.username,
      email: userDoc.email,
      isAdmin: Boolean(userDoc.isAdmin),
    },
    secret,
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

function verifyAuthToken(token) {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error("JWT secret is not configured.");
  }
  return jwt.verify(token, secret);
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

function parseCookieHeader(cookieHeader = "") {
  const cookies = {};
  String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) return;
      const key = decodeURIComponent(pair.slice(0, eqIndex).trim());
      const value = decodeURIComponent(pair.slice(eqIndex + 1).trim());
      cookies[key] = value;
    });
  return cookies;
}

function extractTokenFromRequest(req) {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authHeader = String(req.get("authorization") || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return null;
}

function extractTokenFromCookieHeader(cookieHeader) {
  const parsed = parseCookieHeader(cookieHeader);
  return parsed[AUTH_COOKIE_NAME] || null;
}

module.exports = {
  AUTH_COOKIE_NAME,
  createAuthToken,
  verifyAuthToken,
  setAuthCookie,
  clearAuthCookie,
  extractTokenFromRequest,
  extractTokenFromCookieHeader,
};
