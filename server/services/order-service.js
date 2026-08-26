const { Pedido, ValidacaoErro, produtoFromJSON, validarQuantidade } = require("../models");
const { NotFoundError } = require("../middleware/error-middleware");
const { validarId } = require("./product-service");

function validarPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidacaoErro("O payload deve ser um objeto JSON.");
  }
}

class OrderService {
  constructor(repository, productRepository) {
    this.repository = repository;
    this.productRepository = productRepository;
  }

  async list() {
    return this.repository.findAll();
  }

  async get(id) {
    const orderId = validarId(id);
    const orders = await this.repository.findAll();
    const order = orders.find((item) => Number(item.id) === orderId);
    if (!order) throw new NotFoundError("Pedido não encontrado.");
    return order;
  }

  async buildOrder(payload, id) {
    validarPayload(payload);
    if (!Array.isArray(payload.itens) || payload.itens.length === 0) {
      throw new ValidacaoErro("O pedido deve conter pelo menos um item.");
    }
    const products = await this.productRepository.findAll();
    const byId = new Map(products.map((item) => [Number(item.id), produtoFromJSON(item)]));
    const itens = payload.itens.map((item) => {
      if (!item || typeof item !== "object") throw new ValidacaoErro("Cada item do pedido deve ser um objeto.");
      const productId = item.produtoId == null ? item.id : item.produtoId;
      const product = byId.get(Number(productId));
      if (!product) throw new NotFoundError("Produto do pedido não encontrado.");
      return { produto: product, quantidade: validarQuantidade(item.quantidade) };
    });
    const order = new Pedido({ ...payload, ...(id == null ? {} : { id }), itens });
    if (id != null) order.id = id;
    return order;
  }

  async create(payload) {
    const orders = await this.repository.findAll();
    const order = await this.buildOrder(payload);
    order.id = orders.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    const serialized = order.toJSON();
    await this.repository.saveAll([...orders, serialized]);
    return serialized;
  }

  async update(id, payload) {
    const orderId = validarId(id);
    const orders = await this.repository.findAll();
    const index = orders.findIndex((item) => Number(item.id) === orderId);
    if (index < 0) throw new NotFoundError("Pedido não encontrado.");
    const order = await this.buildOrder(payload, orderId);
    orders[index] = order.toJSON();
    await this.repository.saveAll(orders);
    return orders[index];
  }

  async remove(id) {
    const orderId = validarId(id);
    const orders = await this.repository.findAll();
    const remaining = orders.filter((item) => Number(item.id) !== orderId);
    if (remaining.length === orders.length) throw new NotFoundError("Pedido não encontrado.");
    await this.repository.saveAll(remaining);
  }
}

module.exports = { OrderService };
