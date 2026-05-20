const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const messageSchema = new Schema(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "admin", "bot"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1500,
    },
  },
  { _id: true }
);

const chatSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    messages: [messageSchema],
    lastMessage: {
      type: String,
      default: "",
      trim: true,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    adminUnreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    userUnreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    adminTakeover: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

chatSchema.index({ lastMessageAt: -1, adminUnreadCount: -1 });

module.exports = mongoose.model("Chat", chatSchema);
