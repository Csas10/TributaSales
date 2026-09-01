const bcrypt = require("bcrypt");
const { requireDatabase } = require("../config/database");
const { InvalidCredentialsError } = require("../utils/auth-errors");
const { toPublicUser } = require("./user-service");
const {
  validateLoginInput,
  validateRegisterInput
} = require("../utils/validation");
const { tokenProvider } = require("../utils/token");

const BCRYPT_ROUNDS = 12;

function passwordHashOf(user) {
  if (user && user.passwordHash) return user.passwordHash;
  if (user && typeof user.toObject === "function") {
    return user.toObject().passwordHash;
  }
  return undefined;
}

class AuthService {
  constructor({
    userService,
    passwordHasher = bcrypt,
    tokenProvider: provider = tokenProvider,
    connect = requireDatabase
  } = {}) {
    this.userService = userService;
    this.passwordHasher = passwordHasher;
    this.tokenProvider = provider;
    this.connect = connect;
  }

  async register(payload) {
    const input = validateRegisterInput(payload);
    await this.connect();
    const passwordHash = await this.passwordHasher.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.userService.create({
      name: input.name,
      email: input.email,
      passwordHash
    });
    return { user: toPublicUser(user) };
  }

  async login(payload) {
    const input = validateLoginInput(payload);
    await this.connect();
    const user = await this.userService.findForAuthentication(input.email);
    const passwordHash = passwordHashOf(user);
    const valid = user && passwordHash
      ? await this.passwordHasher.compare(input.password, passwordHash)
      : false;
    if (!valid) throw new InvalidCredentialsError();

    return {
      ...this.tokenProvider.issue(user._id),
      user: toPublicUser(user)
    };
  }
}

module.exports = { AuthService, BCRYPT_ROUNDS };
