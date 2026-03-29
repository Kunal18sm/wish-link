const mongoose = require("mongoose");

const { Schema } = mongoose;

const FrameImageSchema = new Schema(
  {
    url: {
      type: String,
      trim: true,
      required: true,
    },
    publicId: {
      type: String,
      trim: true,
      required: true,
    },
    width: {
      type: Number,
      default: 0,
    },
    height: {
      type: Number,
      default: 0,
    },
    format: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const FrameCanvasSchema = new Schema(
  {
    width: {
      type: Number,
      required: true,
      min: 100,
      max: 5000,
    },
    height: {
      type: Number,
      required: true,
      min: 100,
      max: 5000,
    },
  },
  { _id: false }
);

const ImageSlotSchema = new Schema(
  {
    key: {
      type: String,
      trim: true,
      required: true,
    },
    label: {
      type: String,
      trim: true,
      default: "",
    },
    x: {
      type: Number,
      required: true,
      min: 0,
      max: 5000,
    },
    y: {
      type: Number,
      required: true,
      min: 0,
      max: 5000,
    },
    width: {
      type: Number,
      required: true,
      min: 20,
      max: 5000,
    },
    height: {
      type: Number,
      required: true,
      min: 20,
      max: 5000,
    },
    borderRadius: {
      type: Number,
      default: 0,
      min: 0,
      max: 1000,
    },
    zIndex: {
      type: Number,
      default: 0,
      min: 0,
      max: 2000,
    },
    rotation: {
      type: Number,
      default: 0,
      min: -360,
      max: 360,
    },
  },
  { _id: false }
);

const TextLayerSchema = new Schema(
  {
    key: {
      type: String,
      trim: true,
      required: true,
    },
    value: {
      type: String,
      trim: true,
      default: "",
      maxlength: 240,
    },
    editable: {
      type: Boolean,
      default: true,
    },
    x: {
      type: Number,
      required: true,
      min: 0,
      max: 5000,
    },
    y: {
      type: Number,
      required: true,
      min: 0,
      max: 5000,
    },
    width: {
      type: Number,
      default: 200,
      min: 20,
      max: 5000,
    },
    color: {
      type: String,
      trim: true,
      default: "#ffffff",
      maxlength: 30,
    },
    fontSize: {
      type: Number,
      default: 28,
      min: 8,
      max: 300,
    },
    fontFamily: {
      type: String,
      trim: true,
      default: "Poppins",
      maxlength: 80,
    },
    fontWeight: {
      type: String,
      trim: true,
      default: "600",
      maxlength: 20,
    },
    textAlign: {
      type: String,
      enum: ["left", "center", "right"],
      default: "center",
    },
    lineHeight: {
      type: Number,
      default: 1.2,
      min: 0.6,
      max: 3,
    },
    letterSpacing: {
      type: Number,
      default: 0,
      min: -10,
      max: 30,
    },
    zIndex: {
      type: Number,
      default: 2,
      min: 0,
      max: 2000,
    },
    height: {
      type: Number,
      default: 120,
      min: 20,
      max: 5000,
    },
    rotation: {
      type: Number,
      default: 0,
      min: -360,
      max: 360,
    },
  },
  { _id: false }
);

const frameTemplateSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      maxlength: 120,
    },
    slug: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      maxlength: 140,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    frameImage: {
      type: FrameImageSchema,
      required: true,
    },
    canvas: {
      type: FrameCanvasSchema,
      required: true,
    },
    imageSlots: {
      type: [ImageSlotSchema],
      validate: {
        validator: (slots) => Array.isArray(slots) && slots.length > 0,
        message: "At least one image slot is required.",
      },
      default: [],
    },
    texts: {
      type: [TextLayerSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

frameTemplateSchema.index({ isActive: 1, createdAt: -1 });

module.exports = frameTemplateSchema;
