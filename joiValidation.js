const Joi = require('joi');
const objectIdPattern = /^[0-9a-fA-F]{24}$/;

module.exports.purchaseSchema = Joi.object({
  purchase: Joi.object({
    purchaseId: Joi.string().optional(),
    webUrl: Joi.string().optional(),
    sender: Joi.string().required(),
    receiver: Joi.string().allow("", null),
    price: Joi.number().min(0).default(0),

    images: Joi.array().items(
      Joi.object({
        url: Joi.string().uri().required(),
        filename: Joi.string().required()
      })
    ).optional(),

    paymentProofUrl: Joi.object({
      url: Joi.string().uri().required(),
      filename: Joi.string().required()
    }).optional(),

    specialMsg: Joi.string().max(350).required(),

    webName: Joi.string().required(),

    isLive: Joi.boolean().optional(),

    author: Joi.string().pattern(objectIdPattern).optional(),

    date: Joi.date().optional(),

    adminInterected: Joi.boolean().optional(),

    isTemporary: Joi.boolean().optional()
  }).required()
});
