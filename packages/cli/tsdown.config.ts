import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

export default defineConfig({
  entry: { index: "src/index.ts", kumiki: "src/kumiki.ts" },
  format: "esm",
  dts: true,
  fixedExtension: false,
  // A directory copy lands inside `to`: dist/dev/*.ts, where src/dev.ts reads them, and
  // dist/guides/*.md and dist/spec/*.md, where src/guide.ts reads them in an installed copy.
  copy: [
    { from: "src/dev/", to: "dist/" },
    { from: "src/guides/", to: "dist/" },
    { from: "../../docs/spec/", to: "dist/" },
  ],
  outputOptions: publishedOutputOptions,
});
