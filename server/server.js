const express = require("express");
const path = require("node:path");
const { Produto, Pedido, ValidacaoErro, produtoFromJSON, validarQuantidade } = require("./models");
const { listarProdutos, salvarProdutos, listarPedidos, salvarPedidos } = require("./storage");
const { consultarCep } = require("./cep-service");

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, "..", "public")));
}

app.get("/api/produtos", async (req, res, next) => {
  try {
    res.json(await listarProdutos());
  } catch (erro) {
    next(erro);
  }
});

app.post("/api/produtos", async (req, res, next) => {
  try {
    const produtos = await listarProdutos();
    const produto = new Produto(req.body);
    produto.id = produtos.reduce((maior, item) => Math.max(maior, Number(item.id) || 0), 0) + 1;
    produtos.push(produto.toJSON());
    await salvarProdutos(produtos);
    res.status(201).json(produto.toJSON());
  } catch (erro) {
    next(erro);
  }
});

app.get("/api/produtos/media", async (req, res, next) => {
  try {
    const produtos = await listarProdutos();
    const media = produtos.length ? produtos.reduce((soma, item) => soma + Number(item.preco), 0) / produtos.length : 0;
    res.json({ media: Number(media.toFixed(2)), quantidade: produtos.length });
  } catch (erro) {
    next(erro);
  }
});

app.get("/api/pedidos", async (req, res, next) => {
  try {
    res.json(await listarPedidos());
  } catch (erro) {
    next(erro);
  }
});

app.post("/api/pedidos", async (req, res, next) => {
  try {
    const produtos = await listarProdutos();
    const porId = new Map(produtos.map((item) => [Number(item.id), produtoFromJSON(item)]));
    const itens = (req.body.itens || []).map((item) => {
      const produto = porId.get(Number(item.produtoId || item.id));
      if (!produto) throw new ValidacaoErro("Produto do pedido não encontrado.");
      return { produto, quantidade: validarQuantidade(item.quantidade) };
    });
    if (!itens.length) throw new ValidacaoErro("O pedido deve conter pelo menos um item.");
    const pedidos = await listarPedidos();
    const pedido = new Pedido({ ...req.body, itens });
    pedido.id = pedidos.reduce((maior, item) => Math.max(maior, Number(item.id) || 0), 0) + 1;
    pedidos.push(pedido.toJSON());
    await salvarPedidos(pedidos);
    res.status(201).json(pedido.toJSON());
  } catch (erro) {
    next(erro);
  }
});

app.get("/api/cep/:cep", async (req, res, next) => {
  try {
    res.json(await consultarCep(req.params.cep));
  } catch (erro) {
    next(erro);
  }
});

app.use((erro, req, res, next) => {
  if (erro instanceof ValidacaoErro) return res.status(400).json({ erro: erro.message });
  if (req.path.startsWith("/api/cep/")) return res.status(502).json({ erro: erro.message });
  next(erro);
});

if (require.main === module) {
  app.listen(port, () => console.log(`TributaSales em http://localhost:${port}`));
}

module.exports = app;
