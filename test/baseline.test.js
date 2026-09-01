const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const app = require("../server/server");
const {
  Pedido,
  Produto,
  ProdutoLicenca,
  ProdutoServico,
  ValidacaoErro
} = require("../server/models");
const { NotFoundError } = require("../server/middleware/error-middleware");
const { OrderService } = require("../server/services/order-service");
const { ProductService } = require("../server/services/product-service");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryRepository {
  constructor(items = []) {
    this.items = clone(items);
  }

  async findAll() {
    return clone(this.items);
  }

  async saveAll(items) {
    this.items = clone(items);
  }
}

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

test("mantém herança, polimorfismo e validações do domínio", () => {
  const servico = new ProdutoServico({
    nome: "Consultoria",
    preco: 100,
    categoria: "Serviços"
  });
  const licenca = new ProdutoLicenca({
    nome: "Licença",
    preco: 100,
    categoria: "Licenças"
  });

  assert.ok(servico instanceof Produto);
  assert.ok(licenca instanceof Produto);
  assert.equal(servico.tipo(), "Serviço");
  assert.equal(licenca.tipo(), "Licença");
  assert.equal(servico.calcularValorBase(2), 200);
  assert.equal(licenca.calcularValorBase(2), 180);

  assert.throws(
    () => new Produto({ nome: "", preco: 10, categoria: "Geral" }),
    ValidacaoErro
  );
  assert.throws(
    () => new Produto({ nome: "Produto", preco: -1, categoria: "Geral" }),
    ValidacaoErro
  );
  assert.throws(
    () => new Produto({ nome: "Produto", preco: "10", categoria: "Geral" }),
    ValidacaoErro
  );
  assert.throws(
    () =>
      new Pedido({
        itens: [{ produto: servico.toJSON(), quantidade: 0 }]
      }),
    ValidacaoErro
  );
});

test("mantém CRUD de produtos e média para lista vazia e cadastrada", async () => {
  const repository = new MemoryRepository();
  const service = new ProductService(repository);

  assert.deepEqual(await service.average(), { media: 0, quantidade: 0 });
  const created = await service.create({
    nome: "Produto de teste",
    descricao: "Regressão",
    preco: 25,
    categoria: "Geral"
  });
  assert.equal(created.id, 1);
  assert.deepEqual(await service.average(), { media: 25, quantidade: 1 });
  assert.equal((await service.get(1)).nome, "Produto de teste");

  const updated = await service.update(1, {
    nome: "Produto atualizado",
    descricao: "Regressão atualizada",
    preco: 30,
    categoria: "Geral"
  });
  assert.equal(updated.preco, 30);
  await service.remove(1);
  assert.deepEqual(await service.list(), []);
});

test("reconstrói pedido com produto oficial e rejeita item inválido", async () => {
  const productRepository = new MemoryRepository([
    {
      id: 1,
      nome: "Produto oficial",
      descricao: "",
      preco: 10,
      categoria: "Geral",
      destaque: false
    }
  ]);
  const orderRepository = new MemoryRepository();
  const service = new OrderService(orderRepository, productRepository);

  const created = await service.create({
    cliente: "Cliente teste",
    itens: [{ produtoId: 1, quantidade: 2 }]
  });
  assert.equal(created.total, 20);
  await assert.rejects(
    () =>
      service.create({
        itens: [{ produtoId: 1, quantidade: 0 }]
      }),
    ValidacaoErro
  );
  await assert.rejects(
    () =>
      service.create({
        itens: [{ produtoId: 999, quantidade: 1 }]
      }),
    NotFoundError
  );
});

test("mantém as rotas principais da API e o fallback JSON de rota", async () => {
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const productsResponse = await fetch(`${baseUrl}/api/produtos`);
    assert.equal(productsResponse.status, 200);
    const products = await productsResponse.json();
    assert.ok(Array.isArray(products));
    assert.ok(products.length > 0);

    const averageResponse = await fetch(`${baseUrl}/api/produtos/media`);
    assert.equal(averageResponse.status, 200);
    assert.equal(typeof (await averageResponse.json()).media, "number");

    const missingRouteResponse = await fetch(`${baseUrl}/api/rota-inexistente`);
    assert.equal(missingRouteResponse.status, 404);
  } finally {
    await closeServer(server);
  }
});
