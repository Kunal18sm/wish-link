const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const purchasedWebSchema = new Schema({
  purchaseId: {
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
    type: Number,
    default: 0,
  },

  purchaseMode: {
    type: String,
    enum: ["upi", "coins"],
    default: "upi",
  },

  paidCredits: {
    type: Number,
    default: 0,
    min: 0,
  },

  expiresAt: {
    type: Date,
    default: null,
  },

  images: [
    {
      url: String,
      filename: String,
    },
  ],

  paymentProofUrl: {
    url: String,
    filename: String,
  },

  specialMsg: [
    {
      type: String,
      required: true,
      maxlength: 350,
    },
  ],

  webName: {
    type: String,
    required: true,
  },

  isLive: {
    type: Boolean,
    default: false,
  },

  author: {
    type: Schema.Types.ObjectId,
    ref: "user",
  },

  date: {
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
  },
});

purchasedWebSchema.index({ purchaseId: 1 });
purchasedWebSchema.index({ author: 1, date: -1 });
purchasedWebSchema.index({ adminInterected: 1, _id: -1 });
purchasedWebSchema.index({ isLive: 1, _id: -1 });
purchasedWebSchema.index({ date: 1, isTemporary: 1 });
purchasedWebSchema.index({ expiresAt: 1, isLive: 1 });

module.exports = purchasedWebSchema;
