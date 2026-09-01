const jwt = require("jsonwebtoken");
const { config, ConfigurationError } = require("../config/env");

class JwtConfigurationError extends ConfigurationError {
  constructor() {
    super("Autenticação temporariamente indisponível.");
    this.name = "JwtConfigurationError";
    this.status = 503;
  }
}

function createTokenProvider(jwtClient = jwt, configuration = config) {
  function issue(userId) {
    if (!configuration.jwtSecret || Buffer.byteLength(configuration.jwtSecret, "utf8") < 32) {
      throw new JwtConfigurationError();
    }

    const expiresIn = configuration.jwtExpiresIn || "1h";
    const validExpiration = typeof expiresIn === "string"
      && /^(?:[1-9]\d*)(?:m|h|d)$/.test(expiresIn);
    if (!validExpiration) throw new JwtConfigurationError();

    const accessToken = jwtClient.sign(
      { sub: String(userId) },
      configuration.jwtSecret,
      { algorithm: "HS256", expiresIn }
    );
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn
    };
  }

  return { issue };
}

const tokenProvider = createTokenProvider();

module.exports = {
  JwtConfigurationError,
  createTokenProvider,
  tokenProvider
};
