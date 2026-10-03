// Print the base-vs-head bundle-size comparison as Markdown — the body of the
// PR comment the `Bundle size` workflow posts.
//
//   node bundle-size/compare.mjs <base.json> <head.json>
//
// Both files are `measure.mjs --out` reports. A base file that does not exist
// means the base could not be measured; the head is then shown alone.

import { existsSync, readFileSync } from "node:fs";
import { renderComparison } from "./report.mjs";

const [basePath, headPath] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error("Usage: node bundle-size/compare.mjs <base.json> <head.json>");
  process.exit(2);
}
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
process.stdout.write(
  renderComparison(existsSync(basePath) ? read(basePath) : undefined, read(headPath)),
);
