const express = require("express");
const asyncHandler = require("../middleware/async-handler");

function userRoutes(
  userController,
  addressController,
  authenticate,
  favoriteController,
  cartController
) {
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
  router.get(
    "/me/favorites",
    authenticate,
    asyncHandler(favoriteController.list)
  );
  router.post(
    "/me/favorites/:productId",
    authenticate,
    asyncHandler(favoriteController.add)
  );
  router.delete(
    "/me/favorites/:productId",
    authenticate,
    asyncHandler(favoriteController.remove)
  );
  router.get("/me/cart", authenticate, asyncHandler(cartController.get));
  router.post(
    "/me/cart/items",
    authenticate,
    asyncHandler(cartController.addItem)
  );
  router.put(
    "/me/cart/items/:productId",
    authenticate,
    asyncHandler(cartController.updateItem)
  );
  router.delete(
    "/me/cart/items/:productId",
    authenticate,
    asyncHandler(cartController.removeItem)
  );
  router.delete("/me/cart", authenticate, asyncHandler(cartController.clear));
  return router;
}

module.exports = userRoutes;
