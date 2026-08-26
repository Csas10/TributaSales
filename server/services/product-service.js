const { produtoFromJSON, ValidacaoErro } = require("../models");
const { NotFoundError } = require("../middleware/error-middleware");

function validarPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidacaoErro("O payload deve ser um objeto JSON.");
  }
}

function validarId(id) {
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) throw new ValidacaoErro("O ID deve ser um inteiro positivo.");
  return value;
}

class ProductService {
  constructor(repository) {
    this.repository = repository;
  }

  async list() {
    return this.repository.findAll();
  }

  async get(id) {
    const productId = validarId(id);
    const products = await this.repository.findAll();
    const product = products.find((item) => Number(item.id) === productId);
    if (!product) throw new NotFoundError("Produto não encontrado.");
    return product;
  }

  async create(payload) {
    validarPayload(payload);
    const products = await this.repository.findAll();
    const product = produtoFromJSON(payload);
    product.id = products.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    const serialized = product.toJSON();
    await this.repository.saveAll([...products, serialized]);
    return serialized;
  }

  async update(id, payload) {
    const productId = validarId(id);
    validarPayload(payload);
    const products = await this.repository.findAll();
    const index = products.findIndex((item) => Number(item.id) === productId);
    if (index < 0) throw new NotFoundError("Produto não encontrado.");
    const product = produtoFromJSON({ ...payload, id: productId });
    products[index] = product.toJSON();
    await this.repository.saveAll(products);
    return products[index];
  }

  async remove(id) {
    const productId = validarId(id);
    const products = await this.repository.findAll();
    const remaining = products.filter((item) => Number(item.id) !== productId);
    if (remaining.length === products.length) throw new NotFoundError("Produto não encontrado.");
    await this.repository.saveAll(remaining);
  }

  async average() {
    const products = await this.repository.findAll();
    const total = products.reduce((sum, item) => sum + Number(item.preco), 0);
    return { media: Number((products.length ? total / products.length : 0).toFixed(2)), quantidade: products.length };
  }
}

module.exports = { ProductService, validarId };
