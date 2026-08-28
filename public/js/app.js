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

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = String(texto);
  return div.innerHTML;
}

function salvarCarrinho() {
  localStorage.setItem("tributasales-carrinho", JSON.stringify(estado.carrinho));
}

function renderizarCatalogo() {
  const termo = el("busca").value.trim().toLowerCase();
  const categoria = el("filtro-categoria").value;
  const lista = produtos.filter((produto) => (!termo || `${produto.nome} ${produto.descricao}`.toLowerCase().includes(termo)) && (categoria === "Todos" || produto.categoria === categoria));
  el("catalogo-vazio").hidden = lista.length > 0;
  el("catalogo-produtos").innerHTML = lista.map((p) => `<article class="product-card"><div class="product-image product-${escapeHtml(p.id)}"><span>${escapeHtml(p.categoria)}</span>${p.destaque ? "<b>Mais vendido</b>" : ""}</div><div class="product-content"><p class="product-category">${escapeHtml(p.categoria)}</p><h3>${escapeHtml(p.nome)}</h3><p>${escapeHtml(p.descricao)}</p><div class="product-footer"><strong>${moeda(p.preco)}</strong><button class="button button-add" data-add="${escapeHtml(p.id)}" type="button">Adicionar <span>+</span></button></div></div></article>`).join("");
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
  el("itens-carrinho").innerHTML = estado.carrinho.length ? estado.carrinho.map((item) => `<div class="cart-item"><div><strong>${escapeHtml(item.nome)}</strong><small>${moeda(item.preco)} cada</small></div><div class="quantity"><button data-quantity="${escapeHtml(item.id)}" data-change="-1" type="button" aria-label="Diminuir quantidade">−</button><span>${escapeHtml(item.quantidade)}</span><button data-quantity="${escapeHtml(item.id)}" data-change="1" type="button" aria-label="Aumentar quantidade">+</button></div><strong>${moeda(item.preco * item.quantidade)}</strong></div>`).join("") : '<p class="empty-state">Seu pedido está vazio. Adicione itens do catálogo.</p>';
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

document.addEventListener("DOMContentLoaded", async () => {
  await carregarProdutos();
  [...new Set(produtos.map((produto) => produto.categoria))].sort().forEach((categoria) => el("filtro-categoria").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(categoria)}">${escapeHtml(categoria)}</option>`));
  renderizarCatalogo(); renderizarCarrinho();
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
