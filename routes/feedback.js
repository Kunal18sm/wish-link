const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const feedback = require("../models/feedback.js");

const toTrimmedString = (value, maxLength = 500) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

// feedback
router.post(
  "/add",
  wrapAsync(async (req, res) => {
    const redirectBack = req.get("Referrer") || "/";
    const payload = req.body.feedback || {};
    const message = toTrimmedString(payload.message || req.body.message, 1000);
    const isAuthenticated = Boolean(req.user?._id);

    if (!message) {
      req.flash("error", "Please enter your feedback message.");
      return res.redirect(redirectBack);
    }

    const fallbackName = isAuthenticated ? toTrimmedString(req.user?.username, 80) : "";
    const fallbackEmail = isAuthenticated ? toTrimmedString(req.user?.email, 120).toLowerCase() : "";
    const submittedName = toTrimmedString(payload.name || req.body.name, 80);
    const submittedEmail = toTrimmedString(payload.email || req.body.email, 120).toLowerCase();

    const finalName = fallbackName || submittedName || "Guest User";
    const finalEmail =
      fallbackEmail || submittedEmail || `guest-${Date.now()}@wishlo.local`;

    if (!isValidEmail(finalEmail)) {
      req.flash("error", "Please enter a valid email address.");
      return res.redirect(redirectBack);
    }

    const newFeedBack = new feedback({
      feedbackmsg: message,
      email: finalEmail,
      userName: finalName,
      author: isAuthenticated ? req.user._id : undefined,
    });

    await newFeedBack.save();
    req.flash("success", "Thanks for sharing your feedback.");
    return res.redirect(redirectBack);
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

