const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    cep: {
      type: String,
      required: true,
      set: (value) => String(value == null ? "" : value).replace(/\D/g, ""),
      match: /^\d{8}$/
    },
    street: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 160
    },
    number: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30
    },
    complement: {
      type: String,
      trim: true,
      maxlength: 160,
      default: ""
    },
    neighborhood: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    city: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    state: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{2}$/
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Address || mongoose.model("Address", addressSchema);
