const mongoose = require("mongoose");

const { Schema } = mongoose;

const adminNotificationSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    link: {
      type: String,
      default: "/requests/dashboard",
      trim: true,
      maxlength: 400,
    },
    entityType: {
      type: String,
      default: "",
      trim: true,
      maxlength: 40,
    },
    entityId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    dedupeKey: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    actor: {
      id: {
        type: String,
        default: "",
        trim: true,
        maxlength: 80,
      },
      username: {
        type: String,
        default: "",
        trim: true,
        maxlength: 80,
      },
      email: {
        type: String,
        default: "",
        trim: true,
        maxlength: 160,
      },
    },
    meta: {
      type: Schema.Types.Mixed,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminNotificationSchema.index({ isRead: 1, updatedAt: -1 });
adminNotificationSchema.index({ type: 1, updatedAt: -1 });
adminNotificationSchema.index({ entityType: 1, entityId: 1, isRead: 1, updatedAt: -1 });
adminNotificationSchema.index({ dedupeKey: 1, isRead: 1, updatedAt: -1 });

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);
