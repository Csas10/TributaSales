const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const test = require("node:test");

const Address = require("../server/models/Address");
const User = require("../server/models/User");
const { NotFoundError } = require("../server/middleware/error-middleware");
const { AddressService } = require("../server/services/address-service");
const { ConflictError, UserService } = require("../server/services/user-service");
const {
  normalizeCep,
  normalizeObjectId,
  normalizeState,
  validateAddressInput,
  validateUserInput
} = require("../server/utils/validation");

const userId = "507f1f77bcf86cd799439011";
const addressId = "507f1f77bcf86cd799439012";

test("define User com campos seguros, índices e timestamps", () => {
  const emailPath = User.schema.path("email");
  const passwordPath = User.schema.path("passwordHash");
  const rolePath = User.schema.path("role");
  const indexes = User.schema.indexes();
  const user = new User({
    name: "Usuário Teste",
    email: "TESTE@EXAMPLE.COM",
    passwordHash: "hash-fixture",
    role: "admin"
  });

  assert.equal(emailPath.options.trim, true);
  assert.equal(emailPath.options.lowercase, true);
  assert.equal(emailPath.options.unique, true);
  assert.equal(passwordPath.options.required, true);
  assert.equal(passwordPath.options.select, false);
  assert.equal(rolePath.defaultValue, "user");
  assert.ok(indexes.some(([fields, options]) => fields.email === 1 && options.unique));
  assert.equal(User.schema.options.timestamps, true);
  assert.equal(user.email, "teste@example.com");
  assert.equal(user.toJSON().passwordHash, undefined);
});

test("define Address com referência User, CEP e UF normalizados", () => {
  const address = new Address({
    user: new mongoose.Types.ObjectId(userId),
    cep: "48.123-456",
    street: "Rua Central",
    number: "10",
    neighborhood: "Centro",
    city: "Salvador",
    state: "ba"
  });

  assert.equal(address.cep, "48123456");
  assert.equal(address.state, "BA");
  assert.equal(address.user.toString(), userId);
  assert.equal(Address.schema.path("user").options.ref, "User");
  assert.equal(Address.schema.options.timestamps, true);
  assert.throws(() => normalizeCep("48123"), /8 números/);
  assert.throws(() => normalizeState("B"), /2/);
});

test("valida payloads sem aceitar senha plana e com ObjectId estrito", () => {
  assert.deepEqual(
    validateUserInput({
      name: "  Ana  ",
      email: " ANA@EXAMPLE.COM ",
      passwordHash: "hash-fixture",
      role: "admin"
    }),
    { name: "Ana", email: "ana@example.com", passwordHash: "hash-fixture" }
  );
  assert.throws(
    () => validateUserInput({ name: "Ana", email: "ana@example.com", password: "plain" }),
    /passwordHash/
  );
  assert.deepEqual(normalizeObjectId(userId), userId);
  assert.throws(() => normalizeObjectId("123"), /ObjectId/);
  assert.deepEqual(validateAddressInput({
    cep: "48 123-456",
    street: "Rua A",
    number: "1",
    neighborhood: "Centro",
    city: "Salvador",
    state: "ba"
  }).cep, "48123456");
});

test("UserService força role user, conecta durante a operação e oculta passwordHash", async () => {
  let connections = 0;
  let received;
  const service = new UserService({
    connect: async () => {
      connections += 1;
    },
    UserModel: {
      create: async (payload) => {
        received = payload;
        return {
          ...payload,
          _id: userId,
          toObject() {
            return { ...this };
          }
        };
      }
    }
  });

  const result = await service.create({
    name: "Ana",
    email: "ANA@EXAMPLE.COM",
    passwordHash: "hash-fixture",
    role: "admin"
  });

  assert.equal(connections, 1);
  assert.equal(received.role, "user");
  assert.equal(received.password, undefined);
  assert.equal(result.passwordHash, undefined);
  assert.equal(result.email, "ana@example.com");
});

test("UserService traduz duplicidade Mongo 11000 para ConflictError", async () => {
  const service = new UserService({
    connect: async () => {},
    UserModel: {
      create: async () => {
        const error = new Error("internal duplicate details");
        error.code = 11000;
        throw error;
      }
    }
  });

  await assert.rejects(
    () =>
      service.create({
        name: "Ana",
        email: "ana@example.com",
        passwordHash: "hash-fixture"
      }),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.equal(error.status, 409);
      assert.doesNotMatch(error.message, /internal duplicate/);
      return true;
    }
  );
});

test("AddressService verifica User e restringe todas as queries ao userId", async () => {
  let connections = 0;
  const filters = [];
  const address = { _id: addressId, user: userId, cep: "48123456" };
  const service = new AddressService({
    connect: async () => {
      connections += 1;
    },
    UserModel: {
      exists: async (filter) => {
        filters.push(filter);
        return true;
      }
    },
    AddressModel: {
      create: async (payload) => payload,
      find: async (filter) => {
        filters.push(filter);
        return [address];
      },
      findOneAndUpdate: async (filter, payload, options) => {
        filters.push(filter, payload, options);
        return address;
      },
      findOneAndDelete: async (filter) => {
        filters.push(filter);
        return address;
      }
    }
  });
  const payload = {
    cep: "48.123-456",
    street: "Rua Central",
    number: "10",
    neighborhood: "Centro",
    city: "Salvador",
    state: "ba",
    user: "507f1f77bcf86cd799439099",
    _id: "507f1f77bcf86cd799439099",
    createdAt: "must-not-change",
    metadata: "must-not-persist"
  };

  const created = await service.create(userId, payload);
  const listed = await service.list(userId);
  const updated = await service.update(userId, addressId, payload);
  await service.remove(userId, addressId);

  assert.equal(created.user, userId);
  assert.equal(created.cep, "48123456");
  assert.equal(listed[0], address);
  assert.equal(updated, address);
  assert.deepEqual(filters[0], { _id: userId });
  assert.ok(filters.some((filter) => filter && filter.user === userId));
  assert.ok(filters.some((filter) => filter && filter._id === addressId && filter.user === userId));
  const updatePayload = filters.find(
    (filter) => filter && filter.cep === "48123456"
  );
  assert.deepEqual(Object.keys(updatePayload).sort(), [
    "cep",
    "city",
    "complement",
    "neighborhood",
    "number",
    "state",
    "street"
  ]);
  assert.equal(connections, 4);
});

test("AddressService rejeita usuário inexistente e ObjectId inválido", async () => {
  const service = new AddressService({
    connect: async () => {},
    UserModel: { exists: async () => false },
    AddressModel: { create: async () => assert.fail("não deveria criar") }
  });

  await assert.rejects(
    () => service.create(userId, {
      cep: "48123456",
      street: "Rua A",
      number: "1",
      neighborhood: "Centro",
      city: "Salvador",
      state: "BA"
    }),
    NotFoundError
  );
  await assert.rejects(
    () => service.list("invalid"),
    /ObjectId/
  );
});

test("AddressService retorna 404 para endereço fora do ownership", async () => {
  const service = new AddressService({
    connect: async () => {},
    UserModel: { exists: async () => true },
    AddressModel: {
      findOneAndUpdate: async () => null,
      findOneAndDelete: async () => null
    }
  });
  const payload = {
    cep: "48123456",
    street: "Rua A",
    number: "1",
    neighborhood: "Centro",
    city: "Salvador",
    state: "BA"
  };

  await assert.rejects(
    () => service.update(userId, addressId, payload),
    NotFoundError
  );
  await assert.rejects(
    () => service.remove(userId, addressId),
    NotFoundError
  );
});
