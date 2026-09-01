const { requireDatabase } = require("../config/database");
const { NotFoundError } = require("./error-middleware");
const { UserService, toPublicUser } = require("../services/user-service");
const { normalizeObjectId } = require("../utils/validation");
const { InvalidTokenError } = require("../utils/auth-errors");
const { tokenProvider } = require("../utils/token");

function authorizationToken(request) {
  const header = request.headers && request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match ? match[1] : null;
}

function createAuthenticate({
  tokenProvider: provider = tokenProvider,
  userService,
  connect = requireDatabase
} = {}) {
  const loader = userService || new UserService({ connect });

  return async function authenticate(request, response, next) {
    const accessToken = authorizationToken(request);
    if (!accessToken) return next(new InvalidTokenError());

    let claims;
    try {
      claims = provider.verify(accessToken);
    } catch (error) {
      return next(error);
    }

    let userId;
    try {
      userId = normalizeObjectId(claims.sub, "O usuário");
    } catch (_error) {
      return next(new InvalidTokenError());
    }

    try {
      await connect();
      const user = await loader.getById(userId);
      request.user = toPublicUser(user);
      return next();
    } catch (error) {
      if (error instanceof NotFoundError) return next(new InvalidTokenError());
      return next(error);
    }
  };
}

const authenticate = createAuthenticate();

module.exports = { authenticate, createAuthenticate };
