const { DatabaseUnavailableError } = require("../config/database");

const readinessPromises = new WeakMap();

function prepareModelIndexes(Model) {
  if (
    !Model ||
    (typeof Model.createIndexes !== "function" &&
      typeof Model.init !== "function")
  ) {
    return Promise.resolve();
  }

  const cached = readinessPromises.get(Model);
  if (cached) return cached;

  const readiness = Promise.resolve()
    .then(() => {
      if (typeof Model.createIndexes === "function") {
        return Model.createIndexes();
      }
      return Model.init();
    })
    .catch(() => {
      readinessPromises.delete(Model);
      throw new DatabaseUnavailableError();
    });

  readinessPromises.set(Model, readiness);
  return readiness;
}

module.exports = { prepareModelIndexes };
