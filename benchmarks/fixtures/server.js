import { readFile } from "node:fs/promises";

// simple config loader
export async function loadConfig(path) {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.version) {
    throw new Error("config missing version field");
  }
  return parsed;
}

/**
 * HTTP server wrapper around the order service.
 */
export class Server {
  constructor(orderService) {
    this.orderService = orderService;
    this.routes = new Map();
  }

  start(port) {
    console.log(`starting on port ${port}`);
    this.listen(port);
    this.registerRoutes();
  }

  registerRoutes() {
    this.routes.set("GET /orders/:id", (req, res) => {
      const order = this.orderService.get(req.params.id);
      if (!order) {
        res.status(404).send("not found");
        return;
      }
      res.json(order);
    });

    // FIXME: this endpoint does not validate the request body yet
    this.routes.set("POST /orders", (req, res) => {
      const created = this.orderService.create(req.body);
      res.status(201).json(created);
    });
  }

  listen(port) {
    this.httpServer = require("http").createServer((req, res) => {
      this.dispatch(req, res);
    });
    this.httpServer.listen(port);
  }
}
