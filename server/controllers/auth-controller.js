class AuthController {
  constructor(service) {
    this.service = service;
    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
  }

  async register(req, res) {
    res.status(201).json(await this.service.register(req.body));
  }

  async login(req, res) {
    res.status(200).json(await this.service.login(req.body));
  }
}

module.exports = AuthController;
