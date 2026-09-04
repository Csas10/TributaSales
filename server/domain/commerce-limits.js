const MAX_CART_LINES = 100;
const MAX_ITEM_QUANTITY = 100000;
const MAX_PRODUCT_PRICE_CENTS = 100000000;
const MAX_CART_TOTAL_CENTS =
  MAX_CART_LINES * MAX_ITEM_QUANTITY * MAX_PRODUCT_PRICE_CENTS;

if (
  !Number.isSafeInteger(MAX_CART_TOTAL_CENTS) ||
  MAX_CART_TOTAL_CENTS > Number.MAX_SAFE_INTEGER
) {
  throw new Error("Os limites comerciais excedem a faixa numérica segura.");
}

module.exports = {
  MAX_CART_LINES,
  MAX_ITEM_QUANTITY,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_CART_TOTAL_CENTS
};
