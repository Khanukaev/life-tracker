// Bundle budget: total JavaScript (all chunks) must stay under 100 KB gzip,
// the first-screen entry chunk is reported separately.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 100;
const dir = join(import.meta.dirname, "../dist/assets");
const html = readFileSync(join(import.meta.dirname, "../dist/index.html"), "utf8");
let total = 0;
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".js") || x.endsWith(".css"))) {
  const buf = readFileSync(join(dir, f));
  const gz = gzipSync(buf, { level: 9 }).length;
  if (f.endsWith(".js")) total += gz;
  rows.push([f, (statSync(join(dir, f)).size / 1024).toFixed(1), (gz / 1024).toFixed(1), html.includes(f) ? "first screen" : "lazy"]);
}
console.table(rows.map(([file, raw, gzip, load]) => ({ file, "raw KB": raw, "gzip KB": gzip, load })));
console.log(`JS total: ${(total / 1024).toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB * 1024) {
  console.error("Bundle budget exceeded");
  process.exit(1);
}
