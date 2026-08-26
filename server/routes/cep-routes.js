const express = require("express");
const { getCep } = require("../controllers/cep-controller");
const asyncHandler = require("../middleware/async-handler");

const router = express.Router();
router.get("/:cep", asyncHandler(getCep));

module.exports = router;
