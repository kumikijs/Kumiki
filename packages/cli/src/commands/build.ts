import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compile } from "@kumikijs/compiler";
import { resolveBuiltinIcons } from "@kumikijs/compiler/node";
import type { Command } from "commander";
import { capsFor, reportCapabilitySearch } from "./_shared/caps.ts";

const require = createRequire(import.meta.url);

const USAGE = "Usage: kumiki build <input.kumiki> <outdir>";

/**
 * Read one prebuilt (minified) runtime feature module. The modules are plain
 * browser ESM whose cross-imports are relative (`./core.js`, `./stdlib.js`),
 * so copying them side by side under `<outdir>/runtime/` keeps them resolvable.
 */
function readRuntimeModule(name: string): string {
  const modulePath = require.resolve(`@kumikijs/runtime/modules/${name}.js`);
  return readFileSync(modulePath, "utf8");
}

function buildHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kumiki App</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #fafafa; color: #1a1a1a; }
    button { padding: 6px 12px; font-size: 16px; cursor: pointer; }
    h1 { margin: 0 0 12px; }
  </style>
</head>
<body>
  <base href="/">
  <div id="root"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`;
}

export async function buildCmd(inputArg: string, outdirArg: string): Promise<void> {
  const inputPath = resolve(process.cwd(), inputArg);
  const outdir = resolve(process.cwd(), outdirArg);
  const source = readFileSync(inputPath, "utf8");
  const caps = capsFor(inputPath);
  const baseOpts = {
    runtimeSpecifier: "./runtime/core.js",
    runtimeModulesDir: "./runtime",
    capabilities: caps.capabilities,
  };
  const first = compile(source, baseOpts);
  if (first.kind === "fail") {
    for (const w of first.warnings) {
      console.error(`${w.code} ${w.kind} at ${w.pos.line}:${w.pos.col}: ${w.message}`);
    }
    for (const err of first.errors) {
      console.error(`${err.code} ${err.kind} at ${err.pos.line}:${err.pos.col}: ${err.message}`);
    }
    reportCapabilitySearch(first.errors, caps);
    process.exit(1);
  }
  for (const w of first.warnings) {
    console.error(`${w.code} ${w.kind} at ${w.pos.line}:${w.pos.col}: ${w.message}`);
  }
  let result = first;
  if (first.usedIcons.length > 0) {
    const registry = await resolveBuiltinIcons(inputPath);
    if (registry) {
      const subset: Record<string, string> = {};
      for (const name of first.usedIcons) {
        const path = registry[name];
        if (typeof path === "string") subset[name] = path;
      }
      if (Object.keys(subset).length > 0) {
        const second = compile(source, { ...baseOpts, icons: subset });
        if (second.kind === "ok") result = second;
      }
    }
  }
  mkdirSync(outdir, { recursive: true });
  writeFileSync(resolve(outdir, "app.js"), result.js);
  mkdirSync(resolve(outdir, "runtime"), { recursive: true });
  for (const mod of result.runtimeModules) {
    writeFileSync(resolve(outdir, "runtime", `${mod}.js`), readRuntimeModule(mod));
  }
  writeFileSync(resolve(outdir, "index.html"), buildHtml());
  console.log(`Wrote ${outdir}/index.html, app.js, runtime/ (${result.runtimeModules.join(", ")})`);
}

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("Compile a .kumiki file and write app.js + runtime/ + index.html into <outdir>")
    .argument("[input]", "input .kumiki file")
    .argument("[outdir]", "output directory")
    .allowExcessArguments(false)
    .action(async (input: string | undefined, outdir: string | undefined) => {
      if (!input || !outdir) {
        console.error(USAGE);
        process.exit(2);
      }
      await buildCmd(input, outdir);
    });
}
