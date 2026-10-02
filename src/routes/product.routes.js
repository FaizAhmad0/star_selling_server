import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Category, Product, ProductColor, ProductVariant } from "../models/product.model.js";
import asyncHandler from "../utils/async-handler.js";
import AppError from "../utils/app-error.js";
import { sendSuccess } from "../utils/response.js";

const router = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i).optional();
const schema = z.object({ category: id, product: id, search: z.string().trim().max(150).optional(), color: z.string().trim().max(80).optional(), size: z.string().trim().max(40).optional(), sort: z.enum(["newest", "name", "price-asc", "price-desc"]).default("newest"), page: z.coerce.number().int().min(1).max(100000).default(1) });
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", asyncHandler(async (req, res) => {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) throw new AppError("Invalid catalog filters", 400, parsed.error.flatten());
  const q = parsed.data;
  const match = {};
  if (q.category) match.categoryId = new Types.ObjectId(q.category);
  if (q.product) match._id = new Types.ObjectId(q.product);
  if (q.search) match.title = { $regex: escapeRegex(q.search), $options: "i" };
  const pipeline = [
    { $match: match },
    { $lookup: { from: ProductColor.collection.name, localField: "_id", foreignField: "productId", as: "colors" } },
    { $lookup: { from: ProductVariant.collection.name, localField: "colors._id", foreignField: "colorId", as: "variants" } },
    { $lookup: { from: Category.collection.name, localField: "categoryId", foreignField: "_id", as: "category" } },
    { $set: { category: { $arrayElemAt: ["$category", 0] } } },
  ];
  if (q.color) pipeline.push({ $set: { colors: { $filter: { input: "$colors", as: "c", cond: { $eq: ["$$c.color", q.color.toLowerCase()] } } } } });
  // Both filters must belong to the same color/size variant.
  pipeline.push({ $set: { variants: { $filter: { input: "$variants", as: "v", cond: { $and: [{ $in: ["$$v.colorId", "$colors._id"] }, ...(q.size ? [{ $eq: ["$$v.size", q.size.toUpperCase()] }] : [])] } } } } });
  if (q.color || q.size) pipeline.push({ $match: { ...(q.color ? { "colors.0": { $exists: true } } : {}), ...(q.size ? { "variants.0": { $exists: true } } : {}) } });
  pipeline.push({ $set: { price: { $min: "$variants.estimatedSellingPrice" } } });
  const sort = { newest: { createdAt: -1, _id: 1 }, name: { title: 1, _id: 1 }, "price-asc": { price: 1, _id: 1 }, "price-desc": { price: -1, _id: 1 } }[q.sort];
  pipeline.push({ $facet: { total: [{ $count: "count" }], products: [{ $sort: sort }, { $skip: (q.page - 1) * 24 }, { $limit: 24 }, { $project: {
    title: 1, shortDescription: 1, longDescription: 1, bulletPoints: 1, materials: 1, packageContents: 1, category: { _id: 1, name: 1 }, price: 1,
    colors: { _id: 1, color: 1, images: 1 }, variants: { _id: 1, colorId: 1, size: 1, sku: 1, stock: 1, estimatedSellingPrice: 1 },
  } }] } });
  const [result, categories, colors, sizes, banners] = await Promise.all([
    Product.aggregate(pipeline), Category.find().select("name").sort({ name: 1 }).lean(), ProductColor.distinct("color"), ProductVariant.distinct("size"),
    ProductColor.find({ "images.0": { $exists: true } }).select("images productId").sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  sendSuccess(res, { data: { products: result[0].products, total: result[0].total[0]?.count ?? 0, page: q.page, pageSize: 24, categories, colors: colors.sort(), sizes: sizes.sort(), banners: banners.map((b) => ({ image: b.images[0], product: b.productId })) } });
}));
export default router;
