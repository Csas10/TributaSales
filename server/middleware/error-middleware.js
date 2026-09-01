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
  const status = Number.isInteger(error.status) && ((error.status >= 400 && error.status < 500) || error.status === 503)
    ? error.status
    : 500;
  if (status === 401 || status === 403 || status === 409 || status === 503) {
    return res.status(status).json({ erro: error.message, status });
  }
  console.error(error);
  const message = process.env.NODE_ENV === "production" && status >= 500
    ? (status === 503 ? "Serviço temporariamente indisponível." : "Erro interno do servidor.")
    : error.message || "Erro interno do servidor.";
  return res.status(status).json({ erro: message, status });
}

module.exports = { NotFoundError, errorMiddleware };
