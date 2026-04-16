const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose").default;

const userSchema = new Schema({
  email: {
    type: String,
    unique: true,
    required: true,
  },
  
  isAdmin: {
    type: Boolean,
    default: false
  },

  webCollection: [{
    webName: String,
    dateOfBuy: Date,
    receiver: String,
    price: Number,
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
    isFakePaymentProof: {
      type: Boolean,
      default: false,
    },
    adminFakePaymentNote: {
      type: String,
      default: "",
    },
    adminActionAt: Date,
    permanentLink: String,
    paymentProofUrl: {
      url: String,
      filename: String
    },
    purchasedId:{
      type: Schema.Types.ObjectId,
      ref: "purchasedWeb",
    },
  }],

  date:{
    type: Date,
    default: Date.now,
  }, 

  winnerCount: {
    type: Number,
    default: 0,
  },
  lightPalette: {
    type: String,
    enum: ["blue", "pink"],
    default: "blue",
  },
  dailyCreditClaim: {
    dateKey: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      default: 0,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
  },
  
});

userSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model("User", userSchema);
