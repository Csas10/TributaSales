const Cart = require("../models/Cart");
const Product = require("../models/Product");
const {
  DatabaseUnavailableError,
  requireDatabase
} = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId,
  validateCartItemInput,
  validateCartQuantityInput
} = require("../utils/validation");
const {
  MAX_CART_LINES,
  MAX_CART_TOTAL_CENTS,
  MAX_ITEM_QUANTITY,
  MAX_PRODUCT_PRICE_CENTS
} = require("../domain/commerce-limits");

class CartConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "CartConflictError";
    this.status = 409;
  }
}

class CartCalculationError extends Error {
  constructor() {
    super("Não foi possível calcular os valores do carrinho.");
    this.name = "CartCalculationError";
    this.status = 500;
  }
}

// Limite pequeno e explícito de novas tentativas de concorrência otimista
// (baseada em __v). Não substitui atomicidade do Mongo: apenas limita quantas
// vezes o serviço relê/recalcula/tenta de novo antes de responder 409.
const MAX_VERSION_ATTEMPTS = 5;

function identifier(value) {
  return value && typeof value.toString === "function" ? value.toString() : String(value);
}

function currentVersion(cart) {
  return Number.isSafeInteger(cart.__v) ? cart.__v : 0;
}

function findCartItem(cart, productId) {
  return (cart.items || []).find(
    (item) => identifier(item.product) === productId
  );
}

function publicProduct(product) {
  if (!product) return null;
  const object = typeof product.toObject === "function" ? product.toObject() : product;
  const priceCents = productPriceCents(object);
  return {
    _id: identifier(object._id),
    name: object.name,
    price: priceCents / 100,
    active: object.active
  };
}

function unavailableProduct(product) {
  if (!product) return null;
  const object = typeof product.toObject === "function" ? product.toObject() : product;
  return {
    _id: identifier(object._id),
    name: object.name,
    price: null,
    active: object.active
  };
}

function moneyToCents(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    Number(value.toFixed(2)) !== value
  ) {
    throw new CartCalculationError();
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) throw new CartCalculationError();
  return cents;
}

function productPriceCents(product) {
  const cents = moneyToCents(product.price);
  if (cents > MAX_PRODUCT_PRICE_CENTS) throw new CartCalculationError();
  return cents;
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
    this.cartInitPromise = null;
  }

  async prepareUser(userId) {
    const normalizedUserId = normalizeObjectId(userId, "O usuário");
    await this.connect();
    await this.prepareCartModel();
    return normalizedUserId;
  }

  async prepareCartModel() {
    if (
      typeof this.CartModel.createIndexes !== "function" &&
      typeof this.CartModel.init !== "function"
    ) return;
    if (!this.cartInitPromise) {
      this.cartInitPromise = Promise.resolve()
        .then(() => {
          if (typeof this.CartModel.createIndexes === "function") {
            return this.CartModel.createIndexes();
          }
          return this.CartModel.init();
        })
        .catch(() => {
          this.cartInitPromise = null;
          throw new DatabaseUnavailableError();
        });
    }
    return this.cartInitPromise;
  }

  async currentProduct(productId) {
    const product = await this.ProductModel.findById(productId);
    if (!product) throw new NotFoundError("Produto não encontrado.");
    if (!product.active) throw new CartConflictError("Produto inativo.");
    return product;
  }

  conflict() {
    return new CartConflictError(
      "Não foi possível atualizar o carrinho devido a alterações concorrentes. Tente novamente."
    );
  }

  async validateProspectiveTotal(cart, product, quantity) {
    const current = await this.response(cart);
    const unitPriceCents = productPriceCents(product);
    const additionCents = unitPriceCents * quantity;
    const currentTotalCents = moneyToCents(current.total);
    if (
      !Number.isSafeInteger(additionCents) ||
      additionCents > MAX_CART_TOTAL_CENTS ||
      !Number.isSafeInteger(currentTotalCents) ||
      currentTotalCents > MAX_CART_TOTAL_CENTS ||
      !Number.isSafeInteger(currentTotalCents + additionCents) ||
      currentTotalCents + additionCents > MAX_CART_TOTAL_CENTS
    ) {
      throw new CartConflictError("Valores do carrinho excedem o limite seguro.");
    }
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
    const cartItems = cart.items || [];
    if (!Array.isArray(cartItems) || cartItems.length > MAX_CART_LINES) {
      throw new CartCalculationError();
    }
    const products = await this.findProducts(cartItems);
    let totalCents = 0;
    let unavailableItems = 0;
    const items = cartItems.map((item) => {
      const product = products.get(identifier(item.product));
      const quantity = item.quantity;
      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_ITEM_QUANTITY
      ) {
        throw new CartCalculationError();
      }
      if (!product || !product.active) {
        unavailableItems += 1;
        return {
          productId: identifier(item.product),
          product: unavailableProduct(product),
          quantity,
          available: false,
          unitPrice: null,
          subtotal: null
        };
      }
      const unitPriceCents = productPriceCents(product);
      const subtotalCents = unitPriceCents * quantity;
      if (
        !Number.isSafeInteger(subtotalCents) ||
        subtotalCents > MAX_CART_TOTAL_CENTS
      ) {
        throw new CartCalculationError();
      }
      const nextTotalCents = totalCents + subtotalCents;
      if (
        !Number.isSafeInteger(nextTotalCents) ||
        nextTotalCents > MAX_CART_TOTAL_CENTS
      ) {
        throw new CartCalculationError();
      }
      const unitPrice = unitPriceCents / 100;
      const subtotal = subtotalCents / 100;
      totalCents = nextTotalCents;
      return {
        productId: identifier(item.product),
        product: publicProduct(product),
        quantity,
        available: true,
        unitPrice,
        subtotal
      };
    });
    return { items, total: totalCents / 100, unavailableItems };
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

  // Concorrência otimista via __v (versionKey do Mongoose). Cada mutação lê o
  // Cart com sua versão atual, valida/calcula o estado prospectivo em
  // centavos e grava usando um filtro que exige a MESMA versão lida,
  // incrementando __v atomicamente na mesma operação. Se outra requisição já
  // tiver mutado o Cart nesse meio-tempo, o filtro não casa, a operação
  // retorna null e este método relê/recalcula/tenta de novo, até um limite
  // pequeno e explícito. Isso garante a invariante entre processos/instâncias
  // (inclusive serverless), diferente de um mutex em memória.
  async addItem(userId, payload) {
    const input = validateCartItemInput(payload);
    const normalizedUserId = await this.prepareUser(userId);
    const product = await this.currentProduct(input.productId);

    let cart = await this.getOrCreateCart(normalizedUserId);

    for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        cart = await this.CartModel.findOne({ user: normalizedUserId });
        if (!cart) throw new NotFoundError("Carrinho não encontrado.");
      }

      const version = currentVersion(cart);
      const existingItem = findCartItem(cart, input.productId);

      if (existingItem) {
        const nextQuantity = existingItem.quantity + input.quantity;
        if (
          !Number.isSafeInteger(nextQuantity) ||
          nextQuantity > MAX_ITEM_QUANTITY
        ) {
          throw new CartConflictError("Quantidade do carrinho excede o limite seguro.");
        }
      } else if ((cart.items || []).length >= MAX_CART_LINES) {
        throw new CartConflictError("O carrinho atingiu o limite técnico de linhas.");
      }
      await this.validateProspectiveTotal(cart, product, input.quantity);

      const filter = existingItem
        ? {
            user: normalizedUserId,
            __v: version,
            items: {
              $elemMatch: {
                product: input.productId,
                quantity: { $lte: MAX_ITEM_QUANTITY - input.quantity }
              }
            }
          }
        : {
            user: normalizedUserId,
            __v: version,
            "items.product": { $ne: input.productId }
          };
      const update = existingItem
        ? { $inc: { "items.$.quantity": input.quantity, __v: 1 } }
        : {
            $push: { items: { product: input.productId, quantity: input.quantity } },
            $inc: { __v: 1 }
          };

      const updated = await this.CartModel.findOneAndUpdate(filter, update, {
        new: true,
        runValidators: true
      });
      if (updated) return this.response(updated);
      // updated === null: __v mudou (ou o item mudou de estado) entre a
      // leitura e a gravação. Relê e tenta de novo, nunca fazendo
      // read-modify-write do array inteiro.
    }

    throw this.conflict();
  }

  async updateItem(userId, productId, payload) {
    const normalizedProductId = normalizeObjectId(productId, "O produto");
    const { quantity } = validateCartQuantityInput(payload);
    const normalizedUserId = await this.prepareUser(userId);
    const product = await this.currentProduct(normalizedProductId);

    for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
      const cart = await this.CartModel.findOne({ user: normalizedUserId });
      if (!cart) throw new NotFoundError("Item não encontrado no carrinho.");
      const existingItem = findCartItem(cart, normalizedProductId);
      if (!existingItem) throw new NotFoundError("Item não encontrado no carrinho.");
      const version = currentVersion(cart);

      const current = await this.response(cart);
      const currentItem = current.items.find(
        (item) => item.productId === normalizedProductId
      );
      const currentTotalCents = moneyToCents(current.total);
      const unitPriceCents = productPriceCents(product);
      const currentSubtotalCents =
        currentItem && currentItem.available ? moneyToCents(currentItem.subtotal) : 0;
      const nextSubtotalCents = unitPriceCents * quantity;
      const nextTotalCents = currentTotalCents - currentSubtotalCents + nextSubtotalCents;
      if (
        !Number.isSafeInteger(nextSubtotalCents) ||
        nextSubtotalCents > MAX_CART_TOTAL_CENTS ||
        !Number.isSafeInteger(nextTotalCents) ||
        nextTotalCents > MAX_CART_TOTAL_CENTS
      ) {
        throw new CartConflictError("Valores do carrinho excedem o limite seguro.");
      }

      const updated = await this.CartModel.findOneAndUpdate(
        {
          user: normalizedUserId,
          __v: version,
          "items.product": normalizedProductId
        },
        {
          $set: { "items.$.quantity": quantity },
          $inc: { __v: 1 }
        },
        { new: true, runValidators: true }
      );
      if (updated) return this.response(updated);
    }

    throw this.conflict();
  }

  async removeItem(userId, productId) {
    const normalizedProductId = normalizeObjectId(productId, "O produto");
    const normalizedUserId = await this.prepareUser(userId);

    for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
      const cart = await this.CartModel.findOne({ user: normalizedUserId });
      if (!cart) return;
      const version = currentVersion(cart);
      const updated = await this.CartModel.findOneAndUpdate(
        { user: normalizedUserId, __v: version },
        {
          $pull: { items: { product: normalizedProductId } },
          $inc: { __v: 1 }
        },
        { new: true }
      );
      if (updated) return;
    }

    throw this.conflict();
  }

  async clear(userId) {
    const normalizedUserId = await this.prepareUser(userId);

    for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt += 1) {
      const cart = await this.CartModel.findOne({ user: normalizedUserId });
      if (!cart) return;
      const version = currentVersion(cart);
      const updated = await this.CartModel.findOneAndUpdate(
        { user: normalizedUserId, __v: version },
        {
          $set: { items: [] },
          $inc: { __v: 1 }
        },
        { new: true }
      );
      if (updated) return;
    }

    throw this.conflict();
  }
}

module.exports = {
  CartCalculationError,
  CartConflictError,
  CartService,
  moneyToCents,
  publicProduct
};
