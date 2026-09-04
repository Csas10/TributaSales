class FavoriteController {
  constructor(service) {
    this.service = service;
    this.list = this.list.bind(this);
    this.add = this.add.bind(this);
    this.remove = this.remove.bind(this);
  }

  async list(request, response) {
    response.status(200).json(await this.service.list(request.user._id));
  }

  async add(request, response) {
    response
      .status(200)
      .json(await this.service.add(request.user._id, request.params.productId));
  }

  async remove(request, response) {
    await this.service.remove(request.user._id, request.params.productId);
    response.status(204).send();
  }
}

module.exports = FavoriteController;
