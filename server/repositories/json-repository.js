const fs = require("node:fs/promises");
const path = require("node:path");

class JsonRepository {
  constructor(filename, fallback = []) {
    this.filepath = path.join(__dirname, "..", "..", "data", filename);
    this.fallback = fallback;
    this.writeQueue = Promise.resolve();
  }

  async findAll() {
    try {
      const content = await fs.readFile(this.filepath, "utf8");
      const value = JSON.parse(content);
      if (!Array.isArray(value)) return [...this.fallback];
      return value;
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return [...this.fallback];
      throw error;
    }
  }

  async saveAll(value) {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filepath), { recursive: true });
      await fs.writeFile(this.filepath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    });
    return this.writeQueue;
  }
}

module.exports = JsonRepository;
