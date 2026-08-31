const mongoose = require("mongoose");
const { Schema } = mongoose;

const adminNotificationSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      default: "general",
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    link: {
      type: String,
      default: "/requests/dashboard",
    },
    entityType: {
      type: String,
      default: "",
    },
    entityId: {
      type: String,
      default: "",
    },
    dedupeKey: {
      type: String,
      default: "",
    },
    actor: {
      type: Schema.Types.Mixed,
      default: null,
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
    read: {
      type: Boolean,
      default: false,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminNotificationSchema.index({ createdAt: -1 });
adminNotificationSchema.index({ read: 1, isRead: 1 });

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);