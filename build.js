const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "dist");

// Clean dist
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// Copy files/directories
const items = ["index.html", "css", "js"];
for (const item of items) {
  const src = path.join(__dirname, item);
  const dest = path.join(distDir, item);
  if (!fs.existsSync(src)) continue;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log("Build concluído: dist/");
