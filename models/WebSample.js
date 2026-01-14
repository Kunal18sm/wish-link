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
    default:0,
  },
  imageNeeded:{
    type: Number,
    default:5,
  }

})

module.exports = mongoose.model("WebSamples", WebSampleSchema);