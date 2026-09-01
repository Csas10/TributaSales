const { config } = require("../config/env");
const { getDatabaseStatus } = require("../config/database");

function getHealth(req, res) {
  res.status(200).json({
    status: "ok",
    environment: config.appEnv,
    database: {
      mongo: getDatabaseStatus()
    }
  });
}

module.exports = { getHealth };
