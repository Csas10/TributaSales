class InvalidCredentialsError extends Error {
  constructor() {
    super("Credenciais inválidas.");
    this.name = "InvalidCredentialsError";
    this.status = 401;
  }
}

class InvalidTokenError extends Error {
  constructor() {
    super("Token inválido ou expirado.");
    this.name = "InvalidTokenError";
    this.status = 401;
  }
}

class AuthenticationRequiredError extends Error {
  constructor() {
    super("Autenticação necessária.");
    this.name = "AuthenticationRequiredError";
    this.status = 401;
  }
}

class ForbiddenError extends Error {
  constructor() {
    super("Acesso negado.");
    this.name = "ForbiddenError";
    this.status = 403;
  }
}

module.exports = {
  AuthenticationRequiredError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTokenError
};
