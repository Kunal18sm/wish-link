const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const feedbackSchema = Schema({
  feedbackmsg: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  userName:{
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: "user",
  },
})


module.exports = mongoose.model("feedback", feedbackSchema);