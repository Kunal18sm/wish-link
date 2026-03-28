const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const game = require("../models/game.js");
const user = require("../models/user.js");
const {
  cache,
  getLeaderboardCacheKey,
  invalidateLeaderboardCache,
} = require("../utils/runtimeCaches.js");
const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");

router.get("/", isLoggedIn, wrapAsync(async (req, res) => {
  res.render("game/butterfly", {
    title: "Phoenix Game - VishLink",
    description: "Play the VishLink phoenix game and submit your score to the leaderboard.",
    canonical: `${SITE_URL}/game`,
    robots: "noindex, nofollow"
  });
}));


router.post("/submit-score", isLoggedIn, wrapAsync(async (req, res) => {
  const parsedScore = Number(req.body.score);
  const score = Number.isFinite(parsedScore) && parsedScore >= 0 ? Math.floor(parsedScore) : 0;

  await game.updateOne(
    { author: req.user._id },
    {
      $max: { userScore: score },
      $setOnInsert: {
        userName: req.user.username,
        author: req.user._id,
      },
    },
    { upsert: true }
  );

  invalidateLeaderboardCache();
  res.redirect("/game/leaderboard");
}));

router.get("/leaderboard", isLoggedIn, wrapAsync(async (req, res) => {
  const players = await cache.getOrSet(getLeaderboardCacheKey(), async () => {
    return game
      .find({})
      .select("userName userScore author")
      .sort({ userScore: -1 })
      .limit(100)
      .lean();
  }, 10 * 1000);
  const isAdmin = req.user.isAdmin;
  res.render("game/leaderBoard", {
    players,
    isAdmin,
    title: "Game Leaderboard - VishLink",
    description: "View VishLink game leaderboard rankings.",
    canonical: `${SITE_URL}/game/leaderboard`,
    robots: "noindex, nofollow"
  });
}));

router.post("/updateWinners", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  try {
    const topPlayers = await game.find({})
      .select("author")
      .sort({ userScore: -1 })
      .limit(3)
      .lean();

    const userIds = topPlayers
      .map((p) => p.author)
      .filter(Boolean);

    if (userIds.length) {
      await user.updateMany(
        { _id: { $in: userIds } },
        { $inc: { winnerCount: 1 } }
      );
    }

    await game.deleteMany({});
    invalidateLeaderboardCache();

    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong" });
  }
}));

module.exports = router;
