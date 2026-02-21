const Joi = require('joi');
const objectIdPattern = /^[0-9a-fA-F]{24}$/;

module.exports.purchaseSchema = Joi.object({
  purchase: Joi.object({
    purchaseId: Joi.string().optional(),
    webUrl: Joi.string().optional(),
    sender: Joi.string().trim().allow("", null).default("Anonymous"),
    receiver: Joi.string().trim().allow("", null).default(""),
    price: Joi.alternatives()
      .try(Joi.number().min(0), Joi.string().trim().allow(""))
      .default(0),

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

    specialMsg: Joi.string().trim().max(350).allow("").default("Best wishes!"),

    webName: Joi.string().trim().allow("", null).optional(),

    isLive: Joi.boolean().optional(),

    author: Joi.string().pattern(objectIdPattern).optional(),

    date: Joi.date().optional(),

    adminInterected: Joi.boolean().optional(),

    isTemporary: Joi.boolean().truthy("true").falsy("false").default(true)
  }).default({}).unknown(true)
}).required().unknown(true);
