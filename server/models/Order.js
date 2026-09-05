const mongoose = require("mongoose");
const {
  MAX_CART_LINES,
  MAX_CART_TOTAL_CENTS,
  MAX_ITEM_QUANTITY,
  MAX_PRODUCT_PRICE_CENTS
} = require("../domain/commerce-limits");

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    quantity: {
      type: Number,
      required: true,
      validate: {
        validator: (value) =>
          Number.isSafeInteger(value) &&
          value >= 1 &&
          value <= MAX_ITEM_QUANTITY,
        message: "A quantidade deve respeitar o limite técnico."
      }
    },
    unitPriceCents: {
      type: Number,
      required: true,
      validate: {
        validator: (value) =>
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= MAX_PRODUCT_PRICE_CENTS,
        message: "O preço deve respeitar o limite técnico."
      }
    },
    subtotalCents: {
      type: Number,
      required: true,
      validate: {
        validator: (value) =>
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= MAX_CART_TOTAL_CENTS,
        message: "O subtotal deve respeitar o limite técnico."
      }
    }
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    cep: { type: String, required: true, match: /^\d{8}$/ },
    street: { type: String, required: true, trim: true },
    number: { type: String, required: true, trim: true },
    complement: { type: String, trim: true, default: "" },
    neighborhood: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, uppercase: true, match: /^[A-Z]{2}$/ }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    sourceCartVersion: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Number.isSafeInteger(value) && value >= 0,
        message: "A versão do carrinho é inválida."
      }
    },
    sourceAddressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      immutable: true
    },
    items: {
      type: [orderItemSchema],
      required: true,
      immutable: true,
      validate: {
        validator: (value) =>
          Array.isArray(value) &&
          value.length >= 1 &&
          value.length <= MAX_CART_LINES,
        message: `O pedido deve conter entre 1 e ${MAX_CART_LINES} itens.`
      }
    },
    totalCents: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: (value) =>
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= MAX_CART_TOTAL_CENTS,
        message: "O total deve respeitar o limite técnico."
      }
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
      immutable: true
    },
    status: {
      type: String,
      enum: ["pending", "cancelled"],
      default: "pending"
    },
    cancelledAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, sourceCartVersion: 1 }, { unique: true });
module.exports =
  mongoose.models.Order || mongoose.model("Order", orderSchema);
