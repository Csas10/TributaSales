const assert = require("node:assert/strict");
const http = require("node:http");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const test = require("node:test");

process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "";
process.env.JWT_SECRET = "";

const app = require("../server/server");
const { config, ConfigurationError } = require("../server/config/env");
const {
  DatabaseUnavailableError,
  getDatabaseStatus,
  requireDatabase
} = require("../server/config/database");
const { UserService } = require("../server/services/user-service");
const { AuthService } = require("../server/services/auth-service");
const {
  JwtConfigurationError,
  createTokenProvider
} = require("../server/utils/token");
const {
  InvalidCredentialsError
} = require("../server/utils/auth-errors");
const {
  validatePassword,
  validateRegisterInput
} = require("../server/utils/validation");

const userId = "507f1f77bcf86cd799439011";

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

test("aplica política de senha sem trim e limita 72 bytes UTF-8", () => {
  assert.equal(validatePassword("        "), "        ");
  assert.throws(() => validatePassword("short"), /8 caracteres/);
  assert.throws(() => validatePassword("a".repeat(73)), /72 bytes/);
  assert.throws(() => validatePassword("é".repeat(37)), /72 bytes/);
  assert.equal(
    validateRegisterInput({
      name: "Ana",
      email: "ana@example.com",
      password: " 1234567 "
    }).password,
    " 1234567 "
  );
});

test("registro usa bcrypt, ignora role e nunca retorna passwordHash", async () => {
  let received;
  const service = new AuthService({
    connect: async () => {},
    userService: {
      create: async (payload) => {
        received = payload;
        return {
          ...payload,
          _id: userId,
          role: "user"
        };
      }
    }
  });
  const password = "Senha Segura 123!";

  const result = await service.register({
    name: "Ana Silva",
    email: " ANA@EXAMPLE.COM ",
    password,
    role: "admin"
  });

  assert.equal(received.role, undefined);
  assert.notEqual(received.passwordHash, password);
  assert.equal(await bcrypt.compare(password, received.passwordHash), true);
  assert.equal(result.user.passwordHash, undefined);
  assert.equal(result.accessToken, undefined);
  assert.equal(result.user.role, "user");
});

test("registro rejeita passwordHash enviado pelo cliente e não transforma role em admin", () => {
  assert.throws(
    () =>
      validateRegisterInput({
        name: "Ana",
        email: "ana@example.com",
        password: "Senha123!",
        passwordHash: "client-hash"
      }),
    /passwordHash/
  );
  const input = validateRegisterInput({
    name: "Ana",
    email: "ana@example.com",
    password: "Senha123!",
    role: "admin"
  });
  assert.equal(input.role, undefined);
});

test("UserService busca passwordHash explicitamente para autenticação", async () => {
  let selected;
  const user = { _id: userId, passwordHash: "hash" };
  const service = new UserService({
    connect: async () => {},
    UserModel: {
      findOne: (filter) => {
        assert.deepEqual(filter, { email: "ana@example.com" });
        return {
          select: (fields) => {
            selected = fields;
            return user;
          }
        };
      }
    }
  });

  assert.equal(await service.findForAuthentication(" ANA@EXAMPLE.COM "), user);
  assert.equal(selected, "+passwordHash");
});

test("login válido emite JWT mínimo com sub e resposta pública", async () => {
  const password = "Senha Segura 123!";
  const passwordHash = await bcrypt.hash(password, 4);
  const user = {
    _id: userId,
    name: "Ana Silva",
    email: "ana@example.com",
    role: "user",
    passwordHash
  };
  const provider = createTokenProvider(jwt, {
    jwtSecret: "x".repeat(32),
    jwtExpiresIn: "1h"
  });
  const service = new AuthService({
    connect: async () => {},
    userService: {
      findForAuthentication: async (email) => {
        assert.equal(email, "ana@example.com");
        return user;
      }
    },
    tokenProvider: provider
  });

  const result = await service.login({
    email: " ANA@EXAMPLE.COM ",
    password
  });
  const claims = jwt.verify(result.accessToken, "x".repeat(32));
  const header = jwt.decode(result.accessToken, { complete: true }).header;

  assert.equal(result.tokenType, "Bearer");
  assert.equal(result.expiresIn, "1h");
  assert.equal(claims.sub, userId);
  assert.equal(header.alg, "HS256");
  assert.equal(typeof claims.iat, "number");
  assert.equal(typeof claims.exp, "number");
  assert.ok(claims.exp > claims.iat);
  assert.equal(claims.email, undefined);
  assert.equal(claims.role, undefined);
  assert.equal(result.user.passwordHash, undefined);
});

test("login inexistente e senha incorreta retornam o mesmo 401", async () => {
  const user = {
    _id: userId,
    name: "Ana Silva",
    email: "ana@example.com",
    role: "user",
    passwordHash: await bcrypt.hash("Senha Correta 123!", 4)
  };
  const service = new AuthService({
    connect: async () => {},
    userService: {
      findForAuthentication: async (email) =>
        email === "missing@example.com" ? null : user
    },
    tokenProvider: {
      issue: () => assert.fail("não deveria emitir token")
    }
  });

  const errors = [];
  for (const payload of [
    { email: "missing@example.com", password: "Senha Errada 123!" },
    { email: "ana@example.com", password: "Senha Errada 123!" }
  ]) {
    try {
      await service.login(payload);
      assert.fail("login deveria falhar");
    } catch (error) {
      errors.push(error);
    }
  }

  assert.ok(errors[0] instanceof InvalidCredentialsError);
  assert.equal(errors[0].status, 401);
  assert.equal(errors[0].message, "Credenciais inválidas.");
  assert.equal(errors[1].status, errors[0].status);
  assert.equal(errors[1].message, errors[0].message);
});

test("segredo JWT ausente ou curto falha somente ao emitir token", () => {
  const provider = createTokenProvider(jwt, {
    jwtSecret: "",
    jwtExpiresIn: "1h"
  });
  assert.throws(() => provider.issue(userId), JwtConfigurationError);
  assert.throws(
    () =>
      createTokenProvider(jwt, {
        jwtSecret: "é".repeat(15),
        jwtExpiresIn: "1h"
      }).issue(userId),
    JwtConfigurationError
  );
  assert.equal(config.jwtSecret, null);
});

test("expiração JWT inválida produz erro de configuração controlado", () => {
  for (const expiresIn of ["banana", "0h", "1w"]) {
    assert.throws(
      () =>
        createTokenProvider(jwt, {
          jwtSecret: "x".repeat(32),
          jwtExpiresIn: expiresIn
        }).issue(userId),
      (error) => {
        assert.ok(error instanceof ConfigurationError);
        assert.ok(error instanceof JwtConfigurationError);
        assert.equal(error.status, 503);
        return true;
      }
    );
  }
});

test("Mongo ausente falha rapidamente apenas no fluxo de autenticação", async () => {
  assert.equal(getDatabaseStatus(), "not_configured");
  await assert.rejects(
    () => requireDatabase(),
    (error) => {
      assert.ok(error instanceof DatabaseUnavailableError);
      assert.equal(error.status, 503);
      assert.equal(error.message, "Serviço temporariamente indisponível.");
      return true;
    }
  );

  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const authResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Ana Silva",
        email: "ana@example.com",
        password: "Senha Segura 123!"
      })
    });
    const authBody = await authResponse.json();
    assert.equal(authResponse.status, 503);
    assert.deepEqual(authBody, {
      erro: "Serviço temporariamente indisponível.",
      status: 503
    });

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).database.mongo, "not_configured");

    const productsResponse = await fetch(`${baseUrl}/api/produtos`);
    assert.equal(productsResponse.status, 200);
    assert.ok((await productsResponse.json()).length > 0);
  } finally {
    await closeServer(server);
  }
});
