const { purchaseSchema } = require("./joiValidation.js");
const ExpressError = require("./utils/ExpressError.js");

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
    let {error} = purchaseSchema.validate(req.body);
    if(error){
        let errMsg = error.details.map((el)=>el.message).join(",");
        throw new ExpressError(400,errMsg);
    } else {
        next();
    }
};
