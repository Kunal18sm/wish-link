const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const game = require("../models/game.js");
const gameTournament = require("../models/gameTournament.js");
const user = require("../models/user.js");
const { getBannerSlides, BANNER_PAGES } = require("../utils/bannerConfigCache.js");
const {
  cache,
  getLeaderboardCacheKey,
  invalidateLeaderboardCache,
} = require("../utils/runtimeCaches.js");
const SITE_URL = (process.env.SITE_URL || "https://wishlink-7j0a.onrender.com").replace(/\/+$/, "");

const TOURNAMENT_STATUS = {
  LIVE: "Live",
};

const SINGLE_TOURNAMENT_SLUG = "phoenix-rise-daily-cup";
const FALLBACK_GAME_BANNER_IMAGE =
  "https://res.cloudinary.com/drzq6kjgp/image/upload/v1770794063/Gemini_Generated_Image_4qzfxy4qzfxy4qzf_l5tidy.png";
const LEADERBOARD_REWARDS_BY_RANK = [10, 7, 5, 1, 1, 1, 1, 1, 1, 1];

let tournamentSyncPromise = null;

function getGameBannerSlide(slides = []) {
  if (!Array.isArray(slides) || !slides.length) return null;

  return slides.find((slide) => String(slide?.linkUrl || "").trim().startsWith("/game")) || null;
}

async function resolveGameBannerImageUrl() {
  try {
    const [homeSlides, collectionSlides] = await Promise.all([
      getBannerSlides(BANNER_PAGES.HOME),
      getBannerSlides(BANNER_PAGES.COLLECTION),
    ]);

    const selectedSlide = getGameBannerSlide(homeSlides) || getGameBannerSlide(collectionSlides);
    const imageUrl = String(selectedSlide?.imageUrl || "").trim();
    return imageUrl || FALLBACK_GAME_BANNER_IMAGE;
  } catch (_error) {
    return FALLBACK_GAME_BANNER_IMAGE;
  }
}

async function ensureSingleGameTournament() {
  if (tournamentSyncPromise) {
    await tournamentSyncPromise;
    return;
  }

  tournamentSyncPromise = (async () => {
    try {
      const bannerImageUrl = await resolveGameBannerImageUrl();
      const existingPrimary = await gameTournament.findOne({ slug: SINGLE_TOURNAMENT_SLUG }).lean();

      if (!existingPrimary) {
        await gameTournament.create({
          gameName: "Phoenix Rise",
          slug: SINGLE_TOURNAMENT_SLUG,
          title: "Phoenix Rise Daily Cup",
          description: "Play Phoenix Rise, post your best score, and climb the daily rankings.",
          status: TOURNAMENT_STATUS.LIVE,
          thumbnailUrl: bannerImageUrl,
          playUrl: "/game",
          leaderboardUrl: "/game/leaderboard",
          isActive: true,
          priority: 1,
        });
      } else {
        const nextTournamentValues = {
          gameName: "Phoenix Rise",
          title: "Phoenix Rise Daily Cup",
          description: "Play Phoenix Rise, post your best score, and climb the daily rankings.",
          status: TOURNAMENT_STATUS.LIVE,
          thumbnailUrl: bannerImageUrl,
          playUrl: "/game",
          leaderboardUrl: "/game/leaderboard",
          isActive: true,
          priority: 1,
        };

        const shouldUpdate = Object.entries(nextTournamentValues).some(([key, value]) => {
          return String(existingPrimary?.[key] ?? "") !== String(value ?? "");
        });

        if (shouldUpdate) {
          await gameTournament.updateOne(
            { _id: existingPrimary._id },
            { $set: nextTournamentValues }
          );
        }
      }

      // Keep only one game tournament for now.
      await gameTournament.deleteMany({ slug: { $ne: SINGLE_TOURNAMENT_SLUG } });
    } catch (error) {
      const isDuplicateKeyError = Number(error?.code) === 11000;
      if (!isDuplicateKeyError) {
        console.log("Game tournament sync warning:", error?.message || error);
      }
    }
  })().finally(() => {
    tournamentSyncPromise = null;
  });

  await tournamentSyncPromise;
}

router.get("/tournaments", wrapAsync(async (req, res) => {
  const isAuthenticated = Boolean(req.user?._id);

  await ensureSingleGameTournament();

  const tournaments = await gameTournament
    .find({ isActive: true })
    .select("gameName slug title description status thumbnailUrl playUrl leaderboardUrl priority")
    .sort({ priority: 1, createdAt: -1 })
    .lean();

  return res.render("game/tournaments", {
    tournaments,
    isAuthenticated,
    title: "Game Tournaments - VishLink",
    description: "Explore all VishLink daily game tournaments, live events, and leaderboards in one place.",
    canonical: `${SITE_URL}/game/tournaments`,
    robots: "index, follow",
  });
}));

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
    description: "View VishLink daily game leaderboard rankings.",
    canonical: `${SITE_URL}/game/leaderboard`,
    robots: "noindex, nofollow"
  });
}));

router.post("/updateWinners", isLoggedIn, isAdmin, wrapAsync(async (req, res) => {
  try {
    const rankedPlayers = await game.find({})
      .select("author")
      .sort({ userScore: -1, _id: 1 })
      .limit(LEADERBOARD_REWARDS_BY_RANK.length)
      .lean();

    const rewardUpdates = rankedPlayers.reduce((ops, player, index) => {
      const userId = player?.author;
      const rewardCoins = Number(LEADERBOARD_REWARDS_BY_RANK[index] || 0);
      if (!userId || rewardCoins <= 0) return ops;

      ops.push({
        updateOne: {
          filter: { _id: userId },
          update: { $inc: { winnerCount: rewardCoins } },
        },
      });
      return ops;
    }, []);

    if (rewardUpdates.length) {
      await user.bulkWrite(rewardUpdates);
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
