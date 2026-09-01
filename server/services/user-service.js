const User = require("../models/User");
const { connectDatabase } = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeEmail,
  normalizeObjectId,
  validateUserInput
} = require("../utils/validation");

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.status = 409;
  }
}

function toPublicUser(user) {
  const object = user && typeof user.toObject === "function" ? user.toObject() : { ...user };
  delete object.passwordHash;
  if (object._id && typeof object._id.toString === "function") {
    object._id = object._id.toString();
  }
  return object;
}

class UserService {
  constructor({ UserModel = User, connect = connectDatabase } = {}) {
    this.UserModel = UserModel;
    this.connect = connect;
  }

  async create(payload) {
    const input = validateUserInput(payload);
    await this.connect();
    try {
      const user = await this.UserModel.create({
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        role: "user"
      });
      return toPublicUser(user);
    } catch (error) {
      if (error && error.code === 11000) {
        throw new ConflictError("O email já está cadastrado.");
      }
      throw error;
    }
  }

  async getById(id) {
    const normalizedId = normalizeObjectId(id, "O usuário");
    await this.connect();
    const user = await this.UserModel.findById(normalizedId);
    if (!user) throw new NotFoundError("Usuário não encontrado.");
    return toPublicUser(user);
  }

  async findForAuthentication(email) {
    const normalizedEmail = normalizeEmail(email);
    await this.connect();
    let query = this.UserModel.findOne({ email: normalizedEmail });
    if (query && typeof query.select === "function") {
      query = query.select("+passwordHash");
    }
    return query;
  }
}

module.exports = { ConflictError, UserService, toPublicUser };
