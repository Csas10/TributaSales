const CUPONS = { PRIMEIRACOMPRA: 10, CLIENTE10: 10, PARCEIRO15: 15 };

function calcularValorComDesconto(valor, percentual) {
  const preco = Number(valor);
  const desconto = Number(percentual);
  if (!Number.isFinite(preco) || preco < 0 || !Number.isFinite(desconto) || desconto < 0 || desconto > 100) {
    throw new Error("Informe valores válidos. O desconto deve estar entre 0% e 100%.");
  }
  return { desconto: preco * (desconto / 100), total: preco * (1 - desconto / 100) };
}

function moeda(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
