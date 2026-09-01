class InvalidCredentialsError extends Error {
  constructor() {
    super("Credenciais inválidas.");
    this.name = "InvalidCredentialsError";
    this.status = 401;
  }
}

module.exports = { InvalidCredentialsError };
