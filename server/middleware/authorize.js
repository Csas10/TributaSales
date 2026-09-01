const {
  AuthenticationRequiredError,
  ForbiddenError
} = require("../utils/auth-errors");

function authorize(...allowedRoles) {
  return (request, response, next) => {
    if (!request.user) return next(new AuthenticationRequiredError());
    if (!allowedRoles.includes(request.user.role)) return next(new ForbiddenError());
    return next();
  };
}

module.exports = authorize;
