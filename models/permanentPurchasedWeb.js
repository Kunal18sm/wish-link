const purchasedWebSchema = require("./schemas/purchasedWebSchema.js");

function getPermanentPurchasedWebModel(connection) {
  if (!connection) {
    throw new Error("Permanent DB connection is required.");
  }

  if (connection.models.PermanentPurchasedWeb) {
    return connection.models.PermanentPurchasedWeb;
  }

  return connection.model(
    "PermanentPurchasedWeb",
    purchasedWebSchema,
    "permanentPurchasedWebs"
  );
}

module.exports = getPermanentPurchasedWebModel;
