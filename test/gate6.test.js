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
const { CartConflictError, CartService } = require("../server/services/cart-service");
const { ForbiddenError } = require("../server/utils/auth-errors");
const authorize = require("../server/middleware/authorize");
const {
  normalizeQuantity,
  validateCartItemInput,
  validateCartQuantityInput
} = require("../server/utils/validation");

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
  const itemFilter = filter["items.product"];
  const items = cart.items || [];
  if (typeof itemFilter === "string") {
    if (!items.some((item) => item.product === itemFilter)) return null;
  }
  if (itemFilter && itemFilter.$ne && items.some((item) => item.product === itemFilter.$ne)) {
    return null;
  }
  if (update.$inc) {
    const item = items.find((candidate) => candidate.product === itemFilter);
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
  return cart;
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
  const inactive = product(inactiveProductId, { price: 10, active: false });
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
  assert.equal(result.items[1].product.active, false);
  assert.equal(result.items[2].product, null);
  assert.equal(result.unavailableItems, 2);
  assert.equal(result.total, 50);
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
  assert.equal(operations.length, 2);
  assert.deepEqual(Object.keys(operations[0].update), ["$inc"]);
  assert.equal(operations[1].update.$push.items.product, productId);
  assert.deepEqual(operations[1].filter["items.product"], { $ne: productId });
  assert.equal(cart.items.length, 1);
});

test("CartService repete $inc quando $push perde uma corrida", async () => {
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
        if (update.$inc) {
          incAttempts += 1;
          if (incAttempts === 1) return null;
        }
        if (update.$push) {
          cart.items.push({ product: productId, quantity: 4 });
          return null;
        }
        return atomicCartUpdate(cart, filter, update);
      }
    }
  });

  const result = await service.addItem(userId, { productId, quantity: 2 });
  assert.equal(operations.length, 3);
  assert.equal(operations[0].update.$inc["items.$.quantity"], 2);
  assert.equal(operations[1].update.$push.items.product, productId);
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
  assert.equal(operations.filter((operation) => operation.update.$inc).length, 2);
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
  assert.deepEqual(Object.keys(operations[0].update), ["$set"]);
  assert.equal(operations[0].update.$set["items.$.quantity"], 7);
  assert.equal(operations[0].update.$set.items, undefined);
  assert.deepEqual(Object.keys(operations[1].update), ["$pull"]);
  assert.deepEqual(operations[1].update.$pull, {
    items: { product: inactiveProductId }
  });
  assert.equal(cart.items.some((item) => item.product === productId), true);
  assert.equal(cart.items.some((item) => item.product === inactiveProductId), false);
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
