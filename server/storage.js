const fs = require("node:fs/promises");
const path = require("node:path");

const isServerless = !!process.env.VERCEL;

const dataDir = path.join(__dirname, "..", "data");

// In-memory cache for serverless environments (ephemeral filesystem)
const cache = { produtos: null, pedidos: null };

const PRODUTOS_PADRAO = [
  { id: 1, nome: "Kit café especial", descricao: "Café torrado, filtro e caneca artesanal.", preco: 48.9, categoria: "Alimentos", destaque: true, tipo: "Produto" },
  { id: 2, nome: "Cesta café da manhã", descricao: "Seleção pronta para presentear ou compartilhar.", preco: 89.9, categoria: "Alimentos", destaque: true, tipo: "Produto" },
  { id: 3, nome: "Caneca artesanal", descricao: "Peça de cerâmica produzida por artesãos locais.", preco: 36.5, categoria: "Casa", tipo: "Produto" },
  { id: 4, nome: "Ecobag de algodão", descricao: "Sacola resistente e reutilizável para o dia a dia.", preco: 29.9, categoria: "Acessórios", tipo: "Produto" },
  { id: 5, nome: "Consultoria tributária", descricao: "Orientação inicial para organizar seu negócio.", preco: 150, categoria: "Serviços", tipo: "Serviço" },
  { id: 6, nome: "Diagnóstico fiscal", descricao: "Mapeamento dos principais pontos de atenção.", preco: 280, categoria: "Serviços", tipo: "Serviço" }
];

async function lerJSON(nome, padrao) {
  if (isServerless && cache[nome.replace(".json", "")] !== null) {
    return cache[nome.replace(".json", "")];
  }
  try {
    const dados = JSON.parse(await fs.readFile(path.join(dataDir, nome), "utf8"));
    if (Array.isArray(dados)) {
      if (isServerless) cache[nome.replace(".json", "")] = dados;
      return dados;
    }
    return padrao;
  } catch (erro) {
    if (erro.code === "ENOENT" || erro instanceof SyntaxError) return padrao;
    throw erro;
  }
}

async function gravarJSON(nome, dados) {
  if (isServerless) {
    cache[nome.replace(".json", "")] = dados;
    return;
  }
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, nome), `${JSON.stringify(dados, null, 2)}\n`, "utf8");
}

async function listarProdutos() {
  const dados = await lerJSON("produtos.json", []);
  return dados.length > 0 ? dados : PRODUTOS_PADRAO;
}

async function salvarProdutos(produtos) {
  return gravarJSON("produtos.json", produtos);
}

async function listarPedidos() {
  return lerJSON("pedidos.json", []);
}

async function salvarPedidos(pedidos) {
  return gravarJSON("pedidos.json", pedidos);
}

module.exports = { listarProdutos, salvarProdutos, listarPedidos, salvarPedidos };
