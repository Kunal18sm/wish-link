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

function wantsJson(req) {
  const accept = req.headers?.accept || "";
  return req.xhr || accept.includes("application/json");
}

module.exports.isLoggedIn = (req,res,next)=>{
  if(!req.user){   
    if (wantsJson(req)) {
      return res.status(401).json({ ok: false, error: "Session expired. You must log in again." });
    }
    req.flash("error","You must be Logged in to continue.");
    return res.redirect("/logInForm");
  }
  next();
}

module.exports.isAdmin = (req,res,next)=>{
  if(!req.user || !req.user.isAdmin){   
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, error: "Admin access required. Please log in as admin." });
    }
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
