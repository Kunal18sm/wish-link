const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const gameSchema = new Schema({
  userName : {
    type: String,
    require: true,
  },

  userScore: {
    type: Number,
    default: 0,
  },

  author:{
    type: Schema.Types.ObjectId,
    ref: "user",
  },

})

module.exports = mongoose.model("game", gameSchema);