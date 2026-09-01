const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
const test = require("node:test");

process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "";

const app = require("../server/server");
const Category = require("../server/models/Category");
const Product = require("../server/models/Product");
const { NotFoundError } = require("../server/middleware/error-middleware");
const { CategoryService, ConflictError } = require("../server/services/category-service");
const { CatalogProductService } = require("../server/services/catalog-product-service");
const authorize = require("../server/middleware/authorize");
const { ForbiddenError } = require("../server/utils/auth-errors");
const {
  normalizePrice,
  normalizeSlug,
  validateCategoryInput,
  validateProductInput
} = require("../server/utils/validation");

const categoryId = "507f1f77bcf86cd799439011";
const productId = "507f1f77bcf86cd799439012";

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

test("define Category e Product com schemas, índices e referência", () => {
  const category = new Category({
    name: "Eletrônicos",
    slug: "eletronicos",
    description: "Tecnologia",
    active: true
  });
  const product = new Product({
    name: "Fone",
    description: "Bluetooth",
    price: 99.9,
    category: new mongoose.Types.ObjectId(categoryId),
    featured: true
  });

  assert.equal(Category.schema.path("slug").options.unique, true);
  assert.equal(Category.schema.path("slug").options.index, true);
  assert.equal(Category.schema.options.timestamps, true);
  assert.equal(Product.schema.path("category").options.ref, "Category");
  assert.equal(Product.schema.path("price").options.min, 0);
  assert.equal(Product.schema.options.timestamps, true);
  assert.equal(product.category.toString(), categoryId);
  assert.equal(product.active, true);
  assert.equal(product.featured, true);
  assert.ok(new Product({
    name: "Inválido",
    price: 10.123,
    category: categoryId
  }).validateSync().errors.price);
});

test("normaliza slug e valida preço sem aceitar payload arbitrário", () => {
  assert.equal(normalizeSlug(" Eletrônicos & Casa "), "eletronicos-casa");
  assert.equal(normalizeSlug("Serviços Tributários"), "servicos-tributarios");
  assert.equal(normalizeSlug(" Casa & Decoração "), "casa-decoracao");
  assert.equal(normalizePrice(10.5), 10.5);
  assert.equal(normalizePrice(19.99), 19.99);
  assert.equal(normalizePrice(0), 0);
  assert.throws(() => normalizePrice("10"), /preço/);
  assert.throws(() => normalizePrice(-1), /preço/);
  assert.throws(() => normalizePrice(10.123), /preço/);
  assert.throws(() => normalizePrice(Number.NaN), /preço/);
  assert.throws(() => normalizePrice(Number.POSITIVE_INFINITY), /preço/);
  assert.throws(() => normalizeSlug("!!!"), /slug/);
  assert.deepEqual(
    validateCategoryInput({
      name: "Eletrônicos",
      slug: "slug-controlado-pelo-cliente",
      active: true,
      extra: "não persistir"
    }),
    { name: "Eletrônicos", description: "", active: true }
  );
  assert.deepEqual(
    validateProductInput({
      name: "Fone",
      description: "Bluetooth",
      price: 99.9,
      category: categoryId,
      active: true,
      featured: false,
      role: "admin"
    }),
    {
      name: "Fone",
      description: "Bluetooth",
      price: 99.9,
      category: categoryId,
      active: true,
      featured: false
    }
  );
});

test("CategoryService gera slug no servidor e traduz duplicidade 11000 para 409", async () => {
  let created;
  const service = new CategoryService({
    connect: async () => {},
    CategoryModel: {
      create: async (payload) => {
        created = payload;
        return payload;
      }
    },
    ProductModel: { exists: async () => false }
  });

  const result = await service.create({
    name: "Eletrônicos",
    slug: "admin-slug",
    description: "Tecnologia",
    active: true
  });
  assert.equal(created.slug, "eletronicos");
  assert.equal(created.slug, result.slug);
  assert.equal(created.admin, undefined);

  const duplicateService = new CategoryService({
    connect: async () => {},
    CategoryModel: {
      create: async () => {
        const error = new Error("driver keyValue private");
        error.code = 11000;
        throw error;
      }
    }
  });
  await assert.rejects(
    () => duplicateService.create({ name: "Eletrônicos" }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.status, 409);
      assert.doesNotMatch(error.message, /driver|private/);
      return true;
    }
  );

  let updatePayload;
  const updateService = new CategoryService({
    connect: async () => {},
    CategoryModel: {
      findOneAndUpdate: async (_filter, payload) => {
        updatePayload = payload;
        return payload;
      }
    },
    ProductModel: { exists: async () => false }
  });
  await updateService.update(categoryId, {
    name: " Casa & Decoração ",
    description: "Casa",
    active: false,
    slug: "slug-injetado",
    extra: "não persistir"
  });
  assert.deepEqual(Object.keys(updatePayload).sort(), [
    "active",
    "description",
    "name",
    "slug"
  ]);
  assert.equal(updatePayload.slug, "casa-decoracao");
});

test("CategoryService impede remoção de categoria referenciada", async () => {
  const service = new CategoryService({
    connect: async () => {},
    CategoryModel: {
      findById: async () => ({ _id: categoryId }),
      findByIdAndDelete: async () => assert.fail("não deveria remover")
    },
    ProductModel: {
      exists: async (filter) => {
        assert.deepEqual(filter, { category: categoryId });
        return true;
      }
    }
  });

  await assert.rejects(() => service.remove(categoryId), ConflictError);
});

test("CatalogProductService exige categoria ativa e usa whitelist", async () => {
  let received;
  let categoryFilter;
  const service = new CatalogProductService({
    connect: async () => {},
    CategoryModel: {
      findById: async (id) => {
        categoryFilter = { _id: id };
        return { _id: categoryId, active: true };
      },
      findOne: async (filter) => {
        categoryFilter = filter;
        return { _id: categoryId, active: true };
      }
    },
    ProductModel: {
      create: async (payload) => {
        received = payload;
        return payload;
      }
    }
  });

  const product = await service.create({
    name: "Fone",
    description: "Bluetooth",
    price: 99.9,
    category: categoryId,
    active: true,
    featured: false,
    user: "não persistir"
  });
  assert.deepEqual(categoryFilter, { _id: categoryId });
  assert.deepEqual(Object.keys(received).sort(), [
    "active",
    "category",
    "description",
    "featured",
    "name",
    "price"
  ]);
  assert.equal(product.user, undefined);

  const inactiveService = new CatalogProductService({
    connect: async () => {},
    CategoryModel: { findById: async () => null },
    ProductModel: { create: async () => assert.fail("não deveria criar") }
  });
  await assert.rejects(
    () => inactiveService.create({
      name: "Fone",
      price: 10,
      category: categoryId
    }),
    NotFoundError
  );
  const inactiveCategoryService = new CatalogProductService({
    connect: async () => {},
    CategoryModel: { findById: async () => ({ _id: categoryId, active: false }) },
    ProductModel: { create: async () => assert.fail("não deveria criar") }
  });
  await assert.rejects(
    () => inactiveCategoryService.create({
      name: "Fone",
      price: 10,
      category: categoryId
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.message, "Categoria inativa.");
      return true;
    }
  );
});

test("CatalogProductService mantém whitelist no update e popula categoria", async () => {
  let updateFilter;
  let updatePayload;
  let populateOptions;
  const product = { _id: productId, category: { _id: categoryId, name: "Eletrônicos", slug: "eletronicos" } };
  const service = new CatalogProductService({
    connect: async () => {},
    CategoryModel: { findById: async () => ({ _id: categoryId, active: true }) },
    ProductModel: {
      find: () => ({
        populate: async (options) => {
          populateOptions = options;
          return [product];
        }
      }),
      findOneAndUpdate: async (filter, payload) => {
        updateFilter = filter;
        updatePayload = payload;
        return product;
      }
    }
  });
  const payload = {
    name: "Fone atualizado",
    description: "Novo",
    price: 120,
    category: categoryId,
    active: true,
    featured: true,
    _id: "não alterar",
    createdAt: "não alterar"
  };

  const listed = await service.list();
  const updated = await service.update(productId, payload);

  assert.equal(listed[0], product);
  assert.deepEqual(populateOptions, {
    path: "category",
    select: "_id name slug"
  });
  assert.deepEqual(updateFilter, { _id: productId });
  assert.deepEqual(Object.keys(updatePayload).sort(), [
    "active",
    "category",
    "description",
    "featured",
    "name",
    "price"
  ]);
  assert.equal(updated, product);
  await assert.rejects(
    () => service.get("invalid"),
    /ObjectId/
  );
});

test("CategoryService e ProductService retornam 404 para registros ausentes", async () => {
  const categoryService = new CategoryService({
    connect: async () => {},
    CategoryModel: {
      findById: async () => null
    },
    ProductModel: { exists: async () => false }
  });
  const productService = new CatalogProductService({
    connect: async () => {},
    CategoryModel: { findById: async () => ({ _id: categoryId, active: true }) },
    ProductModel: {
      findById: async () => null,
      findByIdAndDelete: async () => null
    }
  });

  await assert.rejects(() => categoryService.get(categoryId), NotFoundError);
  await assert.rejects(() => productService.get(productId), NotFoundError);
  await assert.rejects(() => productService.remove(productId), NotFoundError);
});

test("rotas de mutação exigem admin e GETs do catálogo permanecem públicos", async () => {
  const forbidden = authorize("admin")(
    { user: { role: "user" } },
    {},
    (error) => error
  );
  assert.ok(forbidden instanceof ForbiddenError);

  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    for (const request of [
      { method: "POST", path: "/api/catalog/products" },
      { method: "PUT", path: `/api/catalog/products/${productId}` },
      { method: "DELETE", path: `/api/catalog/products/${productId}` },
      { method: "POST", path: "/api/catalog/categories" },
      { method: "PUT", path: `/api/catalog/categories/${categoryId}` },
      { method: "DELETE", path: `/api/catalog/categories/${categoryId}` }
    ]) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method
      });
      assert.equal(response.status, 401);
    }

    for (const path of [
      "/api/catalog/products",
      "/api/catalog/categories"
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 503);
    }

    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/produtos`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/pedidos`)).status, 200);
  } finally {
    await closeServer(server);
  }
});
