class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
}

function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ erro: "JSON inválido.", status: 400 });
  }
  if (error.name === "ValidacaoErro") return res.status(400).json({ erro: error.message, status: 400 });
  if (error instanceof NotFoundError) return res.status(404).json({ erro: error.message, status: 404 });
  if (req.path.startsWith("/api/cep/")) return res.status(502).json({ erro: error.message, status: 502 });
  console.error(error);
  return res.status(error.status || 500).json({ erro: error.message || "Erro interno do servidor.", status: error.status || 500 });
}

module.exports = { NotFoundError, errorMiddleware };
