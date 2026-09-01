const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "";

const app = require("../server/server");
const { createConfig, ConfigurationError } = require("../server/config/env");
const {
  DatabaseConnectionError,
  connectDatabase,
  createDatabaseManager,
  getDatabaseStatus
} = require("../server/config/database");

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

test("resolve ambientes com precedência explícita e valida valores", () => {
  for (const environment of ["development", "test", "preview", "production"]) {
    assert.equal(
      createConfig({ APP_ENV: environment, MONGO_URI: "" }).appEnv,
      environment
    );
  }
  assert.equal(
    createConfig({
      APP_ENV: "preview",
      VERCEL_ENV: "production",
      NODE_ENV: "test",
      MONGO_URI: ""
    }).appEnv,
    "preview"
  );
  assert.equal(
    createConfig({
      VERCEL_ENV: "preview",
      NODE_ENV: "production",
      MONGO_URI: ""
    }).appEnv,
    "preview"
  );
  assert.equal(
    createConfig({ NODE_ENV: "test", MONGO_URI: "" }).appEnv,
    "test"
  );
  assert.equal(createConfig({ MONGO_URI: "" }).appEnv, "development");
  assert.equal(createConfig({ MONGO_URI: "" }).mongoUri, null);
  assert.equal(createConfig({ MONGO_URI: "   " }).mongoUri, null);
  assert.equal(createConfig({ PORT: "0042", MONGO_URI: "" }).port, 42);
  assert.throws(
    () => createConfig({ APP_ENV: "staging", MONGO_URI: "" }),
    ConfigurationError
  );
  assert.throws(
    () => createConfig({ VERCEL_ENV: "staging", MONGO_URI: "" }),
    ConfigurationError
  );
  assert.throws(
    () => createConfig({ NODE_ENV: "preview", MONGO_URI: "" }),
    ConfigurationError
  );
  assert.throws(
    () => createConfig({ PORT: "0", MONGO_URI: "" }),
    ConfigurationError
  );
  assert.throws(
    () => createConfig({ MONGO_URI: "https://example.test" }),
    ConfigurationError
  );
});

test("não conecta sem URI e deduplica chamadas simultâneas", async () => {
  let calls = 0;
  const connection = { readyState: 1 };
  const fakeMongoose = {
    connect: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { connection };
    }
  };
  const manager = createDatabaseManager(fakeMongoose);

  assert.equal(await manager.connect(""), null);
  assert.equal(calls, 0);

  const [first, second] = await Promise.all([
    manager.connect("mongodb://test"),
    manager.connect("mongodb://test")
  ]);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(manager.getState("mongodb://test"), "connected");
});

test("limpa a Promise após falha e permite nova tentativa sem expor segredo", async () => {
  let calls = 0;
  const fakeMongoose = {
    connect: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("driver internal failure: hidden-test-marker");
      }
      return { readyState: 1 };
    }
  };
  const manager = createDatabaseManager(fakeMongoose);

  await assert.rejects(
    () => manager.connect("mongodb://test"),
    (error) => {
      assert.ok(error instanceof DatabaseConnectionError);
      assert.doesNotMatch(error.message, /hidden-test-marker/);
      return true;
    }
  );
  assert.equal(manager.getState("mongodb://test"), "disconnected");
  await manager.connect("mongodb://test");
  assert.equal(calls, 2);
  assert.equal(manager.getState("mongodb://test"), "connected");
});

test("health e catálogo JSON funcionam sem Mongo configurado", async () => {
  assert.equal(getDatabaseStatus(), "not_configured");
  assert.equal(await connectDatabase(), null);
  assert.equal(getDatabaseStatus(), "not_configured");
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      status: "ok",
      environment: "test",
      database: { mongo: "not_configured" }
    });

    const productsResponse = await fetch(`${baseUrl}/api/produtos`);
    assert.equal(productsResponse.status, 200);
    const products = await productsResponse.json();
    assert.ok(Array.isArray(products));
    assert.ok(products.length > 0);
  } finally {
    await closeServer(server);
  }
});
