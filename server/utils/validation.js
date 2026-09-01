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
  normalizeObjectId,
  normalizePasswordHash,
  normalizeState,
  requireObjectPayload,
  validateAddressInput,
  validateUserInput
};
