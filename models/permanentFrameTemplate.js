const frameTemplateSchema = require("./schemas/frameTemplateSchema.js");

function getPermanentFrameTemplateModel(connection) {
  if (!connection) {
    throw new Error("Permanent DB connection is required.");
  }

  if (connection.models.PermanentFrameTemplate) {
    return connection.models.PermanentFrameTemplate;
  }

  return connection.model(
    "PermanentFrameTemplate",
    frameTemplateSchema,
    "permanentFrameTemplates"
  );
}

module.exports = getPermanentFrameTemplateModel;
