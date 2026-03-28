const { createMemoryCache } = require("./memoryCache.js");

const cache = createMemoryCache({
  defaultTtlMs: 30 * 1000,
  maxEntries: 1000,
});

const PREFIX = {
  ADMIN_USERS: "admin-users:",
  CHAT_INBOX: "chat-inbox:",
  GAME_LEADERBOARD: "game-leaderboard:",
};

function getAdminUsersCacheKey(searchTerm, page) {
  const normalizedSearchTerm = String(searchTerm || "").trim().toLowerCase();
  const normalizedPage = Number.parseInt(page, 10) || 1;
  return `${PREFIX.ADMIN_USERS}${normalizedSearchTerm}:${normalizedPage}`;
}

function getChatInboxCacheKey() {
  return `${PREFIX.CHAT_INBOX}default`;
}

function getLeaderboardCacheKey() {
  return `${PREFIX.GAME_LEADERBOARD}default`;
}

function invalidateAdminUsersCache() {
  cache.deleteByPrefix(PREFIX.ADMIN_USERS);
}

function invalidateChatInboxCache() {
  cache.deleteByPrefix(PREFIX.CHAT_INBOX);
}

function invalidateLeaderboardCache() {
  cache.deleteByPrefix(PREFIX.GAME_LEADERBOARD);
}

module.exports = {
  cache,
  getAdminUsersCacheKey,
  getChatInboxCacheKey,
  getLeaderboardCacheKey,
  invalidateAdminUsersCache,
  invalidateChatInboxCache,
  invalidateLeaderboardCache,
};
