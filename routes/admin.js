const express = require("express");
const mongoose = require("mongoose");

const purchasedWeb = require("../models/purchasedWeb.js");
const WebSample = require("../models/WebSample.js");
const user = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, isAdmin } = require("../middleware.js");
const { cloudinary, permanentCloudinaryOptions } = require("../cloudConfig.js");

const router = express.Router({ mergeParams: true });

const REQUEST_SCOPE = {
  DEFAULT: "default",
  PERMANENT: "permanent",
};

function getRequestScope(req) {
  const rawScope = String(req.query.scope || REQUEST_SCOPE.DEFAULT).toLowerCase();
  if (rawScope === REQUEST_SCOPE.PERMANENT) return REQUEST_SCOPE.PERMANENT;
  return REQUEST_SCOPE.DEFAULT;
}

function getRequestsHomePath(scope) {
  return scope === REQUEST_SCOPE.PERMANENT ? "/requests/permanent" : "/requests";
}

function getDeleteRedirectPath(req, scope) {
  if (!req.user?.isAdmin) return "/profile";
  return req.get("Referrer") || getRequestsHomePath(scope);
}

function getPurchaseModelByScope(req, scope) {
  if (scope === REQUEST_SCOPE.DEFAULT) return purchasedWeb;

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (!permanentModel) return null;
  return permanentModel;
}

function toScopedDocs(docs, scope) {
  return docs.map((doc) => ({
    ...(typeof doc.toObject === "function" ? doc.toObject() : doc),
    requestScope: scope,
  }));
}

async function loadMergedPurchases(req, authorId) {
  const normalLinks = await purchasedWeb.find({ author: authorId }).lean();
  const merged = normalLinks.map((item) => ({
    ...item,
    requestScope: REQUEST_SCOPE.DEFAULT,
  }));

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (permanentModel) {
    const permanentLinks = await permanentModel.find({ author: authorId }).lean();
    merged.push(
      ...permanentLinks.map((item) => ({
        ...item,
        requestScope: REQUEST_SCOPE.PERMANENT,
      }))
    );
  }

  merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return merged;
}

// get default requests page
router.get(
  "/",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const userPurchased = toScopedDocs(
      await purchasedWeb.find({ adminInterected: false }).sort({ _id: -1 }),
      REQUEST_SCOPE.DEFAULT
    );

    res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.DEFAULT,
      title: "Admin Requests - VishLink",
      description: "Admin panel to manage user purchase requests.",
      robots: "noindex, nofollow",
    });
  })
);

// get permanent requests page (secondary DB)
router.get(
  "/permanent",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const permanentModel = getPurchaseModelByScope(req, REQUEST_SCOPE.PERMANENT);
    if (!permanentModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    const userPurchased = toScopedDocs(
      await permanentModel.find({ adminInterected: false }).sort({ _id: -1 }),
      REQUEST_SCOPE.PERMANENT
    );

    return res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.PERMANENT,
      title: "Permanent Requests - VishLink",
      description: "Admin panel to manage permanent link purchase requests.",
      robots: "noindex, nofollow",
    });
  })
);

// request accepted
router.get(
  "/accept/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const requestedScope = getRequestScope(req);
    const permanentModel = getPurchaseModelByScope(req, REQUEST_SCOPE.PERMANENT);
    let requestScope = requestedScope;
    let PurchaseModel = getPurchaseModelByScope(req, requestScope);
    let redirectPath = getRequestsHomePath(requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    let web = await PurchaseModel.findByIdAndUpdate(id, {
      isLive: true,
      adminInterected: true,
    });

    // Safety fallback: if scope is missing in URL but id exists in permanent DB,
    // still apply accept action in second DB.
    if (!web && requestedScope === REQUEST_SCOPE.DEFAULT && permanentModel) {
      const permanentWeb = await permanentModel.findByIdAndUpdate(id, {
        isLive: true,
        adminInterected: true,
      });

      if (permanentWeb) {
        web = permanentWeb;
        requestScope = REQUEST_SCOPE.PERMANENT;
        PurchaseModel = permanentModel;
        redirectPath = getRequestsHomePath(requestScope);
      }
    }

    if (!web) {
      req.flash("error", "Request not found.");
      return res.redirect(redirectPath);
    }

    await WebSample.findOneAndUpdate({ webName: web.webName }, { $inc: { soldOut: 1 } });

    req.flash("success", "Request Accepted");
    return res.redirect(redirectPath);
  })
);

// get expired websites (temporary scope only)
router.get(
  "/expired",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const userPurchased = toScopedDocs(
      await purchasedWeb
        .find({ date: { $lte: tenDaysAgo }, isTemporary: true })
        .sort({ _id: -1 }),
      REQUEST_SCOPE.DEFAULT
    );

    res.render("requests", {
      userPurchased,
      requestScope: REQUEST_SCOPE.DEFAULT,
      title: "Expired Websites - Admin | VishLink",
      description: "Admin panel to manage expired websites.",
      robots: "noindex, nofollow",
    });
  })
);

// get all live websites (supports default/permanent scope)
router.get(
  "/allLive",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const requestScope = getRequestScope(req);
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    const userPurchased = toScopedDocs(
      await PurchaseModel.find({ isLive: true }).sort({ _id: -1 }),
      requestScope
    );

    return res.render("requests", {
      userPurchased,
      requestScope,
      title:
        requestScope === REQUEST_SCOPE.PERMANENT
          ? "Live Permanent Websites - Admin | VishLink"
          : "Live Websites - Admin | VishLink",
      description: "Admin panel to view all live websites.",
      robots: "noindex, nofollow",
    });
  })
);

// delete purchased web
router.delete(
  "/delete/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const requestScope = getRequestScope(req);
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);
    const redirectPath = getDeleteRedirectPath(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/profile");
    }

    const toDelete = await PurchaseModel.findById(req.params.id);
    if (!toDelete) {
      return res.redirect(redirectPath);
    }

    const isOwner = String(toDelete.author) === String(req.user._id);
    if (!req.user?.isAdmin && !isOwner) {
      req.flash("error", "You are not allowed to delete this link.");
      return res.redirect("/profile");
    }

    if (requestScope === REQUEST_SCOPE.PERMANENT && !permanentCloudinaryOptions) {
      req.flash("error", "Permanent cloud storage is not configured.");
      return res.redirect(redirectPath);
    }

    const destroyOptions =
      requestScope === REQUEST_SCOPE.PERMANENT ? permanentCloudinaryOptions : null;
    const allPublicIds = [
      ...(Array.isArray(toDelete.images) ? toDelete.images.map((image) => image.filename) : []),
      toDelete.paymentProofUrl?.filename,
    ].filter(Boolean);

    await Promise.allSettled(
      allPublicIds.map((publicId) =>
        destroyOptions
          ? cloudinary.uploader.destroy(publicId, destroyOptions)
          : cloudinary.uploader.destroy(publicId)
      )
    );

    await PurchaseModel.findByIdAndDelete(req.params.id);
    req.flash("success", "Deleted");
    return res.redirect(redirectPath);
  })
);

// edit permanent link
router.get(
  "/edit/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const requestScope = getRequestScope(req);
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    const userPurchased = await PurchaseModel.findById(req.params.id);
    if (!userPurchased) {
      req.flash("error", "Request not found.");
      return res.redirect(getRequestsHomePath(requestScope));
    }

    return res.render("edit", { userPurchased, requestScope });
  })
);

router.post(
  "/updateLink/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const requestScope = getRequestScope(req);
    const permanent = req.body.purchase || {};
    const PurchaseModel = getPurchaseModelByScope(req, requestScope);

    if (!PurchaseModel) {
      req.flash("error", "Permanent request database is not configured.");
      return res.redirect("/requests");
    }

    await PurchaseModel.findByIdAndUpdate(id, {
      webUrl: permanent.url,
      isLive: true,
      adminInterected: true,
    });

    const userId = permanent.author;
    if (userId && mongoose.Types.ObjectId.isValid(id)) {
      await user.updateOne(
        {
          _id: userId,
          "webCollection.purchasedId": new mongoose.Types.ObjectId(id),
        },
        {
          $set: {
            "webCollection.$.permanentLink": permanent.url,
          },
        }
      );
    }

    req.flash("success", "Permanent link updated");
    return res.redirect(getRequestsHomePath(requestScope));
  })
);

router.get(
  "/userProfile/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const purchasedLinks = await loadMergedPurchases(req, req.params.id);
    const viewHistory = false;

    res.render("profile", {
      purchasedLinks,
      viewHistory,
      title: "My Profile - VishLink",
      description: "Manage your VishLink profile and purchased wishing websites.",
      canonical: "https://wishlink-7j0a.onrender.com/profile",
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/userProfileHistory/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const userdata = await user.findById(req.params.id);
    const purchasedLinks = userdata?.webCollection || [];
    const viewHistory = true;

    res.render("profile", {
      purchasedLinks,
      viewHistory,
      title: "My Profile - VishLink Admin",
      description: "Manage your VishLink profile and purchased wishing websites.",
      canonical: "https://wishlink-7j0a.onrender.com/profile",
      robots: "noindex, nofollow",
    });
  })
);

module.exports = router;
