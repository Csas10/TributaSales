class ProductController {
  constructor(service) {
    this.service = service;
    this.list = this.list.bind(this);
    this.get = this.get.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.remove = this.remove.bind(this);
    this.average = this.average.bind(this);
  }

  async list(req, res) {
    res.status(200).json(await this.service.list());
  }

  async get(req, res) {
    res.status(200).json(await this.service.get(req.params.id));
  }

  async create(req, res) {
    res.status(201).json(await this.service.create(req.body));
  }

  async update(req, res) {
    res.status(200).json(await this.service.update(req.params.id, req.body));
  }

  async remove(req, res) {
    await this.service.remove(req.params.id);
    res.status(204).send();
  }

  async average(req, res) {
    res.status(200).json(await this.service.average());
  }
}

module.exports = ProductController;
