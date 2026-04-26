const mongoose = require("mongoose");

const { Schema } = mongoose;

const SiteConfigSchema = new Schema(
  {
    configKey: {
      type: String,
      trim: true,
      default: "global",
      unique: true,
      index: true,
    },
    showTemplateCoinPrice: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteConfig", SiteConfigSchema);
