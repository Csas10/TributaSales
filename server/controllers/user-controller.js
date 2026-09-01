class UserController {
  me(request, response) {
    response.status(200).json({ user: request.user });
  }
}

module.exports = UserController;
