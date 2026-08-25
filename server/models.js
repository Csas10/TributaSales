class ValidacaoErro extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ValidacaoErro";
  }
}

function validarNome(nome) {
  if (typeof nome !== "string" || nome.trim().length < 2) {
    throw new ValidacaoErro("O nome deve ter pelo menos 2 caracteres.");
  }
  return nome.trim();
}

function validarPreco(preco) {
  if (typeof preco !== "number" || !Number.isFinite(preco) || preco < 0) {
    throw new ValidacaoErro("O preço deve ser um número maior ou igual a zero.");
  }
  return Number(preco.toFixed(2));
}

function validarQuantidade(quantidade) {
  if (typeof quantidade !== "number" || !Number.isInteger(quantidade) || quantidade <= 0) {
    throw new ValidacaoErro("A quantidade deve ser um inteiro maior que zero.");
  }
  return quantidade;
}

function validarCep(cep) {
  const valor = String(cep || "").replace(/\D/g, "");
  if (valor && valor.length !== 8) throw new ValidacaoErro("O CEP deve conter 8 números.");
  return valor;
}

class Produto {
  constructor({ id, nome, descricao = "", preco, categoria = "Geral", destaque = false } = {}) {
    this.id = id == null ? undefined : Number(id);
    this.nome = validarNome(nome);
    this.descricao = String(descricao).trim();
    this.preco = validarPreco(preco);
    this.categoria = validarNome(categoria);
    this.destaque = Boolean(destaque);
  }

  tipo() {
    return "Produto";
  }

  calcularValorBase(quantidade = 1) {
    return this.preco * validarQuantidade(quantidade);
  }

  toJSON() {
    return { id: this.id, nome: this.nome, descricao: this.descricao, preco: this.preco, categoria: this.categoria, destaque: this.destaque, tipo: this.tipo() };
  }
}

class ProdutoServico extends Produto {
  tipo() {
    return "Serviço";
  }

  calcularValorBase(quantidade = 1) {
    return super.calcularValorBase(quantidade);
  }
}

class ProdutoLicenca extends Produto {
  tipo() {
    return "Licença";
  }

  calcularValorBase(quantidade = 1) {
    return Number((super.calcularValorBase(quantidade) * 0.9).toFixed(2));
  }
}

function produtoFromJSON(dados) {
  if (dados.tipo === "Serviço" || dados.categoria === "Serviços") return new ProdutoServico(dados);
  if (dados.tipo === "Licença" || dados.categoria === "Licenças") return new ProdutoLicenca(dados);
  return new Produto(dados);
}

class Pedido {
  constructor({ id, itens = [], cep = "", cliente = "" } = {}) {
    this.id = id == null ? undefined : Number(id);
    this.itens = itens.map((item) => ({
      produto: produtoFromJSON(item.produto || item),
      quantidade: validarQuantidade(item.quantidade)
    }));
    this.cep = validarCep(cep);
    this.cliente = String(cliente).trim();
    this.criadoEm = new Date().toISOString();
  }

  adicionar(produto, quantidade = 1) {
    const item = this.itens.find((candidato) => candidato.produto.id === produto.id);
    if (item) item.quantidade += validarQuantidade(quantidade);
    else this.itens.push({ produto, quantidade: validarQuantidade(quantidade) });
  }

  total() {
    return Number(this.itens.reduce((total, item) => total + item.produto.calcularValorBase(item.quantidade), 0).toFixed(2));
  }

  toJSON() {
    return { id: this.id, cliente: this.cliente, cep: this.cep, itens: this.itens.map((item) => ({ produto: item.produto.toJSON(), quantidade: item.quantidade })), total: this.total(), criadoEm: this.criadoEm };
  }
}

module.exports = { Produto, ProdutoServico, ProdutoLicenca, Pedido, ValidacaoErro, validarNome, validarPreco, validarQuantidade, validarCep, produtoFromJSON };
