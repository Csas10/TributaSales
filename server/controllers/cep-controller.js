const { consultarCep } = require("../cep-service");

async function getCep(req, res) {
  res.status(200).json(await consultarCep(req.params.cep));
}

module.exports = { getCep };
