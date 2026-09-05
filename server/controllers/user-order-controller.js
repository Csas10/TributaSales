class UserOrderController {
  constructor(service) {
    this.service = service;
    this.list = this.list.bind(this);
    this.get = this.get.bind(this);
    this.create = this.create.bind(this);
    this.cancel = this.cancel.bind(this);
  }

  async list(request, response) {
    response.status(200).json(await this.service.list(request.user._id));
  }

  async get(request, response) {
    response
      .status(200)
      .json(await this.service.get(request.user._id, request.params.id));
  }

  async create(request, response) {
    response
      .status(201)
      .json(await this.service.create(request.user._id, request.body));
  }

  async cancel(request, response) {
    response
      .status(200)
      .json(
        await this.service.cancel(
          request.user._id,
          request.params.id,
          request.body
        )
      );
  }
}

module.exports = UserOrderController;
