const Product = require("../models/Product");
const User = require("../models/User");
const { requireDatabase } = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId
} = require("../utils/validation");

class FavoriteConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "FavoriteConflictError";
    this.status = 409;
  }
}

function identifier(value) {
  return value && typeof value.toString === "function" ? value.toString() : String(value);
}

function publicProduct(product) {
  if (!product) return null;
  const object = typeof product.toObject === "function" ? product.toObject() : product;
  return {
    _id: identifier(object._id),
    name: object.name,
    description: object.description,
    price: object.price,
    active: object.active,
    featured: object.featured
  };
}

class FavoriteService {
  constructor({
    UserModel = User,
    ProductModel = Product,
    connect = requireDatabase
  } = {}) {
    this.UserModel = UserModel;
    this.ProductModel = ProductModel;
    this.connect = connect;
  }

  async user(userId) {
    const normalizedUserId = normalizeObjectId(userId, "O usuário");
    await this.connect();
    const user = await this.UserModel.findById(normalizedUserId);
    if (!user) throw new NotFoundError("Usuário não encontrado.");
    return { normalizedUserId, user };
  }

  async list(userId) {
    const { user } = await this.user(userId);
    const productIds = (user.favorites || []).map(identifier);
    const products = await this.ProductModel.find({
      _id: { $in: productIds }
    });
    const byId = new Map(products.map((product) => [identifier(product._id), product]));
    return {
      favorites: productIds.map((productId) => ({
        productId,
        product: publicProduct(byId.get(productId))
      }))
    };
  }

  async add(userId, productId) {
    const normalizedProductId = normalizeObjectId(productId, "O produto");
    const { normalizedUserId } = await this.user(userId);
    const product = await this.ProductModel.findById(normalizedProductId);
    if (!product) throw new NotFoundError("Produto não encontrado.");
    if (!product.active) throw new FavoriteConflictError("Produto inativo.");
    await this.UserModel.findOneAndUpdate(
      { _id: normalizedUserId },
      { $addToSet: { favorites: normalizedProductId } },
      { new: true }
    );
    return this.list(normalizedUserId);
  }

  async remove(userId, productId) {
    const normalizedProductId = normalizeObjectId(productId, "O produto");
    const { normalizedUserId } = await this.user(userId);
    await this.UserModel.findOneAndUpdate(
      { _id: normalizedUserId },
      { $pull: { favorites: normalizedProductId } },
      { new: true }
    );
  }
}

module.exports = { FavoriteConflictError, FavoriteService, publicProduct };
