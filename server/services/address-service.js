const Address = require("../models/Address");
const User = require("../models/User");
const { connectDatabase } = require("../config/database");
const { NotFoundError } = require("../middleware/error-middleware");
const {
  normalizeObjectId,
  validateAddressInput
} = require("../utils/validation");

class AddressService {
  constructor({
    AddressModel = Address,
    UserModel = User,
    connect = connectDatabase
  } = {}) {
    this.AddressModel = AddressModel;
    this.UserModel = UserModel;
    this.connect = connect;
  }

  async ensureUser(userId) {
    const normalizedUserId = normalizeObjectId(userId, "O usuário");
    await this.connect();
    const exists = await this.UserModel.exists({ _id: normalizedUserId });
    if (!exists) throw new NotFoundError("Usuário não encontrado.");
    return normalizedUserId;
  }

  async create(userId, payload) {
    const normalizedUserId = await this.ensureUser(userId);
    const input = validateAddressInput(payload);
    const address = await this.AddressModel.create({
      user: normalizedUserId,
      ...input
    });
    return address;
  }

  async list(userId) {
    const normalizedUserId = await this.ensureUser(userId);
    return this.AddressModel.find({ user: normalizedUserId });
  }

  async update(userId, addressId, payload) {
    const normalizedUserId = await this.ensureUser(userId);
    const normalizedAddressId = normalizeObjectId(addressId, "O endereço");
    const input = validateAddressInput(payload);
    const address = await this.AddressModel.findOneAndUpdate(
      { _id: normalizedAddressId, user: normalizedUserId },
      input,
      { new: true, runValidators: true }
    );
    if (!address) throw new NotFoundError("Endereço não encontrado.");
    return address;
  }

  async remove(userId, addressId) {
    const normalizedUserId = await this.ensureUser(userId);
    const normalizedAddressId = normalizeObjectId(addressId, "O endereço");
    const address = await this.AddressModel.findOneAndDelete({
      _id: normalizedAddressId,
      user: normalizedUserId
    });
    if (!address) throw new NotFoundError("Endereço não encontrado.");
  }
}

module.exports = { AddressService };
