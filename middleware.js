module.exports.isLoggedIn = (req,res,next)=>{
  if(!req.isAuthenticated()){   
    req.flash("error","You must be Logged in to continue.");
    return res.redirect("/loginForm");
  }
  next();
}
