const mongoose = require("mongoose");
const { MAX_PRODUCT_PRICE_CENTS } = require("../domain/commerce-limits");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: (value) =>
          Number.isFinite(value) &&
          Number(value.toFixed(2)) === value &&
          Number.isSafeInteger(Math.round(value * 100)) &&
          Math.round(value * 100) <= MAX_PRODUCT_PRICE_CENTS,
        message: "O preço deve ter no máximo 2 casas decimais e respeitar o limite técnico."
      }
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true
    },
    active: {
      type: Boolean,
      default: true
    },
    featured: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Product || mongoose.model("Product", productSchema);
