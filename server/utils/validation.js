const { ValidacaoErro } = require("../models");

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireObjectPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidacaoErro("O payload deve ser um objeto.");
  }
}

function normalizeText(value, field, { required = true, min = 1, max = 160 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && (text.length < min || text.length > max)) {
    throw new ValidacaoErro(`${field} deve ter entre ${min} e ${max} caracteres.`);
  }
  if (!required && text.length > max) {
    throw new ValidacaoErro(`${field} deve ter no máximo ${max} caracteres.`);
  }
  return text;
}

function normalizeEmail(value) {
  const email = normalizeText(value, "O email", { min: 3, max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new ValidacaoErro("O email é inválido.");
  return email;
}

function normalizePasswordHash(value) {
  return normalizeText(value, "O passwordHash", { min: 1, max: 255 });
}

function normalizeObjectId(value, field = "O ID") {
  const objectId = typeof value === "string" ? value.trim() : "";
  if (!OBJECT_ID_PATTERN.test(objectId)) {
    throw new ValidacaoErro(`${field} deve ser um ObjectId válido.`);
  }
  return objectId;
}

function normalizeCep(value) {
  const rawCep = typeof value === "string" ? value.trim() : "";
  if (!rawCep || /[^\d\s.-]/.test(rawCep)) {
    throw new ValidacaoErro("O CEP deve conter 8 números.");
  }
  const cep = rawCep.replace(/\D/g, "");
  if (cep.length !== 8) throw new ValidacaoErro("O CEP deve conter 8 números.");
  return cep;
}

function normalizeState(value) {
  const state = normalizeText(value, "A UF", { min: 2, max: 2 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new ValidacaoErro("A UF deve conter 2 letras.");
  return state;
}

function normalizeSlug(value) {
  const name = normalizeText(value, "O nome", { min: 2, max: 120 });
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new ValidacaoErro("Não foi possível gerar um slug válido.");
  return slug;
}

function normalizePrice(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    Number(value.toFixed(2)) !== value
  ) {
    throw new ValidacaoErro("O preço deve ser um número finito, não negativo e ter no máximo 2 casas.");
  }
  return Number(value.toFixed(2));
}

function normalizeBoolean(value, field, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new ValidacaoErro(`${field} deve ser booleano.`);
  return value;
}

function validateUserInput(payload) {
  requireObjectPayload(payload);
  if (Object.prototype.hasOwnProperty.call(payload, "password")) {
    throw new ValidacaoErro("Use passwordHash; senha em texto claro não é aceita.");
  }
  return {
    name: normalizeText(payload.name, "O nome", { min: 2, max: 120 }),
    email: normalizeEmail(payload.email),
    passwordHash: normalizePasswordHash(payload.passwordHash)
  };
}

function validateCategoryInput(payload) {
  requireObjectPayload(payload);
  return {
    name: normalizeText(payload.name, "O nome", { min: 2, max: 120 }),
    description: normalizeText(payload.description, "A descrição", {
      required: false,
      max: 300
    }),
    active: normalizeBoolean(payload.active, "active", true)
  };
}

function validateProductInput(payload) {
  requireObjectPayload(payload);
  return {
    name: normalizeText(payload.name, "O nome", { min: 2, max: 120 }),
    description: normalizeText(payload.description, "A descrição", {
      required: false,
      max: 500
    }),
    price: normalizePrice(payload.price),
    category: normalizeObjectId(payload.category, "A categoria"),
    active: normalizeBoolean(payload.active, "active", true),
    featured: normalizeBoolean(payload.featured, "featured", false)
  };
}

function normalizeQuantity(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new ValidacaoErro("A quantidade deve ser um inteiro maior que zero.");
  }
  return value;
}

function validateCartItemInput(payload) {
  requireObjectPayload(payload);
  return {
    productId: normalizeObjectId(payload.productId, "O produto"),
    quantity: normalizeQuantity(payload.quantity)
  };
}

function validateCartQuantityInput(payload) {
  requireObjectPayload(payload);
  return { quantity: normalizeQuantity(payload.quantity) };
}

function validatePassword(password, { required = true } = {}) {
  if (typeof password !== "string" || (required && password.length === 0)) {
    throw new ValidacaoErro("A senha é obrigatória.");
  }
  if (password.length < 8) {
    throw new ValidacaoErro("A senha deve conter pelo menos 8 caracteres.");
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new ValidacaoErro("A senha deve conter no máximo 72 bytes.");
  }
  return password;
}

function validateLoginPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new ValidacaoErro("A senha é obrigatória.");
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new ValidacaoErro("A senha deve conter no máximo 72 bytes.");
  }
  return password;
}

function validateRegisterInput(payload) {
  requireObjectPayload(payload);
  if (Object.prototype.hasOwnProperty.call(payload, "passwordHash")) {
    throw new ValidacaoErro("passwordHash não é aceito no registro.");
  }
  return {
    name: normalizeText(payload.name, "O nome", { min: 2, max: 120 }),
    email: normalizeEmail(payload.email),
    password: validatePassword(payload.password)
  };
}

function validateLoginInput(payload) {
  requireObjectPayload(payload);
  return {
    email: normalizeEmail(payload.email),
    password: validateLoginPassword(payload.password)
  };
}

function validateAddressInput(payload) {
  requireObjectPayload(payload);
  return {
    cep: normalizeCep(payload.cep),
    street: normalizeText(payload.street, "A rua", { min: 2, max: 160 }),
    number: normalizeText(payload.number, "O número", { min: 1, max: 30 }),
    complement: normalizeText(payload.complement, "O complemento", {
      required: false,
      max: 160
    }),
    neighborhood: normalizeText(payload.neighborhood, "O bairro", {
      min: 2,
      max: 120
    }),
    city: normalizeText(payload.city, "A cidade", { min: 2, max: 120 }),
    state: normalizeState(payload.state)
  };
}

module.exports = {
  normalizeCep,
  normalizeEmail,
  normalizeBoolean,
  normalizeObjectId,
  normalizePasswordHash,
  normalizePrice,
  normalizeQuantity,
  normalizeSlug,
  normalizeState,
  requireObjectPayload,
  validateLoginInput,
  validatePassword,
  validateCategoryInput,
  validateCartItemInput,
  validateCartQuantityInput,
  validateProductInput,
  validateRegisterInput,
  validateAddressInput,
  validateUserInput
};
