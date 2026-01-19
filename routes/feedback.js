const express = require("express");
const router = express.Router({ mergeParams: true });
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn } = require("../middleware.js")
const { isAdmin } = require("../middleware.js")
const feedback = require("../models/feedback.js");

// feedback
router.post("/add",isLoggedIn,wrapAsync((async(req,res)=>{
  const {message} = req.body;
  console.log(message);
  
  const newFeedBack = new feedback({
    feedbackmsg: message,
    email:req.user.email,
    userName: req.user.username,
  })
  console.log(newFeedBack);
  
  try{
    const savedfeedback = await newFeedBack.save();
    res.redirect("/")
  }catch(err){
    res.redirect("/")
  }
})))

// feedback Page
router.get("/feedbackpage",isLoggedIn,isAdmin,wrapAsync((async(req,res)=>{

  try{
    let allFeedbacks = await feedback.find();
    res.render("feedBack",{allFeedbacks})
  }catch(err){
    res.redirect("/")
  }
})))

//delete FeedBack
router.delete("/delete/:id",isLoggedIn,isAdmin,wrapAsync((async(req,res)=>{
  const {id} = req.params;
  console.log(id);
  
  try{
    await feedback.findByIdAndDelete(id);
    res.redirect("/feedback/feedbackpage")
  }catch(err){
    res.redirect("/")
  }
})))




module.exports = router;