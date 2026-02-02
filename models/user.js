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
});

userSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model("User", userSchema);
