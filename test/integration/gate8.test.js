const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { after, before, beforeEach, test } = require("node:test");

const TEST_DATABASE_PATTERN = /^tributasales_test_[A-Za-z0-9_]+$/;
const FORBIDDEN_DATABASE_NAMES = new Set([
  "tributasales_dev",
  "tributasales_preview",
  "tributasales_prod"
]);

function requireTestEnvironment() {
  for (const name of ["NODE_ENV", "APP_ENV", "MONGO_URI", "JWT_SECRET"]) {
    assert.ok(process.env[name], `${name} deve estar definido antes dos imports.`);
  }
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.APP_ENV, "test");
  assert.match(process.env.MONGO_URI, /^mongodb(?:\+srv)?:\/\//);
  assert.ok(process.env.JWT_SECRET.length >= 32);
}

function assertSafeConnectedDatabase() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.APP_ENV, "test");
  assert.ok(mongoose.connection.db);
  const databaseName = mongoose.connection.db.databaseName;
  assert.match(databaseName, TEST_DATABASE_PATTERN);
  assert.equal(FORBIDDEN_DATABASE_NAMES.has(databaseName), false);
  return databaseName;
}

requireTestEnvironment();

const User = require("../../server/models/User");
const Category = require("../../server/models/Category");
const Cart = require("../../server/models/Cart");
const Product = require("../../server/models/Product");
const Address = require("../../server/models/Address");
const Order = require("../../server/models/Order");
const { prepareModelIndexes } = require("../../server/utils/model-index-readiness");
const { NotFoundError } = require("../../server/middleware/error-middleware");
const { UserService } = require("../../server/services/user-service");
const { CategoryService } = require("../../server/services/category-service");
const { UserOrderService } = require("../../server/services/user-order-service");

const connectReal = async () => mongoose.connection;
const collections = [User, Category, Cart, Product, Address, Order];
let safeConnected = false;

function objectId() {
  return new mongoose.Types.ObjectId();
}

function duplicateKey(error) {
  assert.equal(error.code, 11000);
  return true;
}

function hasUniqueIndex(indexes, key) {
  return indexes.some(
    (index) => index.unique === true && JSON.stringify(index.key) === JSON.stringify(key)
  );
}

async function createUser(suffix = objectId().toString()) {
  return User.create({
    name: `Integração ${suffix.slice(-8)}`,
    email: `integration-${suffix}@example.com`,
    passwordHash: "hash-fixture",
    role: "user"
  });
}

async function createCategory(suffix = objectId().toString()) {
  return Category.create({
    name: `Categoria ${suffix.slice(-8)}`,
    slug: `categoria-${suffix.replace(/[^a-z0-9]/gi, "").slice(-20)}`,
    description: "Integração",
    active: true
  });
}

async function createProduct(category) {
  return Product.create({
    name: "Produto de integração",
    description: "Snapshot real",
    price: 19.99,
    category: category._id,
    active: true
  });
}

async function createAddress(user, overrides = {}) {
  return Address.create({
    user: user._id,
    cep: "01310100",
    street: "Rua de Integração",
    number: "10",
    complement: "",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    ...overrides
  });
}

async function createCart(user, product, quantity = 2) {
  return Cart.create({
    user: user._id,
    items: [{ product: product._id, quantity }]
  });
}

function orderPayload(user, sourceCartVersion = 0) {
  const productId = objectId();
  return {
    user: user._id,
    sourceCartVersion,
    items: [{
      productId,
      name: "Produto histórico",
      quantity: 1,
      unitPriceCents: 100,
      subtotalCents: 100
    }],
    totalCents: 100,
    shippingAddress: {
      cep: "01310100",
      street: "Rua histórica",
      number: "10",
      complement: "",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP"
    }
  };
}

async function clearCollections() {
  await Promise.all(collections.map((Model) => Model.deleteMany({})));
}

function barrier(expected) {
  let arrived = 0;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return {
    async wait() {
      arrived += 1;
      if (arrived === expected) release();
      await released;
    },
    get arrived() {
      return arrived;
    }
  };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  });
  assertSafeConnectedDatabase();
  safeConnected = true;
  await mongoose.connection.db.dropDatabase();
  assertSafeConnectedDatabase();
  await Promise.all([
    prepareModelIndexes(User),
    prepareModelIndexes(Category),
    Cart.createIndexes(),
    Product.createIndexes(),
    Address.createIndexes(),
    Order.createIndexes()
  ]);
});

beforeEach(clearCollections);

after(async () => {
  if (mongoose.connection.readyState !== 1) return;
  if (!safeConnected) {
    await mongoose.disconnect();
    return;
  }
  let cleanupError;
  try {
    assertSafeConnectedDatabase();
    await mongoose.connection.db.dropDatabase();
  } catch (error) {
    cleanupError = error;
  } finally {
    await mongoose.disconnect();
  }
  if (cleanupError) throw cleanupError;
});

test("Mongo real materializa índices únicos e produz 11000 direto", async () => {
  const indexes = {
    user: await User.collection.listIndexes().toArray(),
    category: await Category.collection.listIndexes().toArray(),
    cart: await Cart.collection.listIndexes().toArray(),
    order: await Order.collection.listIndexes().toArray()
  };
  assert.equal(hasUniqueIndex(indexes.user, { email: 1 }), true);
  assert.equal(hasUniqueIndex(indexes.category, { slug: 1 }), true);
  assert.equal(hasUniqueIndex(indexes.cart, { user: 1 }), true);
  assert.equal(
    hasUniqueIndex(indexes.order, { user: 1, sourceCartVersion: 1 }),
    true
  );

  const user = await createUser("duplicate-user");
  await assert.rejects(
    () => User.create({
      name: "Usuário duplicado",
      email: user.email,
      passwordHash: "hash-fixture",
      role: "user"
    }),
    duplicateKey
  );

  const category = await createCategory("duplicate-category");
  await assert.rejects(
    () => Category.create({
      name: "Outra categoria",
      slug: category.slug,
      active: true
    }),
    duplicateKey
  );

  await Cart.create({ user: user._id, items: [] });
  await assert.rejects(
    () => Cart.create({ user: user._id, items: [] }),
    duplicateKey
  );

  const firstOrder = await Order.create(orderPayload(user));
  await assert.rejects(
    () => Order.create(orderPayload(user)),
    duplicateKey
  );
  assert.ok(firstOrder._id);
});

test("readiness real é funcional e fault path reseta Promise para retry", async () => {
  await Promise.all([prepareModelIndexes(User), prepareModelIndexes(Category)]);
  assert.equal(
    hasUniqueIndex(await User.collection.listIndexes().toArray(), { email: 1 }),
    true
  );
  assert.equal(
    hasUniqueIndex(await Category.collection.listIndexes().toArray(), { slug: 1 }),
    true
  );

  let attempts = 0;
  const failingModel = {
    createIndexes: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("controlled readiness failure");
    }
  };
  await assert.rejects(
    () => prepareModelIndexes(failingModel),
    (error) => error.status === 503
  );
  await prepareModelIndexes(failingModel);
  assert.equal(attempts, 2);
});

test("CAS real por __v preserva alteração concorrente", async () => {
  const user = await createUser("cas");
  const category = await createCategory("cas");
  const product = await createProduct(category);
  const cart = await createCart(user, product, 1);
  const version = cart.__v;

  const winner = await Cart.findOneAndUpdate(
    { user: user._id, __v: version },
    { $set: { items: [{ product: product._id, quantity: 2 }] }, $inc: { __v: 1 } },
    { new: true, runValidators: true }
  );
  const stale = await Cart.findOneAndUpdate(
    { user: user._id, __v: version },
    { $set: { items: [] }, $inc: { __v: 1 } },
    { new: true, runValidators: true }
  );

  assert.equal(winner.__v, version + 1);
  assert.equal(stale, null);
  const current = await Cart.findOne({ user: user._id });
  assert.equal(current.items[0].quantity, 2);
  assert.equal(current.__v, version + 1);
});

test("duas instâncias reais deduplicam Order na mesma versão e preservam CAS", async () => {
  const user = await createUser("concurrency");
  const category = await createCategory("concurrency");
  const product = await createProduct(category);
  const address = await createAddress(user);
  const cart = await createCart(user, product, 2);
  const cartReads = barrier(2);
  const orderReads = barrier(2);
  let initialOrderReads = 0;

  const CartModel = {
    findOne: async (...args) => {
      const result = await Cart.findOne(...args);
      await cartReads.wait();
      return result;
    },
    findOneAndUpdate: (...args) => Cart.findOneAndUpdate(...args)
  };
  const OrderModel = {
    createIndexes: () => Order.createIndexes(),
    findOne: async (...args) => {
      const result = await Order.findOne(...args);
      if (initialOrderReads < 2) {
        initialOrderReads += 1;
        await orderReads.wait();
        return result;
      }
      return result;
    },
    create: (...args) => Order.create(...args)
  };
  const options = {
    connect: connectReal,
    CartModel,
    OrderModel,
    ProductModel: Product,
    AddressModel: Address
  };
  const first = new UserOrderService(options);
  const second = new UserOrderService(options);
  const results = await Promise.all([
    first.create(user._id.toString(), { addressId: address._id.toString() }),
    second.create(user._id.toString(), { addressId: address._id.toString() })
  ]);

  assert.equal(results[0]._id.toString(), results[1]._id.toString());
  assert.equal(
    await Order.countDocuments({
      user: user._id,
      sourceCartVersion: cart.__v
    }),
    1
  );
  const currentCart = await Cart.findOne({ user: user._id });
  assert.deepEqual(currentCart.items, []);
  assert.equal(currentCart.__v, cart.__v + 1);
});

test("Order real preserva snapshot, ownership e cancelamento", async () => {
  const user = await createUser("snapshot");
  const otherUser = await createUser("other");
  const category = await createCategory("snapshot");
  const product = await createProduct(category);
  const address = await createAddress(user);
  await createCart(user, product, 2);
  await createCart(otherUser, product, 1);
  const service = new UserOrderService({
    connect: connectReal,
    OrderModel: Order,
    CartModel: Cart,
    ProductModel: Product,
    AddressModel: Address
  });

  const order = await service.create(user._id.toString(), {
    addressId: address._id.toString()
  });
  await Product.updateOne(
    { _id: product._id },
    { $set: { name: "Produto renomeado", price: 99.99 } }
  );
  await Address.updateOne(
    { _id: address._id },
    { $set: { street: "Rua alterada" } }
  );
  await Product.deleteOne({ _id: product._id });
  await Address.deleteOne({ _id: address._id });

  const historical = await Order.findById(order._id);
  assert.equal(historical.items[0].name, "Produto de integração");
  assert.equal(historical.items[0].unitPriceCents, 1999);
  assert.equal(historical.shippingAddress.street, "Rua de Integração");

  await assert.rejects(
    () => service.get(otherUser._id.toString(), order._id.toString()),
    (error) => error instanceof NotFoundError && error.status === 404
  );
  await assert.rejects(
    () => service.create(otherUser._id.toString(), {
      addressId: address._id.toString()
    }),
    (error) => error.status === 404
  );

  const cancelled = await service.cancel(user._id.toString(), order._id.toString());
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt instanceof Date);
  const persisted = await Order.findById(order._id);
  assert.equal(persisted.status, "cancelled");
  assert.ok(persisted.cancelledAt instanceof Date);
});

test("User e Category services aguardam índices reais antes de criar", async () => {
  const userService = new UserService({
    UserModel: User,
    connect: connectReal
  });
  const categoryService = new CategoryService({
    CategoryModel: Category,
    ProductModel: Product,
    connect: connectReal
  });

  const user = await userService.create({
    name: "Readiness User",
    email: `readiness-${objectId()}@example.com`,
    passwordHash: "hash-fixture"
  });
  const category = await categoryService.create({
    name: "Readiness Category",
    description: "Índice real"
  });

  assert.ok(user._id);
  assert.match(category.slug, /^readiness-category$/);
});
