const JsonRepository = require("./json-repository");

class ProductRepository extends JsonRepository {
  constructor() {
    super("produtos.json");
  }
}

module.exports = ProductRepository;
