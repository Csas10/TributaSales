const express = require("express");
const asyncHandler = require("../middleware/async-handler");

function authRoutes(controller) {
  const router = express.Router();
  router.post("/register", asyncHandler(controller.register));
  router.post("/login", asyncHandler(controller.login));
  return router;
}

module.exports = authRoutes;
