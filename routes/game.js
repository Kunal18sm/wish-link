const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin } = require("../middleware.js")
const game = require("../models/game.js");
const user = require("../models/user.js")
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
  const score = Number(req.body.score);

  await game.updateOne(
    { author: req.user._id },
    {
      $max: { userScore: score }, // update only if higher
      $setOnInsert: {
        userName: req.user.username,
        author: req.user._id
      }
    },
    { upsert: true }
  );

  res.redirect("/game/leaderboard");
}));

router.get("/leaderboard", isLoggedIn, wrapAsync(async (req, res) => {
  let players = await game.find({}).sort({ userScore: -1 });
  const isAdmin = req.user.isAdmin ;
  res.render("game/leaderBoard",{
    players,
    isAdmin,
    title: "Game Leaderboard - VishLink",
    description: "View VishLink game leaderboard rankings.",
    canonical: `${SITE_URL}/game/leaderboard`,
    robots: "noindex, nofollow"
  });
}));

router.post("/updateWinners",isLoggedIn,isAdmin ,wrapAsync( async (req, res) => {
  console.log("route called");
  
  try {
    const topPlayers = await game.find({})
      .sort({ userScore: -1 })
      .limit(3);
    
    console.log(topPlayers);
    

    const userIds = topPlayers
      .map(p => p.author)
      .filter(Boolean);

    await user.updateMany(
      { _id: { $in: userIds } },
      { $inc: { winnerCount: 1 } }
    );

    await game.deleteMany({});

    res.redirect("/");

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong" });
  }
}));






module.exports = router;
