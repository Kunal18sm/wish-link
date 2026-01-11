const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const WebSampleSchema = new Schema({
  webName: {
    type: String,
    required: true,
  },
  description:{
    type: String,
    default: "New Website",
  },
  price: {
    type: String,
    default:"0",
  },
  imageUrl: {
    type: String,
    required: true,
  },
  webUrl: {
    type: String,
    required: true,
  },
  isLive: {
    type: Boolean,
    default: true,
  },
})

module.exports = mongoose.model("WebSamples", WebSampleSchema);