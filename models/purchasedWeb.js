const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const purchasedWebSchema = new Schema({
  purchaseId:{
    type: String,
    required: true,
  },

  webUrl: {
    type: String,
    required: true,
  },

  sender: {
    type: String,
    required: true,
  },

  receiver: {
    type: String,
  },

  price: {
    type: String,
    default: "0",
  },

  images: [{
    url: String,
    filename: String
  }],

  paymentProofUrl: {
    url: String,
    filename: String
  },

  specialMsg: [{
    type: String,
    required: true,
    maxlength: 350
  }],

  webName: {
    type: String,
    required: true,
  },

  isLive: {
    type: Boolean,
    default: false,
  },

  author:{
    type: Schema.Types.ObjectId,
    ref: "user",
  },

  date:{
    type: Date,
    default: Date.now,
  },

  adminInterected: {
    type: Boolean,
    default: false,
  },

  isTemporary: {
    type: Boolean,
    default: true,
  }

})

module.exports = mongoose.model("PurchasedWeb", purchasedWebSchema);