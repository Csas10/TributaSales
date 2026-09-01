const Category = require("../models/Category");
const Product = require("../models/Product");
const { requireDatabase } = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId,
  normalizeSlug,
  validateCategoryInput
} = require("../utils/validation");

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.status = 409;
  }
}

class CategoryService {
  constructor({
    CategoryModel = Category,
    ProductModel = Product,
    connect = requireDatabase
  } = {}) {
    this.CategoryModel = CategoryModel;
    this.ProductModel = ProductModel;
    this.connect = connect;
  }

  async list() {
    await this.connect();
    return this.CategoryModel.find();
  }

  async get(id) {
    const categoryId = normalizeObjectId(id, "A categoria");
    await this.connect();
    const category = await this.CategoryModel.findById(categoryId);
    if (!category) throw new NotFoundError("Categoria não encontrada.");
    return category;
  }

  async create(payload) {
    const input = validateCategoryInput(payload);
    await this.connect();
    try {
      return await this.CategoryModel.create({
        ...input,
        slug: normalizeSlug(input.name)
      });
    } catch (error) {
      if (error && error.code === 11000) {
        throw new ConflictError("A categoria ou slug já existe.");
      }
      throw error;
    }
  }

  async update(id, payload) {
    const categoryId = normalizeObjectId(id, "A categoria");
    const input = validateCategoryInput(payload);
    await this.connect();
    try {
      const category = await this.CategoryModel.findOneAndUpdate(
        { _id: categoryId },
        { ...input, slug: normalizeSlug(input.name) },
        { new: true, runValidators: true }
      );
      if (!category) throw new NotFoundError("Categoria não encontrada.");
      return category;
    } catch (error) {
      if (error && error.code === 11000) {
        throw new ConflictError("A categoria ou slug já existe.");
      }
      throw error;
    }
  }

  async remove(id) {
    const categoryId = normalizeObjectId(id, "A categoria");
    await this.connect();
    const category = await this.CategoryModel.findById(categoryId);
    if (!category) throw new NotFoundError("Categoria não encontrada.");
    if (await this.ProductModel.exists({ category: categoryId })) {
      throw new ConflictError("A categoria está em uso por um produto.");
    }
    await this.CategoryModel.findByIdAndDelete(categoryId);
  }
}

module.exports = { CategoryService, ConflictError };
