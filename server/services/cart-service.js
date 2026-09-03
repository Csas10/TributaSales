const Cart = require("../models/Cart");
const Product = require("../models/Product");
const { requireDatabase } = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId,
  validateCartItemInput,
  validateCartQuantityInput
} = require("../utils/validation");

class CartConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "CartConflictError";
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
    price: object.price,
    active: object.active
  };
}

class CartService {
  constructor({
    CartModel = Cart,
    ProductModel = Product,
    connect = requireDatabase
  } = {}) {
    this.CartModel = CartModel;
    this.ProductModel = ProductModel;
    this.connect = connect;
  }

  async prepareUser(userId) {
    const normalizedUserId = normalizeObjectId(userId, "O usuário");
    await this.connect();
    return normalizedUserId;
  }

  async currentProduct(productId) {
    const product = await this.ProductModel.findById(productId);
    if (!product) throw new NotFoundError("Produto não encontrado.");
    if (!product.active) throw new CartConflictError("Produto inativo.");
    return product;
  }

  async findProducts(items) {
    const productIds = items.map((item) => identifier(item.product));
    const products = await this.ProductModel.find({
      _id: { $in: productIds }
    });
    return new Map(products.map((product) => [identifier(product._id), product]));
  }

  async response(cart) {
    if (!cart) return { items: [], total: 0, unavailableItems: 0 };
    const products = await this.findProducts(cart.items || []);
    let total = 0;
    let unavailableItems = 0;
    const items = (cart.items || []).map((item) => {
      const product = products.get(identifier(item.product));
      const quantity = item.quantity;
      if (!product || !product.active) {
        unavailableItems += 1;
        return {
          productId: identifier(item.product),
          product: product ? publicProduct(product) : null,
          quantity,
          available: false,
          unitPrice: null,
          subtotal: null
        };
      }
      const unitPrice = Number(product.price);
      const subtotal = Number((unitPrice * quantity).toFixed(2));
      total = Number((total + subtotal).toFixed(2));
      return {
        productId: identifier(item.product),
        product: publicProduct(product),
        quantity,
        available: true,
        unitPrice,
        subtotal
      };
    });
    return { items, total, unavailableItems };
  }

  async get(userId) {
    const normalizedUserId = await this.prepareUser(userId);
    const cart = await this.CartModel.findOne({ user: normalizedUserId });
    return this.response(cart);
  }

  async getOrCreateCart(userId) {
    const current = await this.CartModel.findOne({ user: userId });
    if (current) return current;

    try {
      return await this.CartModel.create({ user: userId, items: [] });
    } catch (error) {
      if (error && error.code === 11000) {
        const recovered = await this.CartModel.findOne({ user: userId });
        if (recovered) return recovered;
      }
      throw error;
    }
  }

  async addItem(userId, payload) {
    const input = validateCartItemInput(payload);
    const normalizedUserId = await this.prepareUser(userId);
    await this.currentProduct(input.productId);
    await this.getOrCreateCart(normalizedUserId);

    let cart = await this.CartModel.findOneAndUpdate(
      {
        user: normalizedUserId,
        "items.product": input.productId
      },
      {
        $inc: {
          "items.$.quantity": input.quantity
        }
      },
      { new: true, runValidators: true }
    );
    if (!cart) {
      cart = await this.CartModel.findOneAndUpdate(
        {
          user: normalizedUserId,
          "items.product": { $ne: input.productId }
        },
        {
          $push: {
            items: {
              product: input.productId,
              quantity: input.quantity
            }
          }
        },
        { new: true, runValidators: true }
      );
    }
    if (!cart) {
      cart = await this.CartModel.findOneAndUpdate(
        {
          user: normalizedUserId,
          "items.product": input.productId
        },
        {
          $inc: {
            "items.$.quantity": input.quantity
          }
        },
        { new: true, runValidators: true }
      );
    }
    if (!cart) throw new NotFoundError("Carrinho não encontrado.");
    return this.response(cart);
  }

  async updateItem(userId, productId, payload) {
    const normalizedProductId = normalizeObjectId(productId, "O produto");
    const { quantity } = validateCartQuantityInput(payload);
    const normalizedUserId = await this.prepareUser(userId);
    await this.currentProduct(normalizedProductId);
    const cart = await this.CartModel.findOneAndUpdate(
      {
        user: normalizedUserId,
        "items.product": normalizedProductId
      },
      {
        $set: {
          "items.$.quantity": quantity
        }
      },
      { new: true, runValidators: true }
    );
    if (!cart) throw new NotFoundError("Item não encontrado no carrinho.");
    return this.response(cart);
  }

  async removeItem(userId, productId) {
    const normalizedProductId = normalizeObjectId(productId, "O produto");
    const normalizedUserId = await this.prepareUser(userId);
    await this.CartModel.findOneAndUpdate(
      { user: normalizedUserId },
      {
        $pull: {
          items: {
            product: normalizedProductId
          }
        }
      },
      { new: true }
    );
  }

  async clear(userId) {
    const normalizedUserId = await this.prepareUser(userId);
    await this.CartModel.findOneAndUpdate(
      { user: normalizedUserId },
      { $set: { items: [] } },
      { new: true }
    );
  }
}

module.exports = { CartConflictError, CartService, publicProduct };
