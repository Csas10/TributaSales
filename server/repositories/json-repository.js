const fs = require("node:fs/promises");
const path = require("node:path");

const memoryStore = new Map();

class JsonRepository {
  constructor(filename, fallback = []) {
    this.filename = filename;
    this.filepath = path.join(__dirname, "..", "..", "data", filename);
    this.fallback = fallback;
    this.writeQueue = Promise.resolve();
    this.serverless = process.env.VERCEL === "1" || process.env.VERCEL === "true" || Boolean(process.env.VERCEL_ENV);
  }

  async findAll() {
    if (this.serverless && memoryStore.has(this.filename)) {
      return memoryStore.get(this.filename).map((item) => ({ ...item }));
    }
    try {
      const content = await fs.readFile(this.filepath, "utf8");
      const value = JSON.parse(content);
      if (!Array.isArray(value)) return this.initialValue();
      if (this.serverless) memoryStore.set(this.filename, value);
      return value;
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return this.initialValue();
      throw error;
    }
  }

  async saveAll(value) {
    if (this.serverless) {
      memoryStore.set(this.filename, value.map((item) => ({ ...item })));
      return;
    }
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filepath), { recursive: true });
      await fs.writeFile(this.filepath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    });
    return this.writeQueue;
  }

  initialValue() {
    const value = this.fallback.map((item) => ({ ...item }));
    if (this.serverless) memoryStore.set(this.filename, value);
    return value;
  }
}

module.exports = JsonRepository;
