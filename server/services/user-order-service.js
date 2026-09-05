const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const Address = require("../models/Address");
const {
  DatabaseUnavailableError,
  requireDatabase
} = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId,
  requireObjectPayload
} = require("../utils/validation");
const {
  MAX_CART_LINES,
  MAX_CART_TOTAL_CENTS,
  MAX_ITEM_QUANTITY,
  MAX_PRODUCT_PRICE_CENTS
} = require("../domain/commerce-limits");

class OrderConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderConflictError";
    this.status = 409;
  }
}

function identifier(value) {
  return value && typeof value.toString === "function"
    ? value.toString()
    : String(value);
}

function cents(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    Number(value.toFixed(2)) !== value
  ) {
    throw new OrderConflictError("O carrinho contém preço inválido.");
  }
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || result > MAX_PRODUCT_PRICE_CENTS) {
    throw new OrderConflictError("O carrinho contém preço inválido.");
  }
  return result;
}

function versionOf(cart) {
  const version = cart && cart.__v;
  if (version == null) return 0;
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new OrderConflictError("A versão do carrinho é inválida.");
  }
  return version;
}

function plain(value) {
  return value && typeof value.toObject === "function" ? value.toObject() : value;
}

class UserOrderService {
  constructor({
    OrderModel = Order,
    CartModel = Cart,
    ProductModel = Product,
    AddressModel = Address,
    connect = requireDatabase
  } = {}) {
    this.OrderModel = OrderModel;
    this.CartModel = CartModel;
    this.ProductModel = ProductModel;
    this.AddressModel = AddressModel;
    this.connect = connect;
    this.orderInitPromise = null;
  }

  async prepare(userId) {
    const normalized = normalizeObjectId(userId, "O usuário");
    await this.connect();
    await this.prepareOrderModel();
    return normalized;
  }

  async prepareOrderModel() {
    if (
      typeof this.OrderModel.createIndexes !== "function" &&
      typeof this.OrderModel.init !== "function"
    ) {
      return;
    }
    if (!this.orderInitPromise) {
      this.orderInitPromise = Promise.resolve()
        .then(() => {
          if (typeof this.OrderModel.createIndexes === "function") {
            return this.OrderModel.createIndexes();
          }
          return this.OrderModel.init();
        })
        .catch((error) => {
          this.orderInitPromise = null;
          if (error instanceof DatabaseUnavailableError) throw error;
          throw new DatabaseUnavailableError();
        });
    }
    return this.orderInitPromise;
  }

  async address(userId, addressId) {
    const address = await this.AddressModel.findOne({
      _id: normalizeObjectId(addressId, "O endereço"),
      user: userId
    });
    if (!address) throw new NotFoundError("Endereço não encontrado.");
    const value = plain(address);
    return {
      sourceAddressId: value._id,
      shippingAddress: {
        cep: value.cep,
        street: value.street,
        number: value.number,
        complement: value.complement || "",
        neighborhood: value.neighborhood,
        city: value.city,
        state: value.state
      }
    };
  }

  async buildSnapshot(cart) {
    const cartItems = cart && cart.items;
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new OrderConflictError("Não é possível criar pedido com carrinho vazio.");
    }
    if (cartItems.length > MAX_CART_LINES) {
      throw new OrderConflictError("O carrinho excede o limite técnico.");
    }
    const ids = cartItems.map((item) => identifier(item.product));
    const products = await this.ProductModel.find({ _id: { $in: ids } });
    const byId = new Map(products.map((item) => [identifier(item._id), plain(item)]));
    let totalCents = 0;
    const items = cartItems.map((item) => {
      const productId = identifier(item.product);
      const product = byId.get(productId);
      if (!product || !product.active) {
        throw new OrderConflictError("O carrinho contém produto indisponível.");
      }
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > MAX_ITEM_QUANTITY
      ) {
        throw new OrderConflictError("O carrinho contém quantidade inválida.");
      }
      const unitPriceCents = cents(product.price);
      const subtotalCents = unitPriceCents * item.quantity;
      if (
        !Number.isSafeInteger(subtotalCents) ||
        subtotalCents > MAX_CART_TOTAL_CENTS ||
        !Number.isSafeInteger(totalCents + subtotalCents) ||
        totalCents + subtotalCents > MAX_CART_TOTAL_CENTS
      ) {
        throw new OrderConflictError("Os valores do pedido excedem o limite seguro.");
      }
      totalCents += subtotalCents;
      return {
        productId: product._id,
        name: product.name,
        quantity: item.quantity,
        unitPriceCents,
        subtotalCents
      };
    });
    return { items, totalCents };
  }

  async clearCartCas(userId, sourceCartVersion) {
    return this.CartModel.findOneAndUpdate(
      { user: userId, __v: sourceCartVersion },
      { $set: { items: [] }, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
  }

  async create(userId, payload) {
    const normalizedUserId = await this.prepare(userId);
    requireObjectPayload(payload);
    const keys = Object.keys(payload);
    if (
      keys.length !== 1 ||
      keys[0] !== "addressId" ||
      typeof payload.addressId !== "string"
    ) {
      throw new OrderConflictError("O pedido deve receber somente addressId.");
    }
    const cart = await this.CartModel.findOne({ user: normalizedUserId });
    const sourceCartVersion = versionOf(cart);
    let order = await this.OrderModel.findOne({
      user: normalizedUserId,
      sourceCartVersion
    });
    if (!order && cart && (!Array.isArray(cart.items) || cart.items.length === 0)) {
      order = await this.OrderModel.findOne({
        user: normalizedUserId,
        sourceCartVersion: sourceCartVersion - 1
      });
    }
    if (order) {
      await this.clearCartCas(normalizedUserId, order.sourceCartVersion);
      return order;
    }
    const address = await this.address(normalizedUserId, payload.addressId);
    const snapshot = await this.buildSnapshot(cart);
    const data = {
      user: normalizedUserId,
      sourceCartVersion,
      sourceAddressId: address.sourceAddressId,
      shippingAddress: address.shippingAddress,
      ...snapshot
    };

    try {
      order = await this.OrderModel.create(data);
    } catch (error) {
      if (error && error.code === 11000) {
        order = await this.OrderModel.findOne({
          user: normalizedUserId,
          sourceCartVersion
        });
      } else {
        throw error;
      }
    }
    if (!order) throw new OrderConflictError("Não foi possível criar o pedido.");
    await this.clearCartCas(normalizedUserId, sourceCartVersion);
    return order;
  }

  async list(userId) {
    const normalizedUserId = await this.prepare(userId);
    return this.OrderModel.find({ user: normalizedUserId }).sort({ createdAt: -1 });
  }

  async get(userId, orderId) {
    const normalizedUserId = await this.prepare(userId);
    const order = await this.OrderModel.findOne({
      _id: normalizeObjectId(orderId, "O pedido"),
      user: normalizedUserId
    });
    if (!order) throw new NotFoundError("Pedido não encontrado.");
    return order;
  }

  async cancel(userId, orderId, payload = {}) {
    requireObjectPayload(payload);
    if (
      Object.keys(payload).length > 0 &&
      (Object.keys(payload).length !== 1 || payload.status !== "cancelled")
    ) {
      throw new OrderConflictError("O status permitido para alteração é cancelled.");
    }
    const normalizedUserId = await this.prepare(userId);
    const normalizedOrderId = normalizeObjectId(orderId, "O pedido");
    const current = await this.OrderModel.findOne({
      _id: normalizedOrderId,
      user: normalizedUserId
    });
    if (!current) throw new NotFoundError("Pedido não encontrado.");
    if (current.status !== "pending") {
      throw new OrderConflictError("Somente pedidos pendentes podem ser cancelados.");
    }
    const order = await this.OrderModel.findOneAndUpdate(
      {
        _id: normalizedOrderId,
        user: normalizedUserId,
        status: "pending",
        cancelledAt: null
      },
      { $set: { status: "cancelled", cancelledAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!order) throw new OrderConflictError("Somente pedidos pendentes podem ser cancelados.");
    return order;
  }
}

module.exports = { OrderConflictError, UserOrderService };
