const mongoose = require("mongoose");

function removePasswordHash(_document, object) {
  delete object.passwordHash;
  return object;
}

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      maxlength: 254
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    }
  },
  {
    timestamps: true,
    toJSON: { transform: removePasswordHash },
    toObject: { transform: removePasswordHash }
  }
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
