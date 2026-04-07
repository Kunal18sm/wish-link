const mongoose = require("mongoose");

const { Schema } = mongoose;

const adminPushSubscriptionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 1200,
    },
    expirationTime: {
      type: Date,
      default: null,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
        trim: true,
        maxlength: 300,
      },
      auth: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
      },
    },
    userAgent: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminPushSubscriptionSchema.index({ user: 1, updatedAt: -1 });
adminPushSubscriptionSchema.index({ lastUsedAt: -1 });

module.exports = mongoose.model("AdminPushSubscription", adminPushSubscriptionSchema);
