const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const feedback = require("../models/feedback.js");

// feedback
router.post(
  "/add",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { message } = req.body;
    const newFeedBack = new feedback({
      feedbackmsg: message,
      email: req.user.email,
      userName: req.user.username,
      author: req.user._id,
    });

    await newFeedBack.save();
    res.redirect("/feedback/feedbackpage");
  })
);

// feedback Page
router.get(
  "/feedbackpage",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    try {
      const allFeedbacks = await feedback
        .find({})
        .select("feedbackmsg email userName author date")
        .sort({ _id: -1 })
        .lean();

      res.render("feedBack", {
        allFeedbacks,
        title: "Feedback Dashboard - VishLink",
        description: "Admin feedback management panel.",
        robots: "noindex, nofollow",
        currUser: req.user,
      });
    } catch (_err) {
      res.redirect("/");
    }
  })
);

// delete feedback
router.delete(
  "/delete/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { id } = req.params;

    try {
      await feedback.findByIdAndDelete(id);
      res.redirect("/feedback/feedbackpage");
    } catch (_err) {
      res.redirect("/");
    }
  })
);

module.exports = router;

