const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const gameTournamentSchema = new Schema(
  {
    gameName: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["Live", "Coming Soon", "Ended"],
      default: "Coming Soon",
    },
    thumbnailUrl: {
      type: String,
      required: true,
      trim: true,
    },
    playUrl: {
      type: String,
      default: "",
      trim: true,
    },
    leaderboardUrl: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

gameTournamentSchema.index({ isActive: 1, priority: 1, createdAt: -1 });

module.exports = mongoose.model("GameTournament", gameTournamentSchema);
