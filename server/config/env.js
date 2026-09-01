const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const APP_ENVIRONMENTS = new Set(["development", "test", "preview", "production"]);
const NODE_ENVIRONMENTS = new Set(["development", "test", "production"]);

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function valueOf(source, key) {
  const value = source[key];
  return typeof value === "string" ? value.trim() : value;
}

function validateEnvironment(value, allowed, name) {
  if (!allowed.has(value)) {
    throw new ConfigurationError(`${name} possui um ambiente inválido.`);
  }
  return value;
}

function resolveAppEnvironment(source) {
  const appEnvironment = valueOf(source, "APP_ENV");
  if (appEnvironment) {
    return validateEnvironment(appEnvironment, APP_ENVIRONMENTS, "APP_ENV");
  }

  const vercelEnvironment = valueOf(source, "VERCEL_ENV");
  if (vercelEnvironment) {
    return validateEnvironment(vercelEnvironment, APP_ENVIRONMENTS, "VERCEL_ENV");
  }

  const nodeEnvironment = valueOf(source, "NODE_ENV");
  if (nodeEnvironment) {
    return validateEnvironment(nodeEnvironment, APP_ENVIRONMENTS, "NODE_ENV");
  }

  return "development";
}

function resolveNodeEnvironment(source) {
  const nodeEnvironment = valueOf(source, "NODE_ENV") || "development";
  return validateEnvironment(nodeEnvironment, NODE_ENVIRONMENTS, "NODE_ENV");
}

function resolvePort(source) {
  const rawPort = valueOf(source, "PORT");
  if (rawPort == null || rawPort === "") return 3000;

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError("PORT deve ser um número inteiro entre 1 e 65535.");
  }
  return port;
}

function resolveMongoUri(source) {
  const mongoUri = valueOf(source, "MONGO_URI");
  if (!mongoUri) return null;
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) {
    throw new ConfigurationError("MONGO_URI deve usar o esquema mongodb ou mongodb+srv.");
  }
  return mongoUri;
}

function createConfig(source = process.env) {
  const appEnvironment = resolveAppEnvironment(source);
  return Object.freeze({
    appEnv: appEnvironment,
    nodeEnv: resolveNodeEnvironment(source),
    port: resolvePort(source),
    mongoUri: resolveMongoUri(source)
  });
}

const config = createConfig();

module.exports = {
  APP_ENVIRONMENTS,
  ConfigurationError,
  NODE_ENVIRONMENTS,
  config,
  createConfig
};
