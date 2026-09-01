class CatalogProductController {
  constructor(service) {
    this.service = service;
    this.list = this.list.bind(this);
    this.get = this.get.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.remove = this.remove.bind(this);
  }

  async list(request, response) {
    response.status(200).json(await this.service.list());
  }

  async get(request, response) {
    response.status(200).json(await this.service.get(request.params.id));
  }

  async create(request, response) {
    response.status(201).json(await this.service.create(request.body));
  }

  async update(request, response) {
    response.status(200).json(await this.service.update(request.params.id, request.body));
  }

  async remove(request, response) {
    await this.service.remove(request.params.id);
    response.status(204).send();
  }
}

module.exports = CatalogProductController;
