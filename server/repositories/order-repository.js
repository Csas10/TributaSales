const JsonRepository = require("./json-repository");

class OrderRepository extends JsonRepository {
  constructor() {
    super("pedidos.json");
  }
}

module.exports = OrderRepository;
