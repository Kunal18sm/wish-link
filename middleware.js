module.exports.isLoggedIn = (req,res,next)=>{
  if(!req.isAuthenticated()){   
    req.flash("error","You must be Logged in to continue.");
    return res.redirect("/loginForm");
  }
  next();
}

module.exports.isAdmin = (req,res,next)=>{
  if(!req.isAuthenticated() && req.user.isAdmin){   
    req.flash("error","You must be admin to continue.");
    return res.redirect("/");
  }
  next();
}