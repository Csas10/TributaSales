const mongoose = require("mongoose");
const { MAX_CART_LINES, MAX_ITEM_QUANTITY } = require("../domain/commerce-limits");

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: (value) =>
          Number.isSafeInteger(value) &&
          value >= 1 &&
          value <= MAX_ITEM_QUANTITY,
        message: "A quantidade deve ser um inteiro dentro do limite técnico."
      }
    }
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true
    },
    items: {
      type: [cartItemSchema],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length <= MAX_CART_LINES,
        message: "O carrinho excede o limite técnico de linhas."
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Cart || mongoose.model("Cart", cartSchema);
