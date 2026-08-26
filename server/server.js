const express = require("express");
const path = require("node:path");
const ProductRepository = require("./repositories/product-repository");
const OrderRepository = require("./repositories/order-repository");
const { ProductService } = require("./services/product-service");
const { OrderService } = require("./services/order-service");
const ProductController = require("./controllers/product-controller");
const OrderController = require("./controllers/order-controller");
const productRoutes = require("./routes/product-routes");
const orderRoutes = require("./routes/order-routes");
const cepRoutes = require("./routes/cep-routes");
const { errorMiddleware } = require("./middleware/error-middleware");

const app = express();
const port = process.env.PORT || 3000;

const productService = new ProductService(new ProductRepository());
const orderService = new OrderService(new OrderRepository(), new ProductRepository());

app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));
app.use("/api/produtos", productRoutes(new ProductController(productService)));
app.use("/api/pedidos", orderRoutes(new OrderController(orderService)));
app.use("/api/cep", cepRoutes);
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada.", status: 404 }));
app.use(errorMiddleware);

if (require.main === module) {
  app.listen(port, () => console.log(`TributaSales em http://localhost:${port}`));
}

module.exports = app;
