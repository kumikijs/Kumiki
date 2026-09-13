import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compile } from "@kumikijs/compiler";
import { resolveBuiltinIcons } from "@kumikijs/compiler/node";
import type { Command } from "commander";
import { minify } from "oxc-minify";
import { rolldown } from "rolldown";
import { capsFor, reportCapabilitySearch } from "./_shared/caps.ts";

const require = createRequire(import.meta.url);

const USAGE = "Usage: kumiki build <input.kumiki> <outdir> [--minify] [--bundle]";

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

export type BuildOptions = {
  /**
   * Minify the generated `app.js`.
   *
   * Off by default, and that default is the load-bearing one: the AI debug
   * loop reads `app.js` stack traces, and the harnesses patch two of its
   * emitted lines by verbatim string replace (see codegen's note on
   * `const App = createApp();`). Minifying renames every top-level binding, so
   * a build that did it unasked would take both away. `runtime/` is untouched
   * either way — those modules ship minified already.
   */
  minify?: boolean;
  /**
   * Link `app.js` and the runtime modules it imports into one minified file,
   * and drop `runtime/`.
   *
   * Worth its own flag rather than being implied by `--minify` because the two
   * optimise opposite things. The modular layout gives `runtime/core.js` a URL
   * that does not change when the app does, so a returning visitor re-downloads
   * only `app.js`. Bundling gives a first visitor one request and one
   * compression stream over the whole payload, which is worth 20–30% on the
   * examples — gzip and brotli build their dictionary per file, so twenty small
   * modules compress markedly worse than the same bytes linked together.
   *
   * It also tree-shakes across the seam the module boundary hides: a tile
   * module's renderer that the app's `_tiles` never names, a stdlib helper it
   * never calls.
   */
  bundle?: boolean;
};

/**
 * Minify one generated module, or fail the build saying which construct broke.
 *
 * A minifier error means the output would be wrong, not merely large, so it
 * must not fall back to writing the unminified source under a flag that says
 * otherwise — a deploy would silently ship the readable build.
 */
async function minifyApp(js: string): Promise<string> {
  const result = await minify("app.js", js);
  if (result.errors.length > 0) {
    const detail = result.errors.map((e) => e.message).join("\n");
    throw new Error(`kumiki build --minify: could not minify app.js\n${detail}`);
  }
  return result.code;
}

/**
 * Link the written output into a single minified `app.js` and remove
 * `runtime/`. Runs over the artifacts on disk rather than in memory, so what
 * is bundled is exactly what the modular build produces — one code path, and
 * `--bundle` cannot drift from the layout the other tiers test.
 */
async function bundleOutput(outdir: string): Promise<void> {
  const entry = resolve(outdir, "app.js");
  const build = await rolldown({ input: entry, platform: "browser" });
  const { output } = await build.generate({ format: "esm", minify: true });
  const chunks = output.filter((o) => o.type === "chunk");
  if (chunks.length !== 1) {
    // Every import the generated header emits is static and relative, so the
    // graph has no split point. More than one chunk means something changed
    // upstream, and silently writing the first would ship a broken app.
    throw new Error(
      `kumiki build --bundle: expected one chunk, got ${chunks.length} (${chunks
        .map((c) => c.fileName)
        .join(", ")})`,
    );
  }
  await build.close();
  writeFileSync(entry, chunks[0]?.code ?? "");
  rmSync(resolve(outdir, "runtime"), { recursive: true, force: true });
}

export async function buildCmd(
  inputArg: string,
  outdirArg: string,
  options: BuildOptions = {},
): Promise<void> {
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
  // `--bundle` minifies the linked output, so pre-minifying here would be the
  // same work twice on a file that is about to be replaced.
  const appJs = options.minify && !options.bundle ? await minifyApp(result.js) : result.js;
  mkdirSync(outdir, { recursive: true });
  writeFileSync(resolve(outdir, "app.js"), appJs);
  mkdirSync(resolve(outdir, "runtime"), { recursive: true });
  for (const mod of result.runtimeModules) {
    writeFileSync(resolve(outdir, "runtime", `${mod}.js`), readRuntimeModule(mod));
  }
  writeFileSync(resolve(outdir, "index.html"), buildHtml());
  if (options.bundle) {
    await bundleOutput(outdir);
    console.log(
      `Wrote ${outdir}/index.html, app.js (bundled, minified — ${result.runtimeModules.length} runtime modules linked in)`,
    );
    return;
  }
  console.log(
    `Wrote ${outdir}/index.html, app.js${options.minify ? " (minified)" : ""}, runtime/ (${result.runtimeModules.join(", ")})`,
  );
}

export function registerBuild(program: Command): void {
  program
    .command("build")
    .description("Compile a .kumiki file and write app.js + runtime/ + index.html into <outdir>")
    .argument("[input]", "input .kumiki file")
    .argument("[outdir]", "output directory")
    .option("--minify", "minify app.js (off by default — the debug loop reads it)")
    .option("--bundle", "link app.js + runtime/ into one minified file (implies --minify)")
    .allowExcessArguments(false)
    .action(
      async (
        input: string | undefined,
        outdir: string | undefined,
        options: { minify?: boolean; bundle?: boolean },
      ) => {
        if (!input || !outdir) {
          console.error(USAGE);
          process.exit(2);
        }
        await buildCmd(input, outdir, {
          minify: options.minify === true,
          bundle: options.bundle === true,
        });
      },
    );
}
