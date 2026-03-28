const mongoose = require("mongoose");

const { Schema } = mongoose;

const BannerSlideSchema = new Schema(
  {
    title: {
      type: String,
      trim: true,
      default: "",
    },
    imageUrl: {
      type: String,
      trim: true,
      required: true,
    },
    imagePublicId: {
      type: String,
      trim: true,
      default: "",
    },
    linkUrl: {
      type: String,
      trim: true,
      default: "/",
    },
    altText: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const BannerConfigSchema = new Schema(
  {
    page: {
      type: String,
      enum: ["home", "collection"],
      required: true,
      unique: true,
      index: true,
    },
    slides: {
      type: [BannerSlideSchema],
      default: [],
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BannerConfig", BannerConfigSchema);
