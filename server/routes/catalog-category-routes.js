const express = require("express");
const asyncHandler = require("../middleware/async-handler");

function catalogCategoryRoutes(controller, authenticate, adminAuthorization) {
  const router = express.Router();
  router.get("/", asyncHandler(controller.list));
  router.get("/:id", asyncHandler(controller.get));
  router.post("/", authenticate, adminAuthorization, asyncHandler(controller.create));
  router.put("/:id", authenticate, adminAuthorization, asyncHandler(controller.update));
  router.delete("/:id", authenticate, adminAuthorization, asyncHandler(controller.remove));
  return router;
}

module.exports = catalogCategoryRoutes;
