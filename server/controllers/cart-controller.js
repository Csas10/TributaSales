class CartController {
  constructor(service) {
    this.service = service;
    this.get = this.get.bind(this);
    this.addItem = this.addItem.bind(this);
    this.updateItem = this.updateItem.bind(this);
    this.removeItem = this.removeItem.bind(this);
    this.clear = this.clear.bind(this);
  }

  async get(request, response) {
    response.status(200).json(await this.service.get(request.user._id));
  }

  async addItem(request, response) {
    response.status(200).json(await this.service.addItem(request.user._id, request.body));
  }

  async updateItem(request, response) {
    response
      .status(200)
      .json(await this.service.updateItem(request.user._id, request.params.productId, request.body));
  }

  async removeItem(request, response) {
    await this.service.removeItem(request.user._id, request.params.productId);
    response.status(204).send();
  }

  async clear(request, response) {
    await this.service.clear(request.user._id);
    response.status(204).send();
  }
}

module.exports = CartController;
