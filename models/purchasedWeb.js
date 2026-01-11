const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const purchasedWebSchema = new Schema({
  webId: {
    type: String,
    required: true,
  },

  sender: {
    type: String,
    required: true,
  },

  receiver: {
    type: String,
    required: true,
  },

  price: {
    type: String,
    default: "0",
  },

  imageUrl: [{
    type: String,
    required: true,
  }],

  paymentProofUrl: {
    type: String,
  },

  specialMsg: [{
    type: String,
    required: true,
    maxlength: 150
  }],

  webUrl: {
    type: String,
  },

  isLive: {
    type: Boolean,
    default: true,
  },
})

module.exports = mongoose.model("PurchasedWeb", purchasedWebSchema);