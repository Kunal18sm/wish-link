const CLOUDINARY_UPLOAD_SEGMENT = "/upload/";

function toOptimizedCloudinaryUrl(url, transformations = []) {
  const rawUrl = typeof url === "string" ? url.trim() : "";
  if (!rawUrl || !rawUrl.includes("res.cloudinary.com") || !rawUrl.includes(CLOUDINARY_UPLOAD_SEGMENT)) {
    return rawUrl;
  }

  const rules = transformations.filter(Boolean).join(",");
  if (!rules) {
    return rawUrl;
  }

  return rawUrl.replace(CLOUDINARY_UPLOAD_SEGMENT, `${CLOUDINARY_UPLOAD_SEGMENT}${rules}/`);
}

module.exports = {
  toOptimizedCloudinaryUrl,
};
