function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[caractere]));
}

function carregarCarrinho() {
  const salvo = localStorage.getItem("tributasales-carrinho");
  if (!salvo) return [];
  try {
    const itens = JSON.parse(salvo);
    if (!Array.isArray(itens)) return [];
    return itens.reduce((carrinho, item) => {
      const produto = produtos.find((candidato) => candidato.id === Number(item?.id));
      const quantidade = Number(item?.quantidade);
      if (produto && Number.isInteger(quantidade) && quantidade > 0) {
        carrinho.push({ ...produto, quantidade });
      }
      return carrinho;
    }, []);
  } catch {
    localStorage.removeItem("tributasales-carrinho");
    return [];
  }
}

const estado = { carrinho: carregarCarrinho(), percentualDesconto: 0 };
const el = (id) => document.getElementById(id);

function salvarCarrinho() {
  localStorage.setItem("tributasales-carrinho", JSON.stringify(estado.carrinho));
}

function renderizarCatalogo() {
  const termo = el("busca").value.trim().toLowerCase();
  const categoria = el("filtro-categoria").value;
  const lista = produtos.filter((produto) => (!termo || `${produto.nome} ${produto.descricao}`.toLowerCase().includes(termo)) && (categoria === "Todos" || produto.categoria === categoria));
  el("catalogo-vazio").hidden = lista.length > 0;
  el("catalogo-produtos").innerHTML = lista.map((produto) => `<article class="product-card"><div class="product-image product-${escapeHtml(produto.id)}"><span>${escapeHtml(produto.categoria)}</span>${produto.destaque ? "<b>Mais vendido</b>" : ""}</div><div class="product-content"><p class="product-category">${escapeHtml(produto.categoria)}</p><h3>${escapeHtml(produto.nome)}</h3><p>${escapeHtml(produto.descricao)}</p><div class="product-footer"><strong>${moeda(produto.preco)}</strong><button class="button button-add" data-add="${escapeHtml(produto.id)}" type="button">Adicionar <span>+</span></button></div></div></article>`).join("");
}

function atualizarResumo() {
  const subtotal = estado.carrinho.reduce((total, item) => total + item.preco * item.quantidade, 0);
  const desconto = subtotal * (estado.percentualDesconto / 100);
  el("subtotal").textContent = moeda(subtotal);
  el("valor-desconto").textContent = `- ${moeda(desconto)}`;
  el("total").textContent = moeda(subtotal - desconto);
  el("contador-carrinho").textContent = estado.carrinho.reduce((total, item) => total + item.quantidade, 0);
}

function renderizarCarrinho() {
  el("itens-carrinho").innerHTML = estado.carrinho.length ? estado.carrinho.map((item) => `<div class="cart-item"><div><strong>${escapeHtml(item.nome)}</strong><small>${moeda(item.preco)} cada</small></div><div class="quantity"><button data-quantity="${escapeHtml(item.id)}" data-change="-1" type="button" aria-label="Diminuir quantidade">−</button><span>${item.quantidade}</span><button data-quantity="${escapeHtml(item.id)}" data-change="1" type="button" aria-label="Aumentar quantidade">+</button></div><strong>${moeda(item.preco * item.quantidade)}</strong></div>`).join("") : '<p class="empty-state">Seu pedido está vazio. Adicione itens do catálogo.</p>';
  atualizarResumo();
}

function adicionarAoCarrinho(id) {
  const produto = produtos.find((item) => item.id === id);
  const existente = estado.carrinho.find((item) => item.id === id);
  if (existente) existente.quantidade += 1;
  else estado.carrinho.push({ ...produto, quantidade: 1 });
  salvarCarrinho(); renderizarCarrinho(); mostrarToast(`${produto.nome} adicionado ao pedido.`);
}

function mostrarToast(mensagem) {
  const toast = el("toast"); toast.textContent = mensagem; toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2200);
}

async function carregarProdutos() {
  if (window.location.protocol === "file:") return;
  try {
    const resposta = await fetch("/api/produtos");
    if (!resposta.ok) {
      mostrarToast("Não foi possível carregar o catálogo da API.");
      return;
    }
    const dados = await resposta.json();
    if (Array.isArray(dados)) produtos = dados;
  } catch (erro) {
    if (erro instanceof TypeError) mostrarToast("Servidor indisponível; catálogo local carregado.");
    else mostrarToast("Resposta inválida da API; catálogo local não foi substituído.");
  }
}

function reconciliarCarrinho() {
  estado.carrinho = estado.carrinho.reduce((carrinho, item) => {
    const produto = produtos.find((candidato) => candidato.id === Number(item.id));
    if (produto) carrinho.push({ ...produto, quantidade: item.quantidade });
    return carrinho;
  }, []);
  salvarCarrinho();
}

let pedidos = [];
let apiDisponivel = window.location.protocol !== "file:";

async function requisicaoAPI(url, opcoes = {}) {
  if (!apiDisponivel) throw new Error("Abra a aplicação pelo servidor para gerenciar registros.");
  const resposta = await fetch(url, { headers: { "Content-Type": "application/json", ...(opcoes.headers || {}) }, ...opcoes });
  let dados = null;
  try { dados = await resposta.json(); } catch { /* respostas 204 não têm conteúdo */ }
  if (!resposta.ok) throw new Error(dados?.erro || "Não foi possível concluir a operação.");
  return dados;
}

function atualizarCategorias() {
  const select = el("filtro-categoria");
  const atual = select.value;
  select.innerHTML = '<option value="Todos">Todas as categorias</option>';
  [...new Set(produtos.map((produto) => produto.categoria))].sort().forEach((categoria) => select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(categoria)}">${escapeHtml(categoria)}</option>`));
  select.value = [...select.options].some((option) => option.value === atual) ? atual : "Todos";
}

function preencherProdutosGestao() {
  const select = el("pedido-produto");
  if (!select) return;
  select.innerHTML = produtos.map((produto) => `<option value="${escapeHtml(produto.id)}">${escapeHtml(produto.nome)} · ${moeda(produto.preco)}</option>`).join("");
}

function renderizarGestaoProdutos() {
  const destino = el("gestao-produtos");
  if (!destino) return;
  destino.innerHTML = produtos.length ? produtos.map((produto) => `<div class="management-row"><div><strong>${escapeHtml(produto.nome)}</strong><small>${escapeHtml(produto.categoria)} · ${moeda(produto.preco)}</small></div><div class="row-actions"><button class="button button-ghost" data-editar-produto="${escapeHtml(produto.id)}" type="button">Editar</button><button class="button button-danger" data-excluir-produto="${escapeHtml(produto.id)}" type="button">Excluir</button></div></div>`).join("") : '<p class="empty-state">Nenhum produto cadastrado.</p>';
}

function renderizarGestaoPedidos() {
  const destino = el("gestao-pedidos");
  if (!destino) return;
  destino.innerHTML = pedidos.length ? pedidos.map((pedido) => `<div class="management-row"><div><strong>Pedido #${escapeHtml(pedido.id)}</strong><small>${escapeHtml(pedido.cliente || "Cliente não informado")} · ${moeda(pedido.total)}</small></div><div class="row-actions"><button class="button button-ghost" data-editar-pedido="${escapeHtml(pedido.id)}" type="button">Editar</button><button class="button button-danger" data-excluir-pedido="${escapeHtml(pedido.id)}" type="button">Excluir</button></div></div>`).join("") : '<p class="empty-state">Nenhum pedido registrado.</p>';
}

async function carregarGestao() {
  if (!apiDisponivel) {
    el("mensagem-gestao").textContent = "Inicie o servidor para criar, editar ou excluir registros.";
    return;
  }
  try {
    const [produtosApi, pedidosApi] = await Promise.all([requisicaoAPI("/api/produtos"), requisicaoAPI("/api/pedidos")]);
    if (Array.isArray(produtosApi)) produtos = produtosApi;
    if (Array.isArray(pedidosApi)) pedidos = pedidosApi;
    reconciliarCarrinho();
    atualizarCategorias(); preencherProdutosGestao(); renderizarCatalogo(); renderizarGestaoProdutos(); renderizarGestaoPedidos();
    el("mensagem-gestao").textContent = "Produtos e pedidos sincronizados com a API.";
  } catch (erro) {
    el("mensagem-gestao").textContent = erro.message;
    el("mensagem-gestao").className = "result error";
  }
}

function limparFormularioProduto() {
  el("form-produto").reset(); el("produto-id").value = ""; el("produto-categoria").value = "Geral";
  el("titulo-form-produto").textContent = "Novo produto"; el("cancelar-produto").hidden = true;
}

function limparFormularioPedido() {
  el("form-pedido").reset(); el("pedido-id").value = ""; el("pedido-quantidade").value = 1;
  el("titulo-form-pedido").textContent = "Novo pedido"; el("cancelar-pedido").hidden = true;
}

function iniciarGestao() {
  if (!el("form-produto")) return;
  el("form-produto").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = el("produto-id").value;
    const tipo = el("produto-tipo").value;
    const payload = { nome: el("produto-nome").value, descricao: el("produto-descricao").value, preco: Number(el("produto-preco").value), categoria: el("produto-categoria").value, destaque: el("produto-destaque").checked };
    if (tipo === "servico") payload.tipo = "Serviço";
    if (tipo === "licenca") payload.tipo = "Licença";
    try {
      const salvo = await requisicaoAPI(id ? `/api/produtos/${id}` : "/api/produtos", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      if (id) produtos = produtos.map((produto) => produto.id === Number(id) ? salvo : produto); else produtos.push(salvo);
      atualizarCategorias(); preencherProdutosGestao(); renderizarCatalogo(); renderizarGestaoProdutos(); limparFormularioProduto(); mostrarToast("Produto salvo.");
    } catch (erro) { el("mensagem-gestao").textContent = erro.message; el("mensagem-gestao").className = "result error"; }
  });
  el("form-pedido").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = el("pedido-id").value;
    const payload = { cliente: el("pedido-cliente").value, cep: el("pedido-cep").value, itens: [{ produtoId: Number(el("pedido-produto").value), quantidade: Number(el("pedido-quantidade").value) }] };
    try {
      const salvo = await requisicaoAPI(id ? `/api/pedidos/${id}` : "/api/pedidos", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      if (id) pedidos = pedidos.map((pedido) => pedido.id === Number(id) ? salvo : pedido); else pedidos.push(salvo);
      renderizarGestaoPedidos(); limparFormularioPedido(); mostrarToast("Pedido salvo.");
    } catch (erro) { el("mensagem-gestao").textContent = erro.message; el("mensagem-gestao").className = "result error"; }
  });
  el("cancelar-produto").addEventListener("click", limparFormularioProduto);
  el("cancelar-pedido").addEventListener("click", limparFormularioPedido);
  el("atualizar-gestao").addEventListener("click", carregarGestao);
  el("gestao-produtos").addEventListener("click", async (event) => {
    const editar = event.target.closest("[data-editar-produto]");
    const excluir = event.target.closest("[data-excluir-produto]");
    if (editar) {
      const produto = produtos.find((item) => item.id === Number(editar.dataset.editarProduto));
      if (!produto) return;
      el("produto-id").value = produto.id; el("produto-nome").value = produto.nome; el("produto-descricao").value = produto.descricao || ""; el("produto-preco").value = produto.preco; el("produto-categoria").value = produto.categoria; el("produto-tipo").value = produto.tipo === "Serviço" ? "servico" : produto.tipo === "Licença" ? "licenca" : "produto"; el("produto-destaque").checked = Boolean(produto.destaque); el("titulo-form-produto").textContent = `Editar produto #${produto.id}`; el("cancelar-produto").hidden = false;
    }
    if (excluir && window.confirm("Excluir este produto?")) {
      try { await requisicaoAPI(`/api/produtos/${excluir.dataset.excluirProduto}`, { method: "DELETE" }); produtos = produtos.filter((produto) => produto.id !== Number(excluir.dataset.excluirProduto)); atualizarCategorias(); preencherProdutosGestao(); renderizarCatalogo(); renderizarGestaoProdutos(); mostrarToast("Produto excluído."); } catch (erro) { mostrarToast(erro.message); }
    }
  });
  el("gestao-pedidos").addEventListener("click", async (event) => {
    const editar = event.target.closest("[data-editar-pedido]");
    const excluir = event.target.closest("[data-excluir-pedido]");
    if (editar) {
      const pedido = pedidos.find((item) => item.id === Number(editar.dataset.editarPedido));
      const item = pedido?.itens?.[0];
      if (!pedido || !item) return;
      el("pedido-id").value = pedido.id; el("pedido-cliente").value = pedido.cliente || ""; el("pedido-cep").value = pedido.cep || ""; el("pedido-produto").value = item.produto.id; el("pedido-quantidade").value = item.quantidade; el("titulo-form-pedido").textContent = `Editar pedido #${pedido.id}`; el("cancelar-pedido").hidden = false;
    }
    if (excluir && window.confirm("Excluir este pedido?")) {
      try { await requisicaoAPI(`/api/pedidos/${excluir.dataset.excluirPedido}`, { method: "DELETE" }); pedidos = pedidos.filter((pedido) => pedido.id !== Number(excluir.dataset.excluirPedido)); renderizarGestaoPedidos(); mostrarToast("Pedido excluído."); } catch (erro) { mostrarToast(erro.message); }
    }
  });
  el("pedido-cep").addEventListener("input", (event) => { const valor = normalizarCep(event.target.value); event.target.value = valor.length > 5 ? `${valor.slice(0, 5)}-${valor.slice(5)}` : valor; });
  carregarGestao();
}

document.addEventListener("DOMContentLoaded", async () => {
  await carregarProdutos();
  reconciliarCarrinho();
  atualizarCategorias();
  preencherProdutosGestao();
  renderizarCatalogo(); renderizarCarrinho();
  iniciarGestao();
  el("busca").addEventListener("input", renderizarCatalogo);
  el("filtro-categoria").addEventListener("change", renderizarCatalogo);
  el("catalogo-produtos").addEventListener("click", (event) => { const botao = event.target.closest("[data-add]"); if (botao) adicionarAoCarrinho(Number(botao.dataset.add)); });
  el("itens-carrinho").addEventListener("click", (event) => { const botao = event.target.closest("[data-quantity]"); if (!botao) return; const item = estado.carrinho.find((produto) => produto.id === Number(botao.dataset.quantity)); item.quantidade += Number(botao.dataset.change); if (item.quantidade <= 0) estado.carrinho = estado.carrinho.filter((produto) => produto.id !== item.id); salvarCarrinho(); renderizarCarrinho(); });
  el("limpar-carrinho").addEventListener("click", () => { estado.carrinho = []; estado.percentualDesconto = 0; salvarCarrinho(); renderizarCarrinho(); el("mensagem-desconto").textContent = ""; });
  el("aplicar-desconto").addEventListener("click", () => { const codigo = el("codigo-desconto").value.trim().toUpperCase(); const percentual = CUPONS[codigo]; if (percentual) estado.percentualDesconto = percentual; el("mensagem-desconto").textContent = percentual ? `Cupom aplicado: ${percentual}% de desconto.` : "Cupom inválido. O desconto vigente foi mantido."; el("mensagem-desconto").className = percentual ? "success" : "error"; atualizarResumo(); });
  el("finalizar-pedido").addEventListener("click", async () => {
    if (!estado.carrinho.length) return mostrarToast("Adicione pelo menos um item ao pedido.");
    if (window.location.protocol === "file:") return mostrarToast("Pedido simulado com sucesso!");
    try {
      const resposta = await fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens: estado.carrinho.map((item) => ({ produtoId: item.id, quantidade: item.quantidade })) }) });
      if (!resposta.ok) throw new Error("Não foi possível registrar o pedido.");
      mostrarToast("Pedido registrado com sucesso!");
    } catch (erro) {
      mostrarToast(erro.message);
    }
  });
  el("calcular-desconto").addEventListener("click", () => { try { const resultado = calcularValorComDesconto(el("valor").value, el("desconto").value); el("resultado-desconto").textContent = `Economia: ${moeda(resultado.desconto)} · Total: ${moeda(resultado.total)}`; el("resultado-desconto").className = "result success"; } catch (erro) { el("resultado-desconto").textContent = erro.message; el("resultado-desconto").className = "result error"; } });
  el("cep").addEventListener("input", (event) => { const valor = normalizarCep(event.target.value).slice(0, 8); event.target.value = valor.length > 5 ? `${valor.slice(0, 5)}-${valor.slice(5)}` : valor; });
  el("buscar-cep").addEventListener("click", async () => { const destino = el("endereco"); destino.textContent = "Consultando..."; destino.className = "address-result loading"; try { const dados = await buscarEnderecoPorCep(el("cep").value); destino.textContent = `${dados.logradouro || "Logradouro não informado"}, ${dados.bairro || "Bairro não informado"} · ${dados.localidade}/${dados.uf}`; destino.className = "address-result success"; } catch (erro) { destino.textContent = erro.message; destino.className = "address-result error"; } });
});
