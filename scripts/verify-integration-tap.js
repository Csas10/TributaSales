const fs = require("node:fs");

const file = process.argv[2];
if (!file) {
  throw new Error("Informe o arquivo TAP da integração.");
}

const bytes = fs.readFileSync(file);
const content = (
  bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.toString("utf16le").slice(1)
    : bytes.toString("utf8").replace(/^\uFEFF/, "")
).replace(/\r\n/g, "\n");
const fields = ["tests", "fail", "skipped", "cancelled", "todo"];
const summary = {};

for (const field of fields) {
  const matches = [...content.matchAll(new RegExp(`^# ${field} (\\d+)$`, "gm"))];
  if (matches.length !== 1) {
    throw new Error(`Resumo TAP inválido para ${field}.`);
  }
  summary[field] = Number(matches[0][1]);
}

if (
  !Number.isSafeInteger(summary.tests) ||
  summary.tests <= 0 ||
  summary.fail !== 0 ||
  summary.skipped !== 0 ||
  summary.cancelled !== 0 ||
  summary.todo !== 0
) {
  throw new Error(`Resumo TAP não atende aos critérios: ${JSON.stringify(summary)}.`);
}

console.log(`Integration TAP verified: ${JSON.stringify(summary)}`);
