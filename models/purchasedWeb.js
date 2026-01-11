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

  webName: {
    type: String,
    required: true,
  },

  isLive: {
    type: Boolean,
    default: true,
  },

  author:{
    type: Schema.Types.ObjectId,
    ref: "user",
  }
})

module.exports = mongoose.model("PurchasedWeb", purchasedWebSchema);