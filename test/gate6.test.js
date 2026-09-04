const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const test = require("node:test");

process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "";

const app = require("../server/server");
const Cart = require("../server/models/Cart");
const Product = require("../server/models/Product");
const User = require("../server/models/User");
const { DatabaseUnavailableError } = require("../server/config/database");
const { FavoriteService } = require("../server/services/favorite-service");
const {
  CartCalculationError,
  CartConflictError,
  CartService
} = require("../server/services/cart-service");
const { ForbiddenError } = require("../server/utils/auth-errors");
const authorize = require("../server/middleware/authorize");
const {
  normalizePrice,
  normalizeQuantity,
  validateCartItemInput,
  validateCartQuantityInput
} = require("../server/utils/validation");
const {
  MAX_CART_LINES,
  MAX_CART_TOTAL_CENTS,
  MAX_ITEM_QUANTITY,
  MAX_PRODUCT_PRICE_CENTS
} = require("../server/domain/commerce-limits");

const userId = "507f1f77bcf86cd799439011";
const productId = "507f1f77bcf86cd799439012";
const inactiveProductId = "507f1f77bcf86cd799439013";
const deletedProductId = "507f1f77bcf86cd799439014";

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function product(id = productId, overrides = {}) {
  return {
    _id: id,
    name: "Produto",
    description: "Descrição",
    price: 19.99,
    active: true,
    featured: false,
    ...overrides
  };
}

function atomicCartUpdate(cart, filter, update) {
  if (!cart) return null;
  if (cart.__v === undefined) cart.__v = 0;
  if (
    Object.prototype.hasOwnProperty.call(filter, "__v") &&
    filter.__v !== cart.__v
  ) {
    return null;
  }
  const itemFilter = filter["items.product"];
  const elementFilter = filter.items && filter.items.$elemMatch;
  const items = cart.items || [];
  if (typeof itemFilter === "string") {
    if (!items.some((item) => item.product === itemFilter)) return null;
  }
  if (itemFilter && itemFilter.$ne && items.some((item) => item.product === itemFilter.$ne)) {
    return null;
  }
  if (elementFilter) {
    const matchingItem = items.find(
      (item) =>
        item.product === elementFilter.product &&
        item.quantity <= elementFilter.quantity.$lte
    );
    if (!matchingItem) return null;
  }
  if (update.$inc && Object.prototype.hasOwnProperty.call(update.$inc, "items.$.quantity")) {
    const product = elementFilter ? elementFilter.product : itemFilter;
    const item = items.find((candidate) => candidate.product === product);
    if (!item) return null;
    item.quantity += update.$inc["items.$.quantity"];
  }
  if (update.$push) {
    items.push({ ...update.$push.items });
  }
  if (update.$set) {
    if (Object.prototype.hasOwnProperty.call(update.$set, "items")) {
      cart.items = update.$set.items;
    }
    if (Object.prototype.hasOwnProperty.call(update.$set, "items.$.quantity")) {
      const item = items.find((candidate) => candidate.product === itemFilter);
      if (!item) return null;
      item.quantity = update.$set["items.$.quantity"];
    }
  }
  if (update.$pull) {
    cart.items = items.filter(
      (item) => item.product !== update.$pull.items.product
    );
  }
  if (update.$inc && Object.prototype.hasOwnProperty.call(update.$inc, "__v")) {
    cart.__v += update.$inc.__v;
  }
  return cart;
}

// Libera operações somente depois que as primeiras leituras esperadas foram
// observadas. As leituras posteriores não são bloqueadas, permitindo provar o
// reread da operação que perdeu o CAS.
function createFirstReadBarrier(expectedReads = 2) {
  let resolveReady;
  let resolveRelease;
  let didRelease = false;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const released = new Promise((resolve) => {
    resolveRelease = resolve;
  });
  const reads = [];

  return {
    reads,
    ready,
    get isReleased() {
      return didRelease;
    },
    release() {
      didRelease = true;
      resolveRelease();
    },
    async observe(read) {
      if (reads.length >= expectedReads) return;
      reads.push(read);
      if (reads.length === expectedReads) resolveReady();
      await released;
    }
  };
}

function cloneCart(cart) {
  return {
    ...cart,
    items: (cart.items || []).map((item) => ({ ...item }))
  };
}

// Simula um "banco" persistente compartilhado por múltiplas instâncias de
// CartService (múltiplos processos/serverless), sem qualquer estado de
// serviço compartilhado (sem lock em memória comum). Cada chamada de
// findOneAndUpdate aplica o mesmo protocolo de concorrência otimista via __v
// usado pelo CartModel real. Cada findOne devolve um snapshot independente,
// como uma leitura real do banco, para que uma gravação não altere a versão
// já observada pela outra instância.
function createSharedCartStore(initialCarts, { onRead } = {}) {
  const carts = new Map();
  const reads = [];
  const writes = [];
  for (const [userId, cart] of Object.entries(initialCarts)) {
    carts.set(userId, cloneCart({ ...cart, __v: cart.__v ?? 0 }));
  }
  return {
    carts,
    reads,
    writes,
    CartModel: {
      findOne: async (filter, label) => {
        const cart = carts.get(filter.user);
        if (!cart) return null;
        const snapshot = cloneCart(cart);
        const read = { label, version: snapshot.__v };
        reads.push(read);
        if (onRead) await onRead(read);
        return snapshot;
      },
      findOneAndUpdate: async (filter, update, label) => {
        const cart = carts.get(filter.user);
        const updated = atomicCartUpdate(cart, filter, update);
        writes.push({
          accepted: Boolean(updated),
          label,
          version: filter.__v
        });
        return updated ? cloneCart(updated) : null;
      }
    }
  };
}

test("define Cart com usuário único e referências User/Product", () => {
  const userPath = Cart.schema.path("user");
  const itemsPath = Cart.schema.path("items");
  const itemSchema = itemsPath.schema;
  const cart = new Cart({
    user: new mongoose.Types.ObjectId(userId),
    items: [{ product: new mongoose.Types.ObjectId(productId), quantity: 2 }]
  });
  const indexes = Cart.schema.indexes();

  assert.equal(userPath.options.ref, "User");
  assert.equal(userPath.options.required, true);
  assert.equal(userPath.options.unique, true);
  assert.ok(indexes.some(([fields, options]) => fields.user === 1 && options.unique));
  assert.equal(itemSchema.path("product").options.ref, "Product");
  assert.equal(itemSchema.path("quantity").options.min, 1);
  assert.equal(itemSchema.options._id, false);
  assert.equal(Cart.schema.options.timestamps, true);
  assert.equal(cart.items[0].quantity, 2);
});

test("define favorites como referências Product sem unique artificial", () => {
  const favoritesPath = User.schema.path("favorites");
  const user = new User({
    name: "Ana",
    email: "ana@example.com",
    passwordHash: "hash-fixture"
  });

  assert.equal(favoritesPath.caster.options.ref, "Product");
  assert.equal(favoritesPath.options.unique, undefined);
  assert.deepEqual(user.favorites, []);
});

test("valida itens de Cart com ObjectId e quantidade estritos", () => {
  assert.deepEqual(
    validateCartItemInput({
      productId,
      quantity: 2,
      price: 0.01,
      total: 0.01,
      user: "outro",
      role: "admin",
      _id: "injetado"
    }),
    { productId, quantity: 2 }
  );
  assert.deepEqual(validateCartQuantityInput({ quantity: 3, price: 0 }), { quantity: 3 });
  assert.equal(normalizeQuantity(1), 1);
  for (const quantity of [0, -1, 1.5, "2", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizeQuantity(quantity),
      /quantidade/
    );
  }
});

test("rejeita quantity fora da faixa segura e aceita inteiro seguro", () => {
  assert.equal(normalizeQuantity(MAX_ITEM_QUANTITY), MAX_ITEM_QUANTITY);
  assert.throws(() => normalizeQuantity(MAX_ITEM_QUANTITY + 1), /quantidade/);
  assert.throws(() => normalizeQuantity(1e308), /quantidade/);
});

test("Cart schema rejeita quantity fora da faixa segura", () => {
  const cart = new Cart({
    user: new mongoose.Types.ObjectId(userId),
    items: [{
      product: new mongoose.Types.ObjectId(productId),
      quantity: MAX_ITEM_QUANTITY + 1
    }]
  });
  assert.ok(cart.validateSync().errors["items.0.quantity"]);
});

test("limites técnicos de comércio mantêm o pior caso dentro da faixa segura", async () => {
  assert.equal(
    MAX_CART_LINES * MAX_ITEM_QUANTITY * MAX_PRODUCT_PRICE_CENTS,
    MAX_CART_TOTAL_CENTS
  );
  assert.ok(Number.isSafeInteger(MAX_CART_TOTAL_CENTS));
  assert.ok(MAX_CART_TOTAL_CENTS <= Number.MAX_SAFE_INTEGER);

  const items = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
    product: `507f1f77bcf86cd79943${String(index).padStart(4, "0")}`,
    quantity: MAX_ITEM_QUANTITY
  }));
  const products = new Map(
    items.map((item) => [
      item.product,
      product(item.product, { price: MAX_PRODUCT_PRICE_CENTS / 100 })
    ])
  );
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      find: async (filter) => filter._id.$in.map((id) => products.get(id))
    },
    CartModel: {}
  });

  const result = await service.response({ items });
  const serialized = JSON.parse(JSON.stringify(result));
  assert.equal(result.items.length, MAX_CART_LINES);
  assert.equal(result.total, MAX_CART_TOTAL_CENTS / 100);
  assert.ok(result.items.every((item) => Number.isSafeInteger(item.subtotal * 100)));
  assert.ok(Number.isSafeInteger(result.total * 100));
  assert.equal(serialized.items.some((item) => item.subtotal === null), false);
  assert.notEqual(serialized.total, null);
});

test("Cart schema aceita MAX_CART_LINES e rejeita uma linha adicional", () => {
  const makeItems = (count) =>
    Array.from({ length: count }, () => ({
      product: new mongoose.Types.ObjectId(),
      quantity: MAX_ITEM_QUANTITY
    }));
  const validCart = new Cart({
    user: new mongoose.Types.ObjectId(userId),
    items: makeItems(MAX_CART_LINES)
  });
  const invalidCart = new Cart({
    user: new mongoose.Types.ObjectId(userId),
    items: makeItems(MAX_CART_LINES + 1)
  });
  assert.equal(validCart.validateSync()?.errors?.items, undefined);
  assert.ok(invalidCart.validateSync().errors.items);
});

test("normaliza os limites de preço e rejeita preço acima do limite técnico", () => {
  assert.equal(
    normalizePrice(MAX_PRODUCT_PRICE_CENTS / 100),
    MAX_PRODUCT_PRICE_CENTS / 100
  );
  assert.throws(() => normalizePrice((MAX_PRODUCT_PRICE_CENTS + 1) / 100), (error) => {
    assert.equal(error.message, "O preço excede o limite técnico permitido.");
    return true;
  }
  );
  const productWithLimit = new Product({
    name: "Produto limite",
    price: MAX_PRODUCT_PRICE_CENTS / 100,
    category: new mongoose.Types.ObjectId()
  });
  const productAboveLimit = new Product({
    name: "Produto acima",
    price: (MAX_PRODUCT_PRICE_CENTS + 1) / 100,
    category: new mongoose.Types.ObjectId()
  });
  assert.equal(productWithLimit.validateSync()?.errors?.price, undefined);
  assert.ok(productAboveLimit.validateSync().errors.price);
});

test("CartModel.init é aguardado e compartilhado entre preparações concorrentes", async () => {
  let initCalls = 0;
  let releaseInit;
  const events = [];
  const initPromise = new Promise((resolve) => {
    releaseInit = resolve;
  });
  const service = new CartService({
    connect: async () => {},
    CartModel: {
      init: () => {
        initCalls += 1;
        events.push("init");
        return initPromise.then(() => events.push("ready"));
      },
      findOne: async () => {
        events.push("find");
        return null;
      }
    },
    ProductModel: { find: async () => [] }
  });

  const pending = Promise.all([service.get(userId), service.get(userId)]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(initCalls, 1);
  assert.deepEqual(events, ["init"]);
  releaseInit();
  await pending;
  assert.deepEqual(events, ["init", "ready", "find", "find"]);
});

test("createIndexes é preferido, aguardado e compartilhado antes da consulta", async () => {
  let createIndexesCalls = 0;
  let releaseIndexes;
  const events = [];
  const indexesPromise = new Promise((resolve) => {
    releaseIndexes = resolve;
  });
  const service = new CartService({
    connect: async () => {},
    CartModel: {
      createIndexes: () => {
        createIndexesCalls += 1;
        events.push("indexes");
        return indexesPromise.then(() => events.push("ready"));
      },
      init: () => {
        throw new Error("init não deveria ser chamado");
      },
      findOne: async () => {
        events.push("find");
        return null;
      }
    },
    ProductModel: { find: async () => [] }
  });

  const pending = Promise.all([service.get(userId), service.get(userId)]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(createIndexesCalls, 1);
  assert.deepEqual(events, ["indexes"]);
  releaseIndexes();
  await pending;
  assert.deepEqual(events, ["indexes", "ready", "find", "find"]);
});

test("falha de createIndexes vira 503 e permite nova tentativa", async () => {
  let createIndexesCalls = 0;
  const service = new CartService({
    connect: async () => {},
    CartModel: {
      createIndexes: async () => {
        createIndexesCalls += 1;
        if (createIndexesCalls === 1) throw new Error("index failure");
      },
      findOne: async () => null
    },
    ProductModel: { find: async () => [] }
  });

  await assert.rejects(
    () => service.get(userId),
    (error) => {
      assert.ok(error instanceof DatabaseUnavailableError);
      assert.equal(error.status, 503);
      return true;
    }
  );
  assert.deepEqual(await service.get(userId), {
    items: [],
    total: 0,
    unavailableItems: 0
  });
  assert.equal(createIndexesCalls, 2);
});

test("falha de CartModel.init vira 503 e permite nova tentativa", async () => {
  let initCalls = 0;
  const service = new CartService({
    connect: async () => {},
    CartModel: {
      init: async () => {
        initCalls += 1;
        if (initCalls === 1) throw new Error("index failure");
      },
      findOne: async () => null
    },
    ProductModel: { find: async () => [] }
  });

  await assert.rejects(
    () => service.get(userId),
    (error) => {
      assert.ok(error instanceof DatabaseUnavailableError);
      assert.equal(error.status, 503);
      return true;
    }
  );
  const emptyCart = await service.get(userId);
  assert.deepEqual(emptyCart, { items: [], total: 0, unavailableItems: 0 });
  assert.equal(initCalls, 2);
});

test("FavoriteService usa $addToSet, rejeita produto inativo e permite remover stale", async () => {
  const user = { _id: userId, favorites: [] };
  const updates = [];
  const activeProduct = product();
  const service = new FavoriteService({
    connect: async () => {},
    UserModel: {
      findById: async () => user,
      findOneAndUpdate: async (filter, update) => {
        updates.push({ filter, update });
        if (update.$addToSet) {
          if (!user.favorites.includes(update.$addToSet.favorites)) {
            user.favorites.push(update.$addToSet.favorites);
          }
        }
        if (update.$pull) {
          user.favorites = user.favorites.filter(
            (favorite) => favorite !== update.$pull.favorites
          );
        }
        return user;
      }
    },
    ProductModel: {
      findById: async (id) => (id === productId ? activeProduct : null),
      find: async () => user.favorites.map((id) => product(id))
    }
  });

  await service.add(userId, productId);
  await service.add(userId, productId);
  assert.deepEqual(user.favorites, [productId]);
  assert.equal(updates[0].update.$addToSet.favorites, productId);

  const inactiveService = new FavoriteService({
    connect: async () => {},
    UserModel: { findById: async () => user },
    ProductModel: { findById: async () => product(productId, { active: false }) }
  });
  await assert.rejects(
    () => inactiveService.add(userId, productId),
    (error) => {
      assert.equal(error.status, 409);
      return error instanceof Error;
    }
  );

  user.favorites.push("507f1f77bcf86cd799439099");
  await service.remove(userId, "507f1f77bcf86cd799439099");
  assert.equal(user.favorites.includes("507f1f77bcf86cd799439099"), false);
});

test("FavoriteService distingue ObjectId inválido e produto inexistente", async () => {
  const service = new FavoriteService({
    connect: async () => {},
    UserModel: { findById: async () => ({ _id: userId, favorites: [] }) },
    ProductModel: { findById: async () => null }
  });

  await assert.rejects(() => service.add(userId, "invalid"), /ObjectId/);
  await assert.rejects(
    () => service.add(userId, productId),
    (error) => error.name === "NotFoundError"
  );
});

test("CartService cria e incrementa item sem duplicar nem persistir preço/user", async () => {
  let cart = null;
  let savedUpdate;
  const activeProduct = product();
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => activeProduct,
      find: async () => (cart ? cart.items.map(() => activeProduct) : [])
    },
    CartModel: {
      findOne: async () => cart,
      create: async (payload) => {
        cart = payload;
        return cart;
      },
      findOneAndUpdate: async (filter, update) => {
        assert.equal(filter.user, userId);
        savedUpdate = update;
        const updated = atomicCartUpdate(cart, filter, update);
        if (updated) cart = updated;
        return updated;
      }
    }
  });

  const first = await service.addItem(userId, {
    productId,
    quantity: 2,
    price: 0.01,
    total: 0.01,
    user: "other-user",
    role: "admin"
  });
  const second = await service.addItem(userId, { productId, quantity: 3 });

  assert.equal(first.items[0].quantity, 2);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].quantity, 5);
  assert.equal(second.items[0].unitPrice, 19.99);
  assert.equal(second.items[0].subtotal, 99.95);
  assert.equal(second.total, 99.95);
  assert.deepEqual(Object.keys(savedUpdate), ["$inc"]);
  assert.equal(savedUpdate.$inc["items.$.quantity"], 3);
});

test("CartService usa preço atual e preserva itens inativos/excluídos na leitura", async () => {
  const cart = {
    user: userId,
    items: [
      { product: productId, quantity: 2 },
      { product: inactiveProductId, quantity: 1 },
      { product: deletedProductId, quantity: 4 }
    ]
  };
  const active = product(productId, { price: 25, active: true });
  const inactive = product(inactiveProductId, {
    price: (MAX_PRODUCT_PRICE_CENTS + 1) / 100,
    active: false
  });
  const service = new CartService({
    connect: async () => {},
    CartModel: { findOne: async () => cart },
    ProductModel: {
      find: async (filter) => {
        assert.deepEqual(filter, {
          _id: { $in: [productId, inactiveProductId, deletedProductId] }
        });
        return [active, inactive];
      }
    }
  });

  const result = await service.get(userId);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].unitPrice, 25);
  assert.equal(result.items[0].subtotal, 50);
  assert.equal(result.items[1].available, false);
  assert.notEqual(result.items[1].product, null);
  assert.equal(result.items[1].product.active, false);
  assert.equal(result.items[1].product.price, null);
  assert.equal(result.items[1].unitPrice, null);
  assert.equal(result.items[1].subtotal, null);
  assert.equal(result.items[2].product, null);
  assert.equal(result.items[2].available, false);
  assert.equal(result.items[2].unitPrice, null);
  assert.equal(result.items[2].subtotal, null);
  assert.equal(result.unavailableItems, 2);
  assert.equal(result.total, 50);
});

test("CartService mantém subtotal e rejeita Product ativo legado acima do teto", async () => {
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      find: async () => [product(productId, { price: 19.99 })]
    },
    CartModel: {}
  });
  const result = await service.response({
    items: [{ product: productId, quantity: 3 }]
  });
  const serialized = JSON.parse(JSON.stringify(result));
  assert.equal(Number.isFinite(serialized.items[0].subtotal), true);
  assert.equal(Number.isFinite(serialized.total), true);
  assert.notEqual(serialized.items[0].subtotal, null);
  assert.notEqual(serialized.total, null);

  const overflowService = new CartService({
    connect: async () => {},
    ProductModel: {
      find: async () => [
        product(productId, {
          price: (MAX_PRODUCT_PRICE_CENTS + 1) / 100,
          active: true
        })
      ]
    },
    CartModel: {}
  });
  await assert.rejects(
    () => overflowService.response({
      items: [{ product: productId, quantity: 1 }]
    }),
    CartCalculationError
  );
});

test("CartService rejeita preço persistido fora do limite antes da mutação", async () => {
  const cart = { user: userId, items: [] };
  let writes = 0;
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () =>
        product(productId, { price: (MAX_PRODUCT_PRICE_CENTS + 1) / 100 }),
      find: async () => []
    },
    CartModel: {
      findOne: async () => cart,
      create: async () => {
        throw new Error("não deveria criar");
      },
      findOneAndUpdate: async () => {
        writes += 1;
        throw new Error("não deveria gravar");
      }
    }
  });

  await assert.rejects(
    () => service.addItem(userId, { productId, quantity: MAX_ITEM_QUANTITY }),
    CartCalculationError
  );
  assert.equal(writes, 0);
  assert.deepEqual(cart.items, []);
});

test("CartService rejeita total persistido com preço fora do limite antes da mutação", async () => {
  const existingProductId = "507f1f77bcf86cd799439015";
  const invalidPrice = (MAX_PRODUCT_PRICE_CENTS + 1) / 100;
  const cart = {
    user: userId,
    items: [{ product: existingProductId, quantity: 1 }]
  };
  let writes = 0;
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async (id) => product(id, { price: invalidPrice }),
      find: async () => [product(existingProductId, { price: invalidPrice })]
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async () => {
        writes += 1;
        throw new Error("não deveria gravar");
      }
    }
  });

  await assert.rejects(
    () => service.addItem(userId, { productId, quantity: 1 }),
    CartCalculationError
  );
  assert.equal(writes, 0);
  assert.deepEqual(cart.items, [{ product: existingProductId, quantity: 1 }]);
});

test("CartService aplica PUT absoluto, remove item e clear idempotente", async () => {
  let cart = {
    user: userId,
    items: [{ product: productId, quantity: 2 }]
  };
  const saved = [];
  const activeProduct = product();
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => activeProduct,
      find: async () => cart.items.map(() => activeProduct)
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (_filter, update) => {
        saved.push(update);
        const updated = atomicCartUpdate(cart, _filter, update);
        if (updated) cart = updated;
        return updated;
      }
    }
  });

  const updated = await service.updateItem(userId, productId, { quantity: 7, total: 0 });
  assert.equal(updated.items[0].quantity, 7);
  await service.removeItem(userId, productId);
  assert.deepEqual(cart.items, []);
  await service.removeItem(userId, productId);
  await service.clear(userId);
  await service.clear(userId);
  assert.ok(saved.length >= 4);

  await assert.rejects(
    () => service.updateItem(userId, productId, { quantity: 1 }),
    (error) => error.name === "NotFoundError"
  );
});

test("CartService distingue produto inexistente/inativo e Mongo indisponível", async () => {
  const missingService = new CartService({
    connect: async () => {},
    ProductModel: { findById: async () => null },
    CartModel: { findOne: async () => null }
  });
  await assert.rejects(
    () => missingService.addItem(userId, { productId, quantity: 1 }),
    (error) => error.name === "NotFoundError"
  );

  const inactiveService = new CartService({
    connect: async () => {},
    ProductModel: { findById: async () => product(productId, { active: false }) },
    CartModel: { findOne: async () => null }
  });
  await assert.rejects(
    () => inactiveService.addItem(userId, { productId, quantity: 1 }),
    (error) => {
      assert.ok(error instanceof CartConflictError);
      assert.equal(error.status, 409);
      return true;
    }
  );

  const unavailableService = new CartService({
    connect: async () => {
      throw new DatabaseUnavailableError();
    }
  });
  await assert.rejects(
    () => unavailableService.get(userId),
    (error) => {
      assert.ok(error instanceof DatabaseUnavailableError);
      assert.equal(error.status, 503);
      return true;
    }
  );
});

test("CartService adiciona item existente com $inc posicional", async () => {
  const cart = { user: userId, items: [{ product: productId, quantity: 2 }] };
  const operations = [];
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => [product()]
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        operations.push({ filter, update });
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  const result = await service.addItem(userId, { productId, quantity: 3 });
  assert.equal(result.items[0].quantity, 5);
  assert.deepEqual(Object.keys(operations[0].update), ["$inc"]);
  assert.equal(operations[0].update.$inc["items.$.quantity"], 3);
  assert.equal(operations[0].update.$set, undefined);
});

test("CartService rejeita atomicamente overflow de quantidade sem gravar", async () => {
  const cart = {
    user: userId,
    items: [{ product: productId, quantity: MAX_ITEM_QUANTITY }]
  };
  const operations = [];
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(productId, { price: 0 }),
      find: async () => []
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        operations.push({ filter, update });
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  await assert.rejects(
    () => service.addItem(userId, { productId, quantity: 1 }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, "Quantidade do carrinho excede o limite seguro.");
      return true;
    }
  );
  assert.equal(operations.length, 0);
  assert.equal(cart.items[0].quantity, MAX_ITEM_QUANTITY);
});

test("adições concorrentes próximas ao limite não ultrapassam inteiro seguro", async () => {
  const cart = {
    user: userId,
    items: [{ product: productId, quantity: MAX_ITEM_QUANTITY - 2 }]
  };
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(productId, { price: 0 }),
      find: async () => []
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        await Promise.resolve();
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  await Promise.all([
    service.addItem(userId, { productId, quantity: 1 }),
    service.addItem(userId, { productId, quantity: 1 })
  ]);
  assert.equal(cart.items[0].quantity, MAX_ITEM_QUANTITY);
  assert.ok(Number.isSafeInteger(cart.items[0].quantity));
});

test("CartService insere item ausente com $push condicionado", async () => {
  const cart = { user: userId, items: [] };
  const operations = [];
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => [product()]
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        operations.push({ filter, update });
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  await service.addItem(userId, { productId, quantity: 2 });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].update.$push.items.product, productId);
  assert.deepEqual(operations[0].filter["items.product"], { $ne: productId });
  assert.equal(Object.prototype.hasOwnProperty.call(operations[0].filter, "__v"), true);
  assert.equal(operations[0].update.$inc.__v, 1);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.__v, 1);
});

test("CartService relê e repete a operação correta após corrida de $push", async () => {
  const cart = { user: userId, items: [] };
  const operations = [];
  let incAttempts = 0;
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => [product()]
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        operations.push({ filter, update });
        if (update.$push) {
          // Simula outra requisição inserindo o mesmo produto entre a
          // leitura e a gravação desta chamada.
          cart.items.push({ product: productId, quantity: 4 });
          return null;
        }
        if (update.$inc && Object.prototype.hasOwnProperty.call(update.$inc, "items.$.quantity")) {
          incAttempts += 1;
          if (incAttempts === 1) return null;
        }
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  const result = await service.addItem(userId, { productId, quantity: 2 });
  assert.equal(operations.length, 3);
  assert.ok(operations[0].update.$push);
  assert.ok(
    operations[1].update.$inc && operations[1].update.$inc["items.$.quantity"]
  );
  assert.equal(operations[2].update.$inc["items.$.quantity"], 2);
  assert.equal(result.items[0].quantity, 6);
  assert.equal(cart.items.length, 1);
});

test("adições concorrentes do mesmo Product preservam a soma", async () => {
  const cart = { user: userId, items: [{ product: productId, quantity: 1 }] };
  const operations = [];
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => [product()]
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        operations.push({ filter, update });
        await Promise.resolve();
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  await Promise.all([
    service.addItem(userId, { productId, quantity: 2 }),
    service.addItem(userId, { productId, quantity: 3 })
  ]);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 6);
  // O item já existe desde o início para ambas as chamadas, então a
  // operação escolhida é sempre $inc (nunca $push ou reescrita completa do
  // array via $set). O número exato de tentativas pode variar (>= 2) porque,
  // sem lock em memória, uma corrida real de __v pode exigir uma releitura.
  assert.ok(operations.length >= 2);
  assert.ok(operations.every((operation) => operation.update.$inc));
  assert.equal(operations.some((operation) => operation.update.$set), false);
});

test("adições concorrentes de Products diferentes não sobrescrevem itens", async () => {
  const productA = productId;
  const productB = "507f1f77bcf86cd799439015";
  const cart = { user: userId, items: [] };
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async (id) => product(id),
      find: async () => cart.items.map((item) => product(item.product))
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        await Promise.resolve();
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  await Promise.all([
    service.addItem(userId, { productId: productA, quantity: 2 }),
    service.addItem(userId, { productId: productB, quantity: 4 })
  ]);
  assert.deepEqual(
    cart.items.map((item) => item.product).sort(),
    [productA, productB].sort()
  );
  assert.deepEqual(
    cart.items.map((item) => item.quantity).sort((a, b) => a - b),
    [2, 4]
  );
});

test("PUT usa $set posicional e DELETE usa $pull", async () => {
  const cart = {
    user: userId,
    items: [
      { product: productId, quantity: 1 },
      { product: inactiveProductId, quantity: 2 }
    ]
  };
  const operations = [];
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async (id) => product(id),
      find: async () => cart.items.map((item) => product(item.product))
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) => {
        operations.push({ filter, update });
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  await service.updateItem(userId, productId, { quantity: 7 });
  await service.removeItem(userId, inactiveProductId);
  assert.equal(operations[0].update.$set["items.$.quantity"], 7);
  assert.equal(operations[0].update.$set.items, undefined);
  assert.equal(operations[0].update.$inc.__v, 1);
  assert.deepEqual(operations[1].update.$pull, {
    items: { product: inactiveProductId }
  });
  assert.equal(operations[1].update.$inc.__v, 1);
  assert.equal(cart.items.some((item) => item.product === productId), true);
  assert.equal(cart.items.some((item) => item.product === inactiveProductId), false);
  assert.equal(cart.__v, 2);
});

test("alterar Product A não regrava nem remove Product B", async () => {
  const productA = productId;
  const productB = "507f1f77bcf86cd799439015";
  const cart = {
    user: userId,
    items: [
      { product: productA, quantity: 1 },
      { product: productB, quantity: 2 }
    ]
  };
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async (id) => product(id),
      find: async () => cart.items.map((item) => product(item.product))
    },
    CartModel: {
      findOne: async () => cart,
      findOneAndUpdate: async (filter, update) =>
        atomicCartUpdate(cart, filter, update)
    }
  });

  await service.updateItem(userId, productA, { quantity: 9 });
  assert.deepEqual(cart.items, [
    { product: productA, quantity: 9 },
    { product: productB, quantity: 2 }
  ]);
});

test("CartService recupera Cart criado por outra requisição após 11000", async () => {
  let lookupCount = 0;
  const recoveredCart = { user: userId, items: [] };
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => [product()]
    },
    CartModel: {
      findOne: async (filter) => {
        assert.deepEqual(filter, { user: userId });
        lookupCount += 1;
        return lookupCount === 1 ? null : recoveredCart;
      },
      create: async () => {
        const error = new Error("duplicate cart");
        error.code = 11000;
        throw error;
      },
      findOneAndUpdate: async (filter, update) => {
        assert.equal(filter.user, userId);
        return atomicCartUpdate(recoveredCart, filter, update);
      }
    }
  });

  const result = await service.addItem(userId, { productId, quantity: 2 });
  assert.equal(lookupCount, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(recoveredCart.items.length, 1);
  assert.equal(recoveredCart.items[0].product, productId);
});

test("CartService isola Cart A e preserva Cart B em operações autenticadas", async () => {
  const userA = "507f1f77bcf86cd799439011";
  const userB = "507f1f77bcf86cd799439015";
  const carts = {
    [userA]: { user: userA, items: [{ product: productId, quantity: 1 }] },
    [userB]: { user: userB, items: [{ product: inactiveProductId, quantity: 4 }] }
  };
  const cartBBefore = JSON.stringify(carts[userB]);
  const filters = [];
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => [product()]
    },
    CartModel: {
      findOne: async (filter) => {
        filters.push(filter);
        return carts[filter.user] || null;
      },
      findOneAndUpdate: async (filter, update) => {
        filters.push(filter);
        return atomicCartUpdate(carts[filter.user], filter, update);
      }
    }
  });

  await service.addItem(userA, { productId, quantity: 2 });
  await service.get(userA);
  await service.removeItem(userA, productId);
  assert.equal(JSON.stringify(carts[userB]), cartBBefore);
  assert.ok(filters.every((filter) => filter.user === userA));
});

// ---------------------------------------------------------------------------
// Concorrência entre INSTÂNCIAS independentes de CartService (não apenas
// chamadas concorrentes na mesma instância). Nenhum destes testes compartilha
// cartLocks ou qualquer estado interno de serviço: a única coisa em comum
// entre serviceA/serviceB é o "banco" simulado (createSharedCartStore), assim
// como duas réplicas/processos reais compartilhariam apenas o MongoDB.
// ---------------------------------------------------------------------------

function makeProduct(id, price) {
  return { _id: id, name: "Produto", price, active: true };
}

function makeProductModel(products) {
  return {
    findById: async (id) => products.get(id) || null,
    find: async (filter) =>
      filter._id.$in.map((id) => products.get(id)).filter(Boolean)
  };
}

function makeIsolatedCartModel(store, label) {
  // Cada instância recebe seu próprio objeto CartModel (sem estado
  // compartilhado além do "banco" simulado), como aconteceria com dois
  // processos Node distintos apontando para o mesmo MongoDB.
  return {
    findOne: (filter) => store.CartModel.findOne(filter, label),
    findOneAndUpdate: async (filter, update) => {
      await Promise.resolve();
      return store.CartModel.findOneAndUpdate(filter, update, label);
    }
  };
}

test("duas instâncias de CartService preservam o total seguro em CAS concorrente", async () => {
  const productA = "507f1f77bcf86cd799439021";
  const productB = "507f1f77bcf86cd799439022";
  const firstReadBarrier = createFirstReadBarrier();

  const store = createSharedCartStore(
    {
      [userId]: { user: userId, items: [] }
    },
    { onRead: (read) => firstReadBarrier.observe(read) }
  );
  const products = new Map([
    [productA, makeProduct(productA, 0.02)],
    [productB, makeProduct(productB, 0.02)]
  ]);
  const ProductModel = makeProductModel(products);

  const serviceA = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "A")
  });
  const serviceB = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "B")
  });

  const pending = Promise.allSettled([
    serviceA.addItem(userId, { productId: productA, quantity: 1 }),
    serviceB.addItem(userId, { productId: productB, quantity: 1 })
  ]);
  await firstReadBarrier.ready;

  const firstReadA = firstReadBarrier.reads.find((read) => read.label === "A");
  const firstReadB = firstReadBarrier.reads.find((read) => read.label === "B");
  assert.ok(firstReadA);
  assert.ok(firstReadB);
  assert.equal(firstReadA.version, firstReadB.version);
  assert.equal(firstReadA.version, 0);
  assert.equal(firstReadBarrier.isReleased, false);
  assert.equal(store.writes.length, 0);

  firstReadBarrier.release();
  assert.equal(firstReadBarrier.isReleased, true);
  const [resultA, resultB] = await pending;

  const outcomes = [resultA, resultB];
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

  // Ambas leram a mesma versão antes de qualquer escrita. Uma mutação vence
  // o CAS, a outra perde, relê a versão nova e confirma sem ultrapassar os
  // limites técnicos.
  assert.equal(fulfilled.length, 2);
  assert.equal(rejected.length, 0);

  const firstWrites = store.writes.filter(
    (write) => write.version === firstReadA.version
  );
  assert.equal(firstWrites.length, 2);
  assert.equal(firstWrites.filter((write) => write.accepted).length, 1);
  assert.equal(firstWrites.filter((write) => !write.accepted).length, 1);

  const losingLabel = firstWrites.find((write) => !write.accepted).label;
  const losingReads = store.reads.filter((read) => read.label === losingLabel);
  assert.equal(losingReads.length, 2);
  assert.equal(losingReads[1].version, firstReadA.version + 1);
  assert.equal(store.writes.length, 3);

  const finalCart = store.carts.get(userId);
  assert.equal(finalCart.items.length, 2);
  assert.equal(finalCart.__v, 2);

  const totalCents = finalCart.items.reduce((sum, item) => {
    const priceCents = Math.round(products.get(item.product).price * 100);
    return sum + priceCents * item.quantity;
  }, 0);
  assert.ok(Number.isSafeInteger(totalCents));
  assert.equal(totalCents, 4);

  // GET posterior nunca lança CartCalculationError, mesmo perto do limite.
  const verifyService = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "verify")
  });
  const getResult = await verifyService.get(userId);
  assert.ok(Number.isFinite(getResult.total));
});

test("duas instâncias concorrentes no mesmo Product perto do limite de quantidade não ultrapassam o inteiro seguro", async () => {
  const store = createSharedCartStore({
    [userId]: {
      user: userId,
      items: [{ product: productId, quantity: MAX_ITEM_QUANTITY - 1 }]
    }
  });
  const products = new Map([[productId, makeProduct(productId, 0)]]);
  const ProductModel = makeProductModel(products);
  const serviceA = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });
  const serviceB = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });

  const [resultA, resultB] = await Promise.allSettled([
    serviceA.addItem(userId, { productId, quantity: 1 }),
    serviceB.addItem(userId, { productId, quantity: 1 })
  ]);
  const outcomes = [resultA, resultB];
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);

  const finalCart = store.carts.get(userId);
  assert.equal(finalCart.items[0].quantity, MAX_ITEM_QUANTITY);
  assert.ok(Number.isSafeInteger(finalCart.items[0].quantity));
  assert.equal(finalCart.__v, 1);
});

test("quantidade máxima continua segura depois de repricing para o preço máximo", async () => {
  const products = new Map([
    [productId, makeProduct(productId, 0)]
  ]);
  const store = createSharedCartStore({
    [userId]: { user: userId, items: [] }
  });
  const ProductModel = makeProductModel(products);
  const service = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });

  await service.addItem(userId, {
    productId,
    quantity: MAX_ITEM_QUANTITY
  });
  products.set(
    productId,
    makeProduct(productId, MAX_PRODUCT_PRICE_CENTS / 100)
  );

  const result = await service.get(userId);
  const serialized = JSON.parse(JSON.stringify(result));
  assert.equal(result.items[0].quantity, MAX_ITEM_QUANTITY);
  assert.equal(
    result.items[0].subtotal,
    MAX_ITEM_QUANTITY * MAX_PRODUCT_PRICE_CENTS / 100
  );
  assert.ok(Number.isFinite(result.items[0].subtotal));
  assert.ok(Number.isFinite(result.total));
  assert.notEqual(serialized.items[0].subtotal, null);
  assert.notEqual(serialized.total, null);
});

test("repricing entre currentProduct e CAS mantém mutação e resposta seguras", async () => {
  const products = new Map([
    [productId, makeProduct(productId, 0)]
  ]);
  const store = createSharedCartStore({
    [userId]: { user: userId, items: [] }
  });
  let changed = false;
  const ProductModel = makeProductModel(products);
  const baseCartModel = makeIsolatedCartModel(store);
  const CartModel = {
    findOne: baseCartModel.findOne,
    findOneAndUpdate: async (filter, update) => {
      if (!changed) {
        changed = true;
        products.set(
          productId,
          makeProduct(productId, MAX_PRODUCT_PRICE_CENTS / 100)
        );
      }
      return baseCartModel.findOneAndUpdate(filter, update);
    }
  };
  const service = new CartService({ connect: async () => {}, ProductModel, CartModel });

  const result = await service.addItem(userId, {
    productId,
    quantity: MAX_ITEM_QUANTITY
  });
  assert.equal(result.items[0].subtotal, MAX_ITEM_QUANTITY * MAX_PRODUCT_PRICE_CENTS / 100);
  assert.ok(Number.isFinite(result.total));
  assert.equal(store.carts.get(userId).__v, 1);
});

test("repricing depois do CAS e antes da response mantém a resposta segura", async () => {
  const products = new Map([
    [productId, makeProduct(productId, 0)]
  ]);
  const store = createSharedCartStore({
    [userId]: { user: userId, items: [] }
  });
  let changed = false;
  const baseCartModel = makeIsolatedCartModel(store);
  const ProductModel = makeProductModel(products);
  const CartModel = {
    findOne: baseCartModel.findOne,
    findOneAndUpdate: async (filter, update) => {
      const updated = await baseCartModel.findOneAndUpdate(filter, update);
      if (!changed) {
        changed = true;
        products.set(
          productId,
          makeProduct(productId, MAX_PRODUCT_PRICE_CENTS / 100)
        );
      }
      return updated;
    }
  };
  const service = new CartService({ connect: async () => {}, ProductModel, CartModel });

  const result = await service.addItem(userId, {
    productId,
    quantity: MAX_ITEM_QUANTITY
  });
  const serialized = JSON.parse(JSON.stringify(result));
  assert.ok(Number.isFinite(result.items[0].subtotal));
  assert.ok(Number.isFinite(result.total));
  assert.notEqual(serialized.items[0].subtotal, null);
  assert.notEqual(serialized.total, null);
});

test("duas instâncias concorrentes com uma vaga confirmam somente uma nova linha", async () => {
  const existingItems = Array.from({ length: MAX_CART_LINES - 1 }, (_, index) => {
    const id = `507f1f77bcf86cd79944${String(index).padStart(4, "0")}`;
    return { product: id, quantity: 1 };
  });
  const productA = "507f1f77bcf86cd799440998";
  const productB = "507f1f77bcf86cd799440999";
  const products = new Map(
    existingItems.map((item) => [item.product, makeProduct(item.product, 0)])
  );
  products.set(productA, makeProduct(productA, 0));
  products.set(productB, makeProduct(productB, 0));
  const firstReadBarrier = createFirstReadBarrier();
  const store = createSharedCartStore(
    { [userId]: { user: userId, items: existingItems } },
    { onRead: (read) => firstReadBarrier.observe(read) }
  );
  const ProductModel = makeProductModel(products);
  const serviceA = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "A")
  });
  const serviceB = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "B")
  });

  const pending = Promise.allSettled([
    serviceA.addItem(userId, { productId: productA, quantity: 1 }),
    serviceB.addItem(userId, { productId: productB, quantity: 1 })
  ]);
  await firstReadBarrier.ready;
  const firstReads = firstReadBarrier.reads;
  assert.equal(firstReads.length, 2);
  assert.equal(firstReads[0].version, firstReads[1].version);
  assert.equal(store.writes.length, 0);
  firstReadBarrier.release();

  const outcomes = await pending;
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(
    outcomes.find((outcome) => outcome.status === "rejected").reason.status,
    409
  );
  assert.equal(store.carts.get(userId).items.length, MAX_CART_LINES);
  assert.equal(store.carts.get(userId).__v, 1);
  assert.equal(store.writes.filter((write) => write.accepted).length, 1);
  assert.equal(store.writes.filter((write) => !write.accepted).length, 1);
});

test("duas instâncias adicionando Products diferentes sem overflow confirmam ambas via releitura de __v", async () => {
  const productA = "507f1f77bcf86cd799439023";
  const productB = "507f1f77bcf86cd799439024";
  const store = createSharedCartStore({
    [userId]: { user: userId, items: [] }
  });
  const products = new Map([
    [productA, makeProduct(productA, 9.9)],
    [productB, makeProduct(productB, 4.5)]
  ]);
  const ProductModel = makeProductModel(products);
  const serviceA = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });
  const serviceB = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });

  await Promise.all([
    serviceA.addItem(userId, { productId: productA, quantity: 2 }),
    serviceB.addItem(userId, { productId: productB, quantity: 1 })
  ]);

  const finalCart = store.carts.get(userId);
  assert.deepEqual(
    finalCart.items.map((item) => item.product).sort(),
    [productA, productB].sort()
  );
  assert.equal(finalCart.items.find((item) => item.product === productA).quantity, 2);
  assert.equal(finalCart.items.find((item) => item.product === productB).quantity, 1);
  // Cada mutação confirmada incrementa __v uma vez; como nenhuma corrida se
  // resolveu com o mesmo produto, ambas confirmam na primeira tentativa.
  assert.equal(finalCart.__v, 2);
});

test("PUT concorrente com POST no mesmo Product converge para um estado consistente via __v", async () => {
  const firstReadBarrier = createFirstReadBarrier();
  const store = createSharedCartStore(
    {
      [userId]: { user: userId, items: [{ product: productId, quantity: 2 }] }
    },
    { onRead: (read) => firstReadBarrier.observe(read) }
  );
  const products = new Map([[productId, makeProduct(productId, 9.9)]]);
  const ProductModel = makeProductModel(products);
  const serviceA = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "PUT")
  });
  const serviceB = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store, "POST")
  });

  const pending = Promise.allSettled([
    serviceA.updateItem(userId, productId, { quantity: 5 }),
    serviceB.addItem(userId, { productId, quantity: 3 })
  ]);
  await firstReadBarrier.ready;

  const firstReadPut = firstReadBarrier.reads.find((read) => read.label === "PUT");
  const firstReadPost = firstReadBarrier.reads.find((read) => read.label === "POST");
  assert.ok(firstReadPut);
  assert.ok(firstReadPost);
  assert.equal(firstReadPut.version, firstReadPost.version);
  assert.equal(firstReadPut.version, 0);
  assert.equal(firstReadBarrier.isReleased, false);
  assert.equal(store.writes.length, 0);

  firstReadBarrier.release();
  assert.equal(firstReadBarrier.isReleased, true);
  const [putResult, postResult] = await pending;

  // Ambas as mutações devem eventualmente confirmar (a perdedora relê e
  // recalcula contra o estado já atualizado pela vencedora); nenhuma delas
  // pode lançar um erro inesperado nem sobrescrever a outra silenciosamente.
  assert.equal(putResult.status, "fulfilled");
  assert.equal(postResult.status, "fulfilled");

  const firstWrites = store.writes.filter(
    (write) => write.version === firstReadPut.version
  );
  assert.equal(firstWrites.length, 2);
  assert.equal(firstWrites.filter((write) => write.accepted).length, 1);
  assert.equal(firstWrites.filter((write) => !write.accepted).length, 1);
  const losingLabel = firstWrites.find((write) => !write.accepted).label;
  const losingReads = store.reads.filter((read) => read.label === losingLabel);
  assert.equal(losingReads.length, 2);
  assert.equal(losingReads[1].version, firstReadPut.version + 1);
  assert.equal(store.writes.length, 3);

  const finalCart = store.carts.get(userId);
  const finalQuantity = finalCart.items.find((item) => item.product === productId).quantity;
  // Dependendo de qual mutação confirma primeiro, o resultado determinístico
  // é PUT(5) seguido por POST(+3) = 8, ou POST(+3=5) seguido por PUT(5) = 5.
  assert.ok([5, 8].includes(finalQuantity));
  assert.equal(finalCart.__v, 2);
});

test("clear/remove concorrente com add converge para um estado consistente via __v", async () => {
  const store = createSharedCartStore({
    [userId]: { user: userId, items: [{ product: inactiveProductId, quantity: 1 }] }
  });
  const products = new Map([
    [inactiveProductId, makeProduct(inactiveProductId, 9.9)],
    [productId, makeProduct(productId, 9.9)]
  ]);
  const ProductModel = makeProductModel(products);
  const serviceA = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });
  const serviceB = new CartService({
    connect: async () => {},
    ProductModel,
    CartModel: makeIsolatedCartModel(store)
  });

  const [clearResult, addResult] = await Promise.allSettled([
    serviceA.clear(userId),
    serviceB.addItem(userId, { productId, quantity: 1 })
  ]);

  assert.equal(clearResult.status, "fulfilled");
  assert.equal(addResult.status, "fulfilled");

  const finalCart = store.carts.get(userId);
  // Resultado determinístico depende de qual mutação confirma por último:
  // se clear() vence por último, o carrinho fica vazio; se add() vence por
  // último (após reler o clear já aplicado), sobra somente o item novo.
  const productIds = finalCart.items.map((item) => item.product);
  assert.ok(
    productIds.length === 0 ||
      (productIds.length === 1 && productIds[0] === productId)
  );
  assert.equal(finalCart.__v, 2);
});

test("addItem esgota o limite de tentativas de versão e retorna 409 controlado, sem read-modify-write do array inteiro", async () => {
  let findOneCalls = 0;
  let writeAttempts = 0;
  const service = new CartService({
    connect: async () => {},
    ProductModel: {
      findById: async () => product(),
      find: async () => []
    },
    CartModel: {
      findOne: async () => {
        findOneCalls += 1;
        // Sempre devolve um Cart "fresco" sem o item, simulando conflito de
        // versão permanente (ex.: contenção extrema); nunca expõe o array
        // completo sendo reescrito.
        return { user: userId, items: [], __v: findOneCalls };
      },
      findOneAndUpdate: async () => {
        writeAttempts += 1;
        return null;
      }
    }
  });

  await assert.rejects(
    () => service.addItem(userId, { productId, quantity: 1 }),
    (error) => {
      assert.ok(error instanceof CartConflictError);
      assert.equal(error.status, 409);
      assert.match(error.message, /concorrentes/);
      return true;
    }
  );
  assert.equal(writeAttempts, 5);
});

test("FavoriteService isola favoritos A e preserva favoritos B", async () => {
  const userA = "507f1f77bcf86cd799439011";
  const userB = "507f1f77bcf86cd799439015";
  const users = {
    [userA]: { _id: userA, favorites: [] },
    [userB]: { _id: userB, favorites: [inactiveProductId] }
  };
  const userBBefore = JSON.stringify(users[userB]);
  const filters = [];
  const service = new FavoriteService({
    connect: async () => {},
    UserModel: {
      findById: async (id) => users[id],
      findOneAndUpdate: async (filter, update) => {
        filters.push(filter);
        if (update.$addToSet) users[filter._id].favorites.push(update.$addToSet.favorites);
        if (update.$pull) {
          users[filter._id].favorites = users[filter._id].favorites.filter(
            (id) => id !== update.$pull.favorites
          );
        }
        return users[filter._id];
      }
    },
    ProductModel: {
      findById: async () => product(),
      find: async (filter) =>
        filter._id.$in.map((id) => product(id))
    }
  });

  await service.add(userA, productId);
  await service.remove(userA, productId);
  assert.equal(JSON.stringify(users[userB]), userBBefore);
  assert.ok(filters.every((filter) => filter._id === userA));
});

test("rotas Cart/Favorites exigem autenticação e legado continua público", async () => {
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    for (const request of [
      { method: "GET", path: "/api/users/me/favorites" },
      { method: "POST", path: `/api/users/me/favorites/${productId}` },
      { method: "DELETE", path: `/api/users/me/favorites/${productId}` },
      { method: "GET", path: "/api/users/me/cart" },
      { method: "POST", path: "/api/users/me/cart/items" },
      { method: "PUT", path: `/api/users/me/cart/items/${productId}` },
      { method: "DELETE", path: `/api/users/me/cart/items/${productId}` },
      { method: "DELETE", path: "/api/users/me/cart" }
    ]) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method
      });
      assert.equal(response.status, 401);
    }
    assert.equal((await fetch(`${baseUrl}/api/produtos`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/pedidos`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
  } finally {
    await closeServer(server);
  }
});
