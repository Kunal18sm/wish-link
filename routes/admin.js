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
const USERS_PAGE_LIMIT = 20;

function getRequestScope(req) {
  const rawScope = String(req.query.scope || REQUEST_SCOPE.DEFAULT).toLowerCase();
  if (rawScope === REQUEST_SCOPE.PERMANENT) return REQUEST_SCOPE.PERMANENT;
  return REQUEST_SCOPE.DEFAULT;
}

function parseUsersPage(rawPage) {
  const parsedPage = Number.parseInt(rawPage, 10);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) return 1;
  return Math.min(parsedPage, 500);
}

function escapeRegex(rawValue) {
  return String(rawValue || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSafeReturnPath(rawPath) {
  const fallbackPath = "/requests/users";
  const candidatePath = String(rawPath || "").trim();

  if (!candidatePath.startsWith("/requests/users")) return fallbackPath;
  return candidatePath;
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

async function buildActiveLinksCountMap(req, authorIds) {
  const countMap = new Map(authorIds.map((authorId) => [String(authorId), 0]));
  if (!authorIds.length) return countMap;

  const defaultCounts = await purchasedWeb.aggregate([
    { $match: { author: { $in: authorIds } } },
    { $group: { _id: "$author", count: { $sum: 1 } } },
  ]);

  defaultCounts.forEach((entry) => {
    const key = String(entry._id);
    countMap.set(key, (countMap.get(key) || 0) + Number(entry.count || 0));
  });

  const permanentModel = req.app.locals.permanentPurchasedWeb;
  if (permanentModel) {
    const permanentCounts = await permanentModel.aggregate([
      { $match: { author: { $in: authorIds } } },
      { $group: { _id: "$author", count: { $sum: 1 } } },
    ]);

    permanentCounts.forEach((entry) => {
      const key = String(entry._id);
      countMap.set(key, (countMap.get(key) || 0) + Number(entry.count || 0));
    });
  }

  return countMap;
}

async function fetchAdminUsersPage(req, searchTerm, page) {
  const normalizedSearchTerm = String(searchTerm || "")
    .trim()
    .slice(0, 64);
  const skip = (page - 1) * USERS_PAGE_LIMIT;
  const matchStage = {};

  if (normalizedSearchTerm) {
    matchStage.username = {
      $regex: escapeRegex(normalizedSearchTerm),
      $options: "i",
    };
  }

  const usersList = await user.aggregate([
    { $match: matchStage },
    { $sort: { _id: -1 } },
    { $skip: skip },
    { $limit: USERS_PAGE_LIMIT + 1 },
    {
      $project: {
        username: 1,
        email: 1,
        winnerCount: 1,
        isAdmin: 1,
        date: 1,
        totalLinksCreated: {
          $size: {
            $ifNull: ["$webCollection", []],
          },
        },
      },
    },
  ]);

  const hasMore = usersList.length > USERS_PAGE_LIMIT;
  const pagedUsers = usersList.slice(0, USERS_PAGE_LIMIT);
  const authorIds = pagedUsers.map((entry) => entry._id);
  const activeLinksCountMap = await buildActiveLinksCountMap(req, authorIds);

  const usersWithCounts = pagedUsers.map((entry) => ({
    id: String(entry._id),
    username: entry.username,
    email: entry.email,
    winnerCount: Number(entry.winnerCount || 0),
    isAdmin: Boolean(entry.isAdmin),
    date: entry.date,
    totalLinksCreated: Number(entry.totalLinksCreated || 0),
    activeLinksCount: Number(activeLinksCountMap.get(String(entry._id)) || 0),
  }));

  return {
    users: usersWithCounts,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    searchTerm: normalizedSearchTerm,
    page,
  };
}

// get default requests page
router.get(
  "/users",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const searchTerm = String(req.query.search || "")
      .trim()
      .slice(0, 64);
    const page = parseUsersPage(req.query.page);
    const usersPageData = await fetchAdminUsersPage(req, searchTerm, page);

    return res.render("adminUsers", {
      adminUsers: usersPageData.users,
      searchTerm: usersPageData.searchTerm,
      hasMore: usersPageData.hasMore,
      nextPage: usersPageData.nextPage,
      currentPage: usersPageData.page,
      pageLimit: USERS_PAGE_LIMIT,
      title: "Manage Users - VishLink Admin",
      description: "View, search and manage VishLink users from one place.",
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/users/load",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const searchTerm = String(req.query.search || "")
      .trim()
      .slice(0, 64);
    const page = parseUsersPage(req.query.page);
    const usersPageData = await fetchAdminUsersPage(req, searchTerm, page);

    return res.json({
      ok: true,
      users: usersPageData.users,
      hasMore: usersPageData.hasMore,
      nextPage: usersPageData.nextPage,
      currentPage: usersPageData.page,
    });
  })
);

router.post(
  "/users/:id/credits",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    const returnTo = getSafeReturnPath(req.body?.returnTo);
    const winnerCount = Number.parseInt(req.body?.winnerCount, 10);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid user id.");
      return res.redirect(returnTo);
    }

    if (!Number.isInteger(winnerCount) || winnerCount < 0 || winnerCount > 1000000) {
      req.flash("error", "Credits must be a number between 0 and 1000000.");
      return res.redirect(returnTo);
    }

    const updatedUser = await user.findByIdAndUpdate(
      req.params.id,
      { winnerCount },
      { new: true }
    );

    if (!updatedUser) {
      req.flash("error", "User not found.");
      return res.redirect(returnTo);
    }

    req.flash("success", `Credits updated for @${updatedUser.username}.`);
    return res.redirect(returnTo);
  })
);

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid user id.");
      return res.redirect("/requests/users");
    }

    const profileUser = await user.findById(req.params.id);
    if (!profileUser) {
      req.flash("error", "User not found.");
      return res.redirect("/requests/users");
    }

    const purchasedLinks = await loadMergedPurchases(req, req.params.id);
    const viewHistory = false;

    res.render("profile", {
      profileUser,
      totalLinksCreated: profileUser.webCollection?.length || 0,
      purchasedLinks,
      viewHistory,
      title: `${profileUser.username} - User Profile`,
      description: `Admin view for ${profileUser.username} profile and links.`,
      canonical: `https://wishlink-7j0a.onrender.com/requests/userProfile/${profileUser._id}`,
      robots: "noindex, nofollow",
    });
  })
);

router.get(
  "/userProfileHistory/:id",
  isLoggedIn,
  isAdmin,
  wrapAsync(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      req.flash("error", "Invalid user id.");
      return res.redirect("/requests/users");
    }

    const profileUser = await user.findById(req.params.id);
    if (!profileUser) {
      req.flash("error", "User not found.");
      return res.redirect("/requests/users");
    }

    const purchasedLinks = profileUser.webCollection || [];
    const viewHistory = true;

    res.render("profile", {
      profileUser,
      totalLinksCreated: profileUser.webCollection?.length || 0,
      purchasedLinks,
      viewHistory,
      title: `${profileUser.username} - User History`,
      description: `Admin history view for ${profileUser.username}.`,
      canonical: `https://wishlink-7j0a.onrender.com/requests/userProfileHistory/${profileUser._id}`,
      robots: "noindex, nofollow",
    });
  })
);

module.exports = router;
