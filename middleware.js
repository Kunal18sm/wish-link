const { purchaseSchema } = require("./joiValidation.js");

module.exports.isLoggedIn = (req,res,next)=>{
  if(!req.isAuthenticated()){   
    req.flash("error","You must be Logged in to continue.");
    return res.redirect("/loginForm");
  }
  next();
}

module.exports.isAdmin = (req,res,next)=>{
  if(!req.isAuthenticated() || !req.user.isAdmin){   
    req.flash("error","You must be admin to continue.");
    return res.redirect("/");
  }
  next();
}

module.exports.validatepurchase = (req, res, next) => {
    const { error, value } = purchaseSchema.validate(req.body, {
      abortEarly: false,
      convert: true,
      stripUnknown: true,
    });

    if (error) {
      const firstError = error.details[0]?.message || "Please check your form details.";
      req.flash("error", firstError);
      return res.redirect(req.get("Referrer") || "/");
    }

    req.body = value;
    next();
};
