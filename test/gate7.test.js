const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const test = require("node:test");
const app = require("../server/server");
const Order = require("../server/models/Order");
const { UserOrderService } = require("../server/services/user-order-service");
const {
  MAX_CART_LINES,
  MAX_CART_TOTAL_CENTS,
  MAX_ITEM_QUANTITY,
  MAX_PRODUCT_PRICE_CENTS
} = require("../server/domain/commerce-limits");

const userId = "507f1f77bcf86cd799439011";
const addressId = "507f1f77bcf86cd799439012";
const productId = "507f1f77bcf86cd799439013";

function fixtures() {
  return {
    cart: {
      user: userId,
      __v: 4,
      items: [{ product: productId, quantity: 2 }]
    },
    address: {
      _id: addressId,
      user: userId,
      cep: "01310100",
      street: "Rua A",
      number: "10",
      complement: "",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP"
    },
    product: { _id: productId, name: "Produto", price: 19.99, active: true }
  };
}

test("Order schema permite múltiplos pedidos por usuário e indexa versão", () => {
  const userPath = Order.schema.path("user");
  assert.equal(userPath.options.index, true);
  assert.notEqual(userPath.options.unique, true);
  assert.ok(
    Order.schema.indexes().some(([fields, options]) =>
      fields.user === 1 && fields.sourceCartVersion === 1 && options.unique
    )
  );
  assert.deepEqual(Order.schema.path("status").enumValues, ["pending", "cancelled"]);
});

test("checkout captura snapshots em centavos e limpa somente por CAS", async () => {
  const value = fixtures();
  const updates = [];
  const orders = [];
  let storedOrder;
  const service = new UserOrderService({
    connect: async () => {},
    AddressModel: { findOne: async (filter) => filter._id === addressId && filter.user === userId ? value.address : null },
    CartModel: {
      findOne: async () => value.cart,
      findOneAndUpdate: async (filter, update) => {
        updates.push({ filter, update });
        return { ...value.cart, __v: 5, items: [] };
      }
    },
    ProductModel: { find: async () => [value.product] },
    OrderModel: {
      findOne: async () => null,
      create: async (data) => {
        const order = { _id: new mongoose.Types.ObjectId().toString(), ...data };
        orders.push(order);
        storedOrder = order;
        return order;
      }
    }
  });

  const order = await service.create(userId, { addressId });
  assert.equal(order.sourceCartVersion, 4);
  assert.equal(order.items[0].productId, productId);
  assert.equal(order.items[0].unitPriceCents, 1999);
  assert.equal(order.items[0].subtotalCents, 3998);
  assert.equal(order.totalCents, 3998);
  assert.deepEqual(order.shippingAddress, {
    cep: "01310100", street: "Rua A", number: "10", complement: "",
    neighborhood: "Centro", city: "São Paulo", state: "SP"
  });
  assert.equal(orders.length, 1);
  value.product.name = "Produto renomeado";
  value.product.price = 99.99;
  value.address.street = "Rua alterada";
  assert.equal(order.items[0].name, "Produto");
  assert.equal(order.items[0].unitPriceCents, 1999);
  assert.equal(order.shippingAddress.street, "Rua A");
  assert.deepEqual(updates[0], {
    filter: { user: userId, __v: 4 },
    update: { $set: { items: [] }, $inc: { __v: 1 } }
  });
  value.product = null;
  value.address = null;
  const historical = {
    ...storedOrder,
    items: storedOrder.items.map((item) => ({ ...item })),
    shippingAddress: { ...storedOrder.shippingAddress }
  };
  const readService = new UserOrderService({
    connect: async () => {},
    OrderModel: {
      findOne: async (filter) => filter._id ? historical : null
    }
  });
  const readOrder = await readService.get(userId, historical._id);
  assert.equal(readOrder.items[0].name, "Produto");
  assert.equal(readOrder.items[0].unitPriceCents, 1999);
  assert.equal(readOrder.shippingAddress.street, "Rua A");
});

test("checkout rejeita carrinho ou produto inválido sem criar pedido", async () => {
  const value = fixtures();
  let creates = 0;
  const makeService = (cart, product) => new UserOrderService({
    connect: async () => {},
    AddressModel: { findOne: async () => value.address },
    CartModel: { findOne: async () => cart, findOneAndUpdate: async () => { throw new Error("não deve limpar"); } },
    ProductModel: { find: async () => product ? [product] : [] },
    OrderModel: { findOne: async () => null, create: async () => { creates += 1; } }
  });
  await assert.rejects(() => makeService({ ...value.cart, items: [] }).create(userId, { addressId }), { status: 409 });
  await assert.rejects(() => makeService(value.cart, null).create(userId, { addressId }), { status: 409 });
  await assert.rejects(() => makeService(value.cart, { ...value.product, active: false }).create(userId, { addressId }), { status: 409 });
  await assert.rejects(() => makeService(value.cart, { ...value.product, price: Number.NaN }).create(userId, { addressId }), { status: 409 });
  await assert.rejects(() => makeService({ ...value.cart, items: [{ product: productId, quantity: 0 }] }, value.product).create(userId, { addressId }), { status: 409 });
  await assert.rejects(() => makeService({ ...value.cart, items: Array.from({ length: MAX_CART_LINES + 1 }, () => ({ product: productId, quantity: 1 })) }, value.product).create(userId, { addressId }), { status: 409 });
  assert.equal(creates, 0);
});

test("checkout não infere retry para carrinho vazio com Order anterior", async () => {
  const value = fixtures();
  const queriedVersions = [];
  const service = new UserOrderService({
    connect: async () => {},
    CartModel: { findOne: async () => ({ ...value.cart, items: [] }) },
    OrderModel: {
      findOne: async (filter) => {
        queriedVersions.push(filter.sourceCartVersion);
        return { _id: "old-order", sourceCartVersion: 3 };
      }
    }
  });

  await assert.rejects(
    () => service.create(userId, { addressId }),
    { status: 409 }
  );
  assert.deepEqual(queriedVersions, []);
});

test("checkout não infere versão zero para carrinho inexistente", async () => {
  const queried = [];
  const service = new UserOrderService({
    connect: async () => {},
    CartModel: { findOne: async () => null },
    OrderModel: {
      findOne: async (filter) => {
        queried.push(filter);
        return { _id: "old-order", sourceCartVersion: 0 };
      }
    }
  });

  await assert.rejects(
    () => service.create(userId, { addressId }),
    { status: 409 }
  );
  assert.deepEqual(queried, []);
});

test("checkout aceita somente addressId e rejeita campos de cliente", async () => {
  const value = fixtures();
  const service = new UserOrderService({
    connect: async () => {},
    AddressModel: { findOne: async () => value.address },
    CartModel: { findOne: async () => value.cart },
    ProductModel: { find: async () => [value.product] },
    OrderModel: { findOne: async () => null, create: async () => { throw new Error("não deve criar"); } }
  });
  for (const payload of [
    {},
    { addressId, user: userId },
    { addressId, userId },
    { addressId, items: [] },
    { addressId, price: 1 },
    { addressId, total: 1 },
    { addressId, totalCents: 1 },
    { addressId, sourceCartVersion: 1 },
    { addressId, status: "cancelled" }
  ]) {
    await assert.rejects(() => service.create(userId, payload), { status: 409 });
  }
});

test("retry da mesma versão preserva alterações quando o clear CAS não casa", async () => {
  const value = fixtures();
  const updates = [];
  const existing = { _id: "order-1", user: userId, sourceCartVersion: 4 };
  const service = new UserOrderService({
    connect: async () => {},
    AddressModel: { findOne: async () => value.address },
    CartModel: {
      findOne: async () => value.cart,
      findOneAndUpdate: async (filter, update) => {
        updates.push({ filter, update });
        return null;
      }
    },
    ProductModel: { find: async () => [value.product] },
    OrderModel: { findOne: async () => existing, create: async () => { throw new Error("não deve criar"); } }
  });
  assert.equal(await service.create(userId, { addressId }), existing);
  assert.deepEqual(updates[0].filter, { user: userId, __v: 4 });
  assert.equal(updates[0].update.$inc.__v, 1);
});

test("limites monetários e de quantidade permanecem seguros", () => {
  assert.ok(Number.isSafeInteger(MAX_CART_TOTAL_CENTS));
  assert.ok(MAX_ITEM_QUANTITY > 0);
  assert.ok(MAX_PRODUCT_PRICE_CENTS > 0);
});

test("Order exige entre uma e MAX_CART_LINES linhas e cancelledAt nulo por padrão", () => {
  const items = (count) =>
    Array.from({ length: count }, (_, index) => ({
      productId: new mongoose.Types.ObjectId(),
      name: `Produto ${index}`,
      quantity: 1,
      unitPriceCents: 100,
      subtotalCents: 100
    }));
  const base = {
    user: new mongoose.Types.ObjectId(),
    sourceCartVersion: 1,
    shippingAddress: {
      cep: "01310100", street: "Rua A", number: "10",
      neighborhood: "Centro", city: "São Paulo", state: "SP"
    },
    totalCents: 100
  };
  const validationError =
    new Order({ ...base, items: items(1) }).validateSync();
  assert.equal(validationError, undefined);
  assert.equal(new Order({ ...base, items: items(1) }).cancelledAt, null);
  assert.ok(new Order({ ...base, items: items(0) }).validateSync().errors.items);
  assert.ok(new Order({ ...base, items: items(MAX_CART_LINES + 1) }).validateSync().errors.items);
});

test("OrderModel readiness é compartilhado e falha permite retry", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const events = [];
  const model = {
    createIndexes: () => {
      calls += 1;
      events.push("indexes");
      return gate.then(() => events.push("ready"));
    },
    find: () => {
      events.push("find");
      return { sort: async () => [] };
    }
  };
  const service = new UserOrderService({ connect: async () => events.push("connect"), OrderModel: model });
  const first = service.list(userId);
  const second = service.list(userId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(events.filter((event) => event === "connect").length, 2);
  assert.equal(events.filter((event) => event === "indexes").length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(events.indexOf("ready") > events.lastIndexOf("indexes"), true);
  assert.equal(events.slice(-2).every((event) => event === "find"), true);

  let failedCalls = 0;
  const retryService = new UserOrderService({
    connect: async () => {},
    OrderModel: {
      createIndexes: async () => {
        failedCalls += 1;
        if (failedCalls === 1) throw new Error("index failure");
      },
      find: () => ({ sort: async () => [] })
    }
  });
  await assert.rejects(() => retryService.list(userId), { status: 503 });
  await retryService.list(userId);
  assert.equal(failedCalls, 2);

  let initCalls = 0;
  const fallbackService = new UserOrderService({
    connect: async () => {},
    OrderModel: {
      init: async () => { initCalls += 1; },
      find: () => ({ sort: async () => [] })
    }
  });
  await fallbackService.list(userId);
  assert.equal(initCalls, 1);
});

test("duas instâncias fazem checkout por CAS único e resolvem duplicate key sem 500", async () => {
  const value = fixtures();
  let releaseReadiness;
  let releaseCartReads;
  let releaseOrderReads;
  let readinessCalls = 0;
  let cartReads = 0;
  let orderReads = 0;
  let createAttempts = 0;
  let duplicateKeyErrors = 0;
  const readinessReady = new Promise((resolve) => { releaseReadiness = resolve; });
  const cartReadsReady = new Promise((resolve) => { releaseCartReads = resolve; });
  const orderReadsReady = new Promise((resolve) => { releaseOrderReads = resolve; });
  const orders = new Map();
  const store = {
    cart: value.cart,
    OrderModel: {
      createIndexes: async () => {
        readinessCalls += 1;
        if (readinessCalls === 2) releaseReadiness();
        await readinessReady;
      },
      findOne: async (filter) => {
        orderReads += 1;
        if (orderReads <= 2) {
          if (orderReads === 2) releaseOrderReads();
          await orderReadsReady;
          return null;
        }
        return orders.get(`${filter.user}:${filter.sourceCartVersion}`) || null;
      },
      create: async (data) => {
        createAttempts += 1;
        const key = `${data.user}:${data.sourceCartVersion}`;
        if (orders.has(key)) {
          duplicateKeyErrors += 1;
          const error = new Error("duplicate");
          error.code = 11000;
          throw error;
        }
        orders.set(key, { _id: "same-order", ...data });
        return orders.get(key);
      }
    },
    CartModel: {
      findOne: async () => {
        cartReads += 1;
        if (cartReads === 2) releaseCartReads();
        await cartReadsReady;
        return {
          ...store.cart,
          items: store.cart.items.map((item) => ({ ...item }))
        };
      },
      findOneAndUpdate: async (filter, update) => {
        if (filter.__v !== store.cart.__v) return null;
        store.cart = { ...store.cart, __v: store.cart.__v + update.$inc.__v, items: [] };
        return store.cart;
      }
    },
    ProductModel: { find: async () => [value.product] },
    AddressModel: { findOne: async () => value.address }
  };
  const services = [
    new UserOrderService({ connect: async () => {}, ...store }),
    new UserOrderService({ connect: async () => {}, ...store })
  ];
  const pending = services.map((service) => service.create(userId, { addressId }));
  await readinessReady;
  assert.equal(readinessCalls, 2);
  await cartReadsReady;
  assert.equal(cartReads, 2);
  assert.equal(createAttempts, 0);
  await orderReadsReady;
  assert.equal(orderReads, 2);
  assert.equal(createAttempts, 0);
  const results = await Promise.all(pending);
  assert.equal(orders.size, 1);
  assert.equal(results[0]._id, "same-order");
  assert.equal(results[1]._id, "same-order");
  assert.equal(duplicateKeyErrors, 1);
  assert.equal(createAttempts, 2);
  assert.equal(store.cart.__v, 5);
});

test("retry após falha de clear recupera Order da mesma versão e tenta CAS novamente", async () => {
  const value = fixtures();
  let creates = 0;
  let clears = 0;
  const order = { _id: "same-order", user: userId, sourceCartVersion: 4 };
  const service = new UserOrderService({
    connect: async () => {},
    AddressModel: { findOne: async () => value.address },
    CartModel: {
      findOne: async () => value.cart,
      findOneAndUpdate: async () => {
        clears += 1;
        if (clears === 1) throw Object.assign(new Error("storage down"), { status: 503 });
        return { ...value.cart, __v: 5, items: [] };
      }
    },
    ProductModel: { find: async () => [value.product] },
    OrderModel: {
      findOne: async () => (creates ? order : null),
      create: async (data) => { creates += 1; return { ...order, ...data }; }
    }
  });
  await assert.rejects(() => service.create(userId, { addressId }), { status: 503 });
  const result = await service.create(userId, { addressId });
  assert.equal(result._id, "same-order");
  assert.equal(creates, 1);
  assert.equal(clears, 2);
  // Sem Idempotency-Key, retry após resposta perdida depois do clear não é garantia.
});

test("Orders e endereços respeitam ownership por usuário", async () => {
  const value = fixtures();
  const otherUserId = "507f1f77bcf86cd799439014";
  const ownOrder = { _id: "507f1f77bcf86cd799439099", user: userId };
  const otherOrder = { _id: "507f1f77bcf86cd799439098", user: otherUserId };
  const queries = [];
  const service = new UserOrderService({
    connect: async () => {},
    AddressModel: {
      findOne: async (filter) => {
        queries.push({ type: "address", filter });
        return filter.user === userId ? value.address : null;
      }
    },
    CartModel: { findOne: async () => value.cart },
    ProductModel: { find: async () => [value.product] },
    OrderModel: {
      findOne: async (filter) => {
        queries.push({ type: "order", filter });
        if (filter._id === ownOrder._id && filter.user === userId) return ownOrder;
        return null;
      },
      find: (filter) => ({
        sort: async () => filter.user === userId ? [ownOrder] : [otherOrder]
      }),
      create: async () => ownOrder,
      findOneAndUpdate: async () => ownOrder
    }
  });

  await assert.rejects(
    () => service.create(otherUserId, { addressId }),
    { status: 404 }
  );
  await assert.rejects(
    () => service.get(otherUserId, ownOrder._id),
    { status: 404 }
  );
  assert.deepEqual(await service.list(userId), [ownOrder]);
  assert.equal(
    queries.some(({ type, filter }) =>
      type === "address" && filter._id === addressId && filter.user === otherUserId
    ),
    true
  );
  assert.equal(
    queries.some(({ type, filter }) =>
      type === "order" && filter._id === ownOrder._id && filter.user === otherUserId
    ),
    true
  );
});

test("cancelamento preserva snapshots, exige ownership e não restaura Cart", async () => {
  const value = fixtures();
  const original = {
    _id: "507f1f77bcf86cd799439099", user: userId, status: "pending", cancelledAt: null,
    items: [{ productId, name: "Produto", quantity: 2, unitPriceCents: 1999, subtotalCents: 3998 }],
    totalCents: 3998,
    shippingAddress: { cep: "01310100", street: "Rua A", number: "10", complement: "", neighborhood: "Centro", city: "São Paulo", state: "SP" }
  };
  const updates = [];
  const service = new UserOrderService({
    connect: async () => {},
    OrderModel: {
      findOne: async (filter) =>
        filter.user === userId ? original : null,
      findOneAndUpdate: async (filter, update) => {
        updates.push({ filter, update });
        if (filter.user !== userId) return null;
        if (filter.status !== "pending") return null;
        if (original.status !== "pending") return null;
        original.status = "cancelled";
        return { ...original, status: "cancelled", cancelledAt: new Date() };
      }
    }
  });
  const cancelled = await service.cancel(userId, "507f1f77bcf86cd799439099");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt instanceof Date);
  assert.deepEqual(updates[0].update.$set.status, "cancelled");
  assert.ok(updates[0].update.$set.cancelledAt instanceof Date);
  assert.deepEqual(updates[0].filter, { _id: "507f1f77bcf86cd799439099", user: userId, status: "pending", cancelledAt: null });
  await assert.rejects(() => service.cancel(userId, "507f1f77bcf86cd799439099", { status: "cancelled" }), { status: 409 });
  await assert.rejects(() => service.cancel("507f1f77bcf86cd799439098", "507f1f77bcf86cd799439099"), { status: 404 });
  assert.deepEqual(cancelled.items, original.items);
  assert.equal(cancelled.totalCents, original.totalCents);
  assert.deepEqual(cancelled.shippingAddress, original.shippingAddress);
  assert.deepEqual(value.cart.items, [{ product: productId, quantity: 2 }]);
});

test("rotas de Order exigem autenticação", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/users/me/orders`);
  const cancelResponse = await fetch(
    `http://127.0.0.1:${port}/api/users/me/orders/${productId}/cancel`,
    { method: "PATCH" }
  );
  const statusAliasResponse = await fetch(
    `http://127.0.0.1:${port}/api/users/me/orders/${productId}/status`,
    { method: "PATCH" }
  );
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.equal(response.status, 401);
  assert.equal(cancelResponse.status, 401);
  assert.equal(statusAliasResponse.status, 404);
});
