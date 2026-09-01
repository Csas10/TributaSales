class AddressController {
  constructor(service) {
    this.service = service;
    this.create = this.create.bind(this);
    this.list = this.list.bind(this);
    this.update = this.update.bind(this);
    this.remove = this.remove.bind(this);
  }

  async create(request, response) {
    response.status(201).json(await this.service.create(request.user._id, request.body));
  }

  async list(request, response) {
    response.status(200).json(await this.service.list(request.user._id));
  }

  async update(request, response) {
    response
      .status(200)
      .json(await this.service.update(request.user._id, request.params.id, request.body));
  }

  async remove(request, response) {
    await this.service.remove(request.user._id, request.params.id);
    response.status(204).send();
  }
}

module.exports = AddressController;
