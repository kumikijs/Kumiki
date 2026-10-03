import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

// @kumikijs/mcp ships the programmatic API (`index`) plus the `kumiki-mcp` stdio
// server executable (`server`, shebang #!/usr/bin/env node preserved by tsdown).
// Deps (@kumikijs/*, @modelcontextprotocol/sdk, zod) are auto-externalized.
export default defineConfig({
  entry: { index: "src/index.ts", server: "src/server.ts" },
  format: "esm",
  dts: true,
  // Emit .js/.d.ts (honors "type": "module") instead of tsdown's node-default .mjs.
  fixedExtension: false,
  outputOptions: publishedOutputOptions,
});
