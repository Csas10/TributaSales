const Product = require("../models/Product");
const Category = require("../models/Category");
const { requireDatabase } = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId,
  validateProductInput
} = require("../utils/validation");

class CatalogConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogConflictError";
    this.status = 409;
  }
}

async function populateCategory(query) {
  if (query && typeof query.populate === "function") {
    return query.populate({
      path: "category",
      select: "_id name slug"
    });
  }
  return query;
}

class CatalogProductService {
  constructor({
    ProductModel = Product,
    CategoryModel = Category,
    connect = requireDatabase
  } = {}) {
    this.ProductModel = ProductModel;
    this.CategoryModel = CategoryModel;
    this.connect = connect;
  }

  async ensureActiveCategory(categoryId) {
    const category = await this.CategoryModel.findById(categoryId);
    if (!category) throw new NotFoundError("Categoria não encontrada.");
    if (!category.active) throw new CatalogConflictError("Categoria inativa.");
  }

  async list() {
    await this.connect();
    return populateCategory(this.ProductModel.find());
  }

  async get(id) {
    const productId = normalizeObjectId(id, "O produto");
    await this.connect();
    const product = await populateCategory(this.ProductModel.findById(productId));
    if (!product) throw new NotFoundError("Produto não encontrado.");
    return product;
  }

  async create(payload) {
    const input = validateProductInput(payload);
    await this.connect();
    await this.ensureActiveCategory(input.category);
    return this.ProductModel.create(input);
  }

  async update(id, payload) {
    const productId = normalizeObjectId(id, "O produto");
    const input = validateProductInput(payload);
    await this.connect();
    await this.ensureActiveCategory(input.category);
    const product = await this.ProductModel.findOneAndUpdate(
      { _id: productId },
      input,
      { new: true, runValidators: true }
    );
    if (!product) throw new NotFoundError("Produto não encontrado.");
    return product;
  }

  async remove(id) {
    const productId = normalizeObjectId(id, "O produto");
    await this.connect();
    const product = await this.ProductModel.findByIdAndDelete(productId);
    if (!product) throw new NotFoundError("Produto não encontrado.");
  }
}

module.exports = { CatalogConflictError, CatalogProductService, populateCategory };
