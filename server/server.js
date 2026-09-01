const express = require("express");
const path = require("node:path");
const { config } = require("./config/env");
const { requireDatabase } = require("./config/database");
const ProductRepository = require("./repositories/product-repository");
const OrderRepository = require("./repositories/order-repository");
const { ProductService } = require("./services/product-service");
const { OrderService } = require("./services/order-service");
const ProductController = require("./controllers/product-controller");
const OrderController = require("./controllers/order-controller");
const { AuthService } = require("./services/auth-service");
const { UserService } = require("./services/user-service");
const { AddressService } = require("./services/address-service");
const AuthController = require("./controllers/auth-controller");
const UserController = require("./controllers/user-controller");
const AddressController = require("./controllers/address-controller");
const productRoutes = require("./routes/product-routes");
const orderRoutes = require("./routes/order-routes");
const cepRoutes = require("./routes/cep-routes");
const healthRoutes = require("./routes/health-routes");
const authRoutes = require("./routes/auth-routes");
const userRoutes = require("./routes/user-routes");
const { createAuthenticate } = require("./middleware/authenticate");
const { errorMiddleware } = require("./middleware/error-middleware");

const app = express();
const port = config.port;

const productService = new ProductService(new ProductRepository());
const orderService = new OrderService(new OrderRepository(), new ProductRepository());
const mongoUserService = new UserService({
  connect: requireDatabase
});
const authService = new AuthService({
  userService: mongoUserService
});
const addressService = new AddressService({
  connect: requireDatabase
});
const authenticate = createAuthenticate({
  userService: mongoUserService,
  connect: requireDatabase
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));
app.use("/api/produtos", productRoutes(new ProductController(productService)));
app.use("/api/pedidos", orderRoutes(new OrderController(orderService)));
app.use("/api/cep", cepRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes(new AuthController(authService)));
app.use(
  "/api/users",
  userRoutes(
    new UserController(),
    new AddressController(addressService),
    authenticate
  )
);
app.use("/api", (req, res) => res.status(404).json({ erro: "Rota não encontrada.", status: 404 }));
app.use(errorMiddleware);

if (require.main === module) {
  app.listen(port, () => console.log(`TributaSales em http://localhost:${port}`));
}

module.exports = app;
