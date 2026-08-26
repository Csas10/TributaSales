const express = require("express");
const asyncHandler = require("../middleware/async-handler");

function orderRoutes(controller) {
  const router = express.Router();
  router.get("/", asyncHandler(controller.list));
  router.post("/", asyncHandler(controller.create));
  router.get("/:id", asyncHandler(controller.get));
  router.put("/:id", asyncHandler(controller.update));
  router.patch("/:id", asyncHandler(controller.update));
  router.delete("/:id", asyncHandler(controller.remove));
  return router;
}

module.exports = orderRoutes;
