const { purchaseSchema } = require("./joiValidation.js");

function getPurchaseValidationMessage(error) {
  const detail = error?.details?.[0];
  if (!detail) return "Please check your form details and try again.";

  const path = Array.isArray(detail.path) ? detail.path.join(".") : "";

  if (path.endsWith("sender")) {
    return "Please enter sender name.";
  }

  if (path.endsWith("receiver")) {
    return "Please enter receiver name.";
  }

  if (path.endsWith("specialMsg") && detail.type === "string.max") {
    return "Special message can be maximum 350 characters.";
  }

  if (path.endsWith("specialMsg")) {
    return "Please enter a special message.";
  }

  if (path.endsWith("price")) {
    return "Invalid price value. Please refresh and try again.";
  }

  if (path.endsWith("webName")) {
    return "Template name is missing. Please reload the form and try again.";
  }

  return "Please check your form details and try again.";
}

module.exports.isLoggedIn = (req,res,next)=>{
  if(!req.user){   
    req.flash("error","You must be Logged in to continue.");
    return res.redirect("/logInForm");
  }
  next();
}

module.exports.isAdmin = (req,res,next)=>{
  if(!req.user || !req.user.isAdmin){   
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
      req.flash("error", getPurchaseValidationMessage(error));
      return res.redirect(req.get("Referrer") || "/");
    }

    req.body = value;
    next();
};
