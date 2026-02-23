const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

const permanentCloudinaryOptions =
  process.env.PERMANENT_CLOUD_NAME &&
  process.env.PERMANENT_CLOUD_API_KEY &&
  process.env.PERMANENT_CLOUD_API_SECRET
    ? {
        cloud_name: process.env.PERMANENT_CLOUD_NAME,
        api_key: process.env.PERMANENT_CLOUD_API_KEY,
        api_secret: process.env.PERMANENT_CLOUD_API_SECRET,
      }
    : null;

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "wishLink_dev",
    allowed_formats: ["png", "jpg", "jpeg"],
  },
});

const permanentStorage = new CloudinaryStorage({
  cloudinary,
  params: () => {
    if (!permanentCloudinaryOptions) {
      throw new Error("Permanent Cloudinary is not configured.");
    }

    return {
      ...permanentCloudinaryOptions,
      folder: "wishLink_permanent",
      allowed_formats: ["png", "jpg", "jpeg"],
    };
  },
});

module.exports = {
  cloudinary,
  storage,
  permanentStorage,
  permanentCloudinaryOptions,
};
