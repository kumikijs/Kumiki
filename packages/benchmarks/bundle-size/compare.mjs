// Print the base-vs-head bundle-size comparison as Markdown — the body of the
// PR comment the `Bundle size` workflow posts.
//
//   node bundle-size/compare.mjs <base.json> <head.json>
//
// Both files are `measure.mjs --out` reports.

import { readFileSync } from "node:fs";
import { renderComparison } from "./report.mjs";

const [basePath, headPath] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error("Usage: node bundle-size/compare.mjs <base.json> <head.json>");
  process.exit(2);
}
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
process.stdout.write(renderComparison(read(basePath), read(headPath)));
