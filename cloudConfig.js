const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

function getFirstEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

const primaryCloudinaryOptions = {
  cloud_name: getFirstEnv("CLOUD_NAME"),
  api_key: getFirstEnv("CLOUD_API_KEY"),
  api_secret: getFirstEnv("CLOUD_API_SECRET"),
};

cloudinary.config({
  cloud_name: primaryCloudinaryOptions.cloud_name,
  api_key: primaryCloudinaryOptions.api_key,
  api_secret: primaryCloudinaryOptions.api_secret,
});

function resolvePermanentCloudinaryOptions() {
  const cloudName = getFirstEnv(
    "PERMANENT_CLOUD_NAME",
    "PERMANENT_CLOUDINARY_NAME",
    "PERMANENT_CLOUDINARY_CLOUD_NAME",
    "SECONDARY_CLOUD_NAME"
  );
  const apiKey = getFirstEnv(
    "PERMANENT_CLOUD_API_KEY",
    "PERMANENT_CLOUDINARY_API_KEY",
    "SECONDARY_CLOUD_API_KEY"
  );
  const apiSecret = getFirstEnv(
    "PERMANENT_CLOUD_API_SECRET",
    "PERMANENT_CLOUDINARY_API_SECRET",
    "SECONDARY_CLOUD_API_SECRET"
  );

  if (cloudName && apiKey && apiSecret) {
    return {
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    };
  }

  if (
    primaryCloudinaryOptions.cloud_name &&
    primaryCloudinaryOptions.api_key &&
    primaryCloudinaryOptions.api_secret
  ) {
    return { ...primaryCloudinaryOptions };
  }

  return null;
}

const permanentCloudinaryOptions = resolvePermanentCloudinaryOptions();
const PERMANENT_CLOUDINARY_FOLDER = getFirstEnv(
  "PERMANENT_CLOUDINARY_FOLDER",
  "PERMANENT_CLOUD_FOLDER"
) || "wishLink_permanent";

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "wishLink_dev",
    allowed_formats: ["png", "jpg", "jpeg", "webp"],
    resource_type: "image",
    transformation: [
      {
        quality: "80",
        fetch_format: "auto",
        flags: "strip_profile",
        width: 1200,
        crop: "limit",
      },
    ],
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
      folder: PERMANENT_CLOUDINARY_FOLDER,
      allowed_formats: ["png", "jpg", "jpeg", "webp"],
      resource_type: "image",
      transformation: [
        {
          quality: "80",
          fetch_format: "auto",
          flags: "strip_profile",
          width: 1200,
          crop: "limit",
        },
      ],
    };
  },
});

module.exports = {
  cloudinary,
  storage,
  permanentStorage,
  permanentCloudinaryOptions,
};
