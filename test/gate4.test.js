const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const test = require("node:test");

process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "";
process.env.JWT_SECRET = "";

const app = require("../server/server");
const AddressController = require("../server/controllers/address-controller");
const { DatabaseUnavailableError } = require("../server/config/database");
const { NotFoundError } = require("../server/middleware/error-middleware");
const {
  createAuthenticate
} = require("../server/middleware/authenticate");
const authorize = require("../server/middleware/authorize");
const {
  AuthenticationRequiredError,
  ForbiddenError,
  InvalidTokenError
} = require("../server/utils/auth-errors");
const { JwtConfigurationError, createTokenProvider } = require("../server/utils/token");

const userId = "507f1f77bcf86cd799439011";
const secret = "s".repeat(32);

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

async function runMiddleware(middleware, request) {
  let nextError;
  await middleware(request, {}, (error) => {
    nextError = error;
  });
  return nextError;
}

test("verifica JWT com HS256 e rejeita tokens inválidos", () => {
  const provider = createTokenProvider(jwt, {
    jwtSecret: secret,
    jwtExpiresIn: "1h"
  });
  const validToken = provider.issue(userId).accessToken;
  const expiredToken = jwt.sign(
    { sub: userId },
    secret,
    { algorithm: "HS256", expiresIn: -1 }
  );
  const wrongSignature = jwt.sign(
    { sub: userId },
    "t".repeat(32),
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const wrongAlgorithm = jwt.sign(
    { sub: userId },
    secret,
    { algorithm: "HS384", expiresIn: "1h" }
  );

  assert.equal(provider.verify(validToken).sub, userId);
  for (const token of [expiredToken, wrongSignature, wrongAlgorithm, "not-a-jwt"]) {
    assert.throws(() => provider.verify(token), InvalidTokenError);
  }
});

test("authenticate aceita somente Bearer e carrega o usuário atual", async () => {
  const provider = createTokenProvider(jwt, {
    jwtSecret: secret,
    jwtExpiresIn: "1h"
  });
  const token = provider.issue(userId).accessToken;
  const currentUser = {
    _id: userId,
    name: "Ana",
    email: "ana@example.com",
    role: "user",
    passwordHash: "hidden"
  };
  const middleware = createAuthenticate({
    tokenProvider: provider,
    connect: async () => {},
    userService: {
      getById: async (id) => {
        assert.equal(id, userId);
        return currentUser;
      }
    }
  });
  const request = { headers: { authorization: `Bearer ${token}` } };
  const nextError = await runMiddleware(middleware, request);

  assert.equal(nextError, undefined);
  assert.equal(request.user._id, userId);
  assert.equal(request.user.role, "user");
  assert.equal(request.user.passwordHash, undefined);
});

test("authenticate converte header inválido, sub inválido e usuário removido em 401", async () => {
  const provider = createTokenProvider(jwt, {
    jwtSecret: secret,
    jwtExpiresIn: "1h"
  });
  const validToken = provider.issue(userId).accessToken;
  const invalidSub = jwt.sign(
    { sub: "invalid", role: "admin" },
    secret,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const headers = [
    {},
    { authorization: "Basic token" },
    { authorization: "Bearer" },
    { authorization: "Bearer token extra" }
  ];

  for (const header of headers) {
    const middleware = createAuthenticate({
      tokenProvider: provider,
      connect: async () => {},
      userService: { getById: async () => assert.fail("não deveria carregar usuário") }
    });
    const error = await runMiddleware(middleware, { headers: header });
    assert.ok(error instanceof InvalidTokenError);
    assert.equal(error.status, 401);
  }

  const invalidSubError = await runMiddleware(
    createAuthenticate({
      tokenProvider: provider,
      connect: async () => {},
      userService: { getById: async () => assert.fail("sub inválido não deve consultar") }
    }),
    { headers: { authorization: `Bearer ${invalidSub}` } }
  );
  assert.ok(invalidSubError instanceof InvalidTokenError);

  const removedUserError = await runMiddleware(
    createAuthenticate({
      tokenProvider: provider,
      connect: async () => {},
      userService: {
        getById: async () => {
          throw new NotFoundError("removed");
        }
      }
    }),
    { headers: { authorization: `Bearer ${validToken}` } }
  );
  assert.ok(removedUserError instanceof InvalidTokenError);
});

test("authenticate preserva indisponibilidade do Mongo como 503", async () => {
  const provider = createTokenProvider(jwt, {
    jwtSecret: secret,
    jwtExpiresIn: "1h"
  });
  const error = new DatabaseUnavailableError();
  const nextError = await runMiddleware(
    createAuthenticate({
      tokenProvider: provider,
      connect: async () => {
        throw error;
      },
      userService: { getById: async () => assert.fail("não deveria consultar") }
    }),
    { headers: { authorization: `Bearer ${provider.issue(userId).accessToken}` } }
  );

  assert.strictEqual(nextError, error);
  assert.equal(nextError.status, 503);
});

test("authorize usa somente req.user.role e controla 401/403", () => {
  let called = false;
  const next = (error) => {
    if (error) return error;
    called = true;
    return undefined;
  };

  const missingError = authorize("user")({}, {}, next);
  assert.ok(missingError instanceof AuthenticationRequiredError);
  const forbiddenError = authorize("admin")(
    { user: { _id: userId, role: "user" } },
    {},
    next
  );
  assert.ok(forbiddenError instanceof ForbiddenError);
  assert.equal(forbiddenError.status, 403);

  authorize("user")({ user: { _id: userId, role: "user" } }, {}, next);
  assert.equal(called, true);
  authorize("admin")({ user: { _id: userId, role: "admin" } }, {}, next);
  assert.equal(called, true);
});

test("authorize rejeita role injetada no token quando banco informa user", async () => {
  const provider = createTokenProvider(jwt, {
    jwtSecret: secret,
    jwtExpiresIn: "1h"
  });
  const token = jwt.sign(
    { sub: userId, role: "admin" },
    secret,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const request = { headers: { authorization: `Bearer ${token}` } };
  const middleware = createAuthenticate({
    tokenProvider: provider,
    connect: async () => {},
    userService: {
      getById: async () => ({
        _id: userId,
        name: "Ana",
        email: "ana@example.com",
        role: "user"
      })
    }
  });
  const authError = await runMiddleware(middleware, request);
  assert.equal(authError, undefined);
  const forbiddenError = authorize("admin")(request, {}, (error) => error);
  assert.ok(forbiddenError instanceof ForbiddenError);
});

test("AddressController usa req.user._id em todas as operações", async () => {
  const calls = [];
  const controller = new AddressController({
    create: async (...args) => calls.push(["create", ...args]),
    list: async (...args) => calls.push(["list", ...args]),
    update: async (...args) => calls.push(["update", ...args]),
    remove: async (...args) => calls.push(["remove", ...args])
  });
  const response = {
    status() {
      return this;
    },
    json() {
      return this;
    },
    send() {
      return this;
    }
  };
  const request = {
    user: { _id: userId },
    body: { userId: "attacker", city: "Salvador" },
    params: { id: "507f1f77bcf86cd799439012" }
  };

  await controller.create(request, response);
  await controller.list(request, response);
  await controller.update(request, response);
  await controller.remove(request, response);

  assert.deepEqual(calls.map((call) => call[0]), ["create", "list", "update", "remove"]);
  assert.ok(calls.every((call) => call[1] === userId));
});

test("rotas User/Address exigem Bearer e auth continua pública", async () => {
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;
  const json = {
    "content-type": "application/json"
  };
  const body = JSON.stringify({
    name: "Ana",
    email: "ana@example.com",
    password: "Senha Segura 123!"
  });

  try {
    for (const request of [
      { method: "GET", path: "/api/users/me" },
      { method: "POST", path: "/api/users/me/addresses" },
      { method: "GET", path: "/api/users/me/addresses" },
      { method: "PUT", path: "/api/users/me/addresses/507f1f77bcf86cd799439012" },
      { method: "DELETE", path: "/api/users/me/addresses/507f1f77bcf86cd799439012" }
    ]) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method
      });
      assert.equal(response.status, 401);
    }

    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: json,
      body
    });
    assert.equal(registerResponse.status, 503);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        email: "ana@example.com",
        password: "Senha Segura 123!"
      })
    });
    assert.equal(loginResponse.status, 503);

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    const productsResponse = await fetch(`${baseUrl}/api/produtos`);
    assert.equal(productsResponse.status, 200);
  } finally {
    await closeServer(server);
  }
});
