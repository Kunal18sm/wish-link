const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const WebSampleSchema = new Schema({
  webName: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "New Website",
  },
  priceForTemporary: {
    type: Number,
    default: 0,
  },
  imageUrl: {
    url: String,
    filename: String
  },
  webUrl: {
    type: String,
    required: true,
  },
  isLive: {
    type: Boolean,
    default: true,
  },
  soldOut: {
    type: Number,
    default: 0,
  },
  imageNeeded: {
    type: Number,
    default: 5,
  },
  tags: [{
    type: String,
  }],

  articleTitle: String,

  articleContent: String,
  
  priceForPermanent: {
    type: Number,
    default: 39,
  },
  previewCredits: {
    type: Number,
    default: 1,
    min: 0,
  },
  purchaseCredits: {
    type: Number,
    default: 1,
    min: 0,
  },
  priority: {
    type: Number,
    default: 0,
  },

})

WebSampleSchema.index({ priority: -1, _id: -1 });
WebSampleSchema.index({ tags: 1, priority: -1, _id: -1 });

module.exports = mongoose.model("WebSamples", WebSampleSchema);
