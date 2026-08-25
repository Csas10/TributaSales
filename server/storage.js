const fs = require("node:fs/promises");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "data");

async function lerJSON(nome, padrao) {
  try {
    const dados = JSON.parse(await fs.readFile(path.join(dataDir, nome), "utf8"));
    if (Array.isArray(dados)) return dados;
    console.warn(`${nome} não contém uma lista; usando valor padrão.`);
    return padrao;
  } catch (erro) {
    if (erro.code === "ENOENT") return padrao;
    if (erro instanceof SyntaxError) {
      console.warn(`${nome} contém JSON inválido; usando valor padrão.`);
      return padrao;
    }
    throw erro;
  }
}

async function gravarJSON(nome, dados) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, nome), `${JSON.stringify(dados, null, 2)}\n`, "utf8");
}

async function listarProdutos() {
  return lerJSON("produtos.json", []);
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
