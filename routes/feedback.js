const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin } = require("../middleware.js")
const feedback = require("../models/feedback.js");

// feedback
router.post("/add", isLoggedIn, wrapAsync((async (req, res) => {
  const { message } = req.body;
  const author = req.user._id ;
  const newFeedBack = new feedback({
    feedbackmsg: message,
    email: req.user.email,
    userName: req.user.username,
    author: author,
  })
  await newFeedBack.save();
  res.redirect("/feedback/feedbackpage");

})))

// feedback Page
router.get("/feedbackpage", isLoggedIn, wrapAsync((async (req, res) => {

  try {
    const currUser = req.user;
    let allFeedbacks = await feedback.find().sort({ _id: -1 });
    res.render("feedBack", {
      allFeedbacks,
      title: "Feedback Dashboard – WishLink",
      description: "Admin feedback management panel.",
      robots: "noindex, nofollow",
      currUser
    });
  } catch (err) {
    res.redirect("/")
  }
})))

//delete FeedBack
router.delete("/delete/:id", isLoggedIn, isAdmin, wrapAsync((async (req, res) => {
  const { id } = req.params;
  console.log(id);

  try {
    await feedback.findByIdAndDelete(id);
    res.redirect("/feedback/feedbackpage")
  } catch (err) {
    res.redirect("/")
  }
})))




module.exports = router;