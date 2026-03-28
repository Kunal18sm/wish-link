const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const gameSchema = new Schema({
  userName : {
    type: String,
    required: true,
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

gameSchema.index({ userScore: -1 });
gameSchema.index({ author: 1 }, { unique: true });

module.exports = mongoose.model("game", gameSchema);
