const readline = require("node:readline/promises");
const fs = require("node:fs");
const { stdin: input, stdout: output } = require("node:process");
const { Produto, ProdutoServico, ProdutoLicenca, produtoFromJSON, Pedido } = require("./models");
const { listarProdutos, salvarProdutos, listarPedidos, salvarPedidos } = require("./storage");

const rl = input.isTTY ? readline.createInterface({ input, output }) : null;
const linhas = input.isTTY ? [] : fs.readFileSync(0, "utf8").split(/\r?\n/);
const perguntar = (texto) => rl ? rl.question(texto) : Promise.resolve(linhas.shift() || "");

async function cadastrarProduto() {
  const tipo = (await perguntar("Tipo (produto/servico/licenca): ")).trim().toLowerCase();
  const dados = { nome: await perguntar("Nome: "), descricao: await perguntar("Descrição: "), preco: Number(await perguntar("Preço: ")), categoria: await perguntar("Categoria: ") };
  const Classe = tipo === "servico" ? ProdutoServico : tipo === "licenca" ? ProdutoLicenca : Produto;
  const produtos = await listarProdutos();
  const produto = new Classe(dados);
  produto.id = produtos.reduce((maior, item) => Math.max(maior, Number(item.id) || 0), 0) + 1;
  produtos.push(produto.toJSON());
  await salvarProdutos(produtos);
  console.log(`Produto cadastrado: ${produto.id} - ${produto.nome}`);
}

async function listar() {
  (await listarProdutos()).forEach((produto) => console.log(`${produto.id}. ${produto.nome} - R$ ${Number(produto.preco).toFixed(2)} (${produto.tipo || produto.categoria})`));
}

async function media() {
  const produtos = await listarProdutos();
  const valor = produtos.length ? produtos.reduce((soma, produto) => soma + Number(produto.preco), 0) / produtos.length : 0;
  console.log(`Média de preços: R$ ${valor.toFixed(2)}`);
}

async function registrarPedido() {
  const produtos = await listarProdutos();
  const pedido = new Pedido({ cliente: await perguntar("Cliente: "), cep: await perguntar("CEP: ") });
  await listar();
  const id = Number(await perguntar("ID do produto: "));
  const quantidade = Number(await perguntar("Quantidade: "));
  const produto = produtos.find((item) => Number(item.id) === id);
  if (!produto) throw new Error("Produto não encontrado.");
  pedido.adicionar(produtoFromJSON(produto), quantidade);
  const pedidos = await listarPedidos();
  pedido.id = pedidos.reduce((maior, item) => Math.max(maior, Number(item.id) || 0), 0) + 1;
  pedidos.push(pedido.toJSON());
  await salvarPedidos(pedidos);
  console.log(`Pedido registrado: ${pedido.id} - total R$ ${pedido.total().toFixed(2)}`);
}

async function executar() {
  const comando = process.argv[2] || (await perguntar("Comando (cadastrar/listar/media/pedido): "));
  if (comando === "cadastrar") await cadastrarProduto();
  else if (comando === "listar") await listar();
  else if (comando === "media") await media();
  else if (comando === "pedido") await registrarPedido();
  else throw new Error("Comando inválido. Use cadastrar, listar, media ou pedido.");
}

executar().catch((erro) => { console.error(`Erro: ${erro.message}`); process.exitCode = 1; }).finally(() => { if (rl) rl.close(); });
