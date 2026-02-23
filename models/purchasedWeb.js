const mongoose = require("mongoose");
const purchasedWebSchema = require("./schemas/purchasedWebSchema.js");

module.exports = mongoose.model("PurchasedWeb", purchasedWebSchema);
