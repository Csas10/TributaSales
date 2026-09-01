const express = require("express");
const asyncHandler = require("../middleware/async-handler");

function userRoutes(userController, addressController, authenticate) {
  const router = express.Router();
  router.get("/me", authenticate, asyncHandler(userController.me.bind(userController)));
  router.post(
    "/me/addresses",
    authenticate,
    asyncHandler(addressController.create)
  );
  router.get(
    "/me/addresses",
    authenticate,
    asyncHandler(addressController.list)
  );
  router.put(
    "/me/addresses/:id",
    authenticate,
    asyncHandler(addressController.update)
  );
  router.delete(
    "/me/addresses/:id",
    authenticate,
    asyncHandler(addressController.remove)
  );
  return router;
}

module.exports = userRoutes;
