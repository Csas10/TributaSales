// Compatibility facade for the CLI and existing consumers.
const ProductRepository = require("./repositories/product-repository");
const OrderRepository = require("./repositories/order-repository");

const products = new ProductRepository();
const orders = new OrderRepository();

const listarProdutos = () => products.findAll();
const salvarProdutos = (value) => products.saveAll(value);
const listarPedidos = () => orders.findAll();
const salvarPedidos = (value) => orders.saveAll(value);

module.exports = { listarProdutos, salvarProdutos, listarPedidos, salvarPedidos };
