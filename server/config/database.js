const mongoose = require("mongoose");
const { config } = require("./env");

const CONNECTION_TIMEOUT_MS = 5000;

class DatabaseConnectionError extends Error {
  constructor() {
    super("Não foi possível conectar ao MongoDB.");
    this.name = "DatabaseConnectionError";
  }
}

class DatabaseUnavailableError extends Error {
  constructor() {
    super("Serviço temporariamente indisponível.");
    this.name = "DatabaseUnavailableError";
    this.status = 503;
  }
}

function createDatabaseManager(mongooseClient = mongoose) {
  let connection = null;
  let connectionPromise = null;

  function readyStateOf(value) {
    if (!value) return 0;
    if (value.readyState != null) return value.readyState;
    if (value.connection && value.connection.readyState != null) {
      return value.connection.readyState;
    }
    return 0;
  }

  function getState(uri) {
    if (!uri) return "not_configured";
    if (readyStateOf(connection) === 1) return "connected";
    if (connectionPromise || readyStateOf(connection) === 2) return "connecting";
    return "disconnected";
  }

  async function connect(uri) {
    if (!uri) return null;
    if (readyStateOf(connection) === 1) return connection;
    if (connectionPromise) return connectionPromise;

    connectionPromise = mongooseClient
      .connect(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS
      })
      .then((result) => {
        connection = result && result.connection ? result.connection : result;
        connectionPromise = null;
        return connection;
      })
      .catch(() => {
        connection = null;
        connectionPromise = null;
        throw new DatabaseConnectionError();
      });

    return connectionPromise;
  }

  return {
    connect,
    getState
  };
}

const databaseManager = createDatabaseManager();

function connectDatabase() {
  return databaseManager.connect(config.mongoUri);
}

function getDatabaseStatus() {
  return databaseManager.getState(config.mongoUri);
}

async function requireDatabase() {
  if (!config.mongoUri) throw new DatabaseUnavailableError();
  try {
    return await connectDatabase();
  } catch (_error) {
    throw new DatabaseUnavailableError();
  }
}

module.exports = {
  CONNECTION_TIMEOUT_MS,
  DatabaseConnectionError,
  DatabaseUnavailableError,
  connectDatabase,
  createDatabaseManager,
  getDatabaseStatus,
  requireDatabase
};
