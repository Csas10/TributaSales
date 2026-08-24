function normalizarCep(valor) {
  return String(valor || "").replace(/\D/g, "").slice(0, 8);
}

async function buscarEnderecoPorCep(cep) {
  const cepLimpo = normalizarCep(cep);
  if (cepLimpo.length !== 8) throw new Error("Digite um CEP com 8 números.");
  const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
  if (!resposta.ok) throw new Error("Não foi possível consultar o serviço de CEP.");
  const dados = await resposta.json();
  if (dados.erro) throw new Error("CEP não encontrado.");
  return dados;
}
