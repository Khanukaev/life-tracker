// Pre-compress static files (brotli + gzip) so the web server serves them without CPU cost.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = join(import.meta.dirname, "../dist");
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const file of walk(root).filter((f) => /\.(js|css|html|svg|json)$/.test(f))) {
  const buf = readFileSync(file);
  writeFileSync(`${file}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
  writeFileSync(`${file}.gz`, gzipSync(buf, { level: 9 }));
}
console.log("compressed static assets");
