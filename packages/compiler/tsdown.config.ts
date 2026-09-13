import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

// @kumikijs/compiler ships two entrypoints:
//   .       — browser-safe compiler core (no node: imports)
//   ./node  — node-only helpers (reads the runtime bundle from disk)
// Workspace deps (@kumikijs/runtime) are auto-externalized by tsdown.
export default defineConfig({
  entry: { index: "src/index.ts", node: "src/node.ts" },
  format: "esm",
  dts: true,
  // Emit .js/.d.ts (honors "type": "module") instead of tsdown's node-default .mjs.
  fixedExtension: false,
  outputOptions: publishedOutputOptions,
});
