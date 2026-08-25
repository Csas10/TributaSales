const { ValidacaoErro } = require("./models");

function normalizarCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

async function consultarCep(cep) {
  const cepLimpo = normalizarCep(cep);
  if (cepLimpo.length !== 8) throw new ValidacaoErro("Digite um CEP com 8 números.");
  const resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
  if (!resposta.ok) throw new Error("Não foi possível consultar o serviço de CEP.");
  const dados = await resposta.json();
  if (dados.erro) throw new Error("CEP não encontrado.");
  return dados;
}

module.exports = { normalizarCep, consultarCep };
