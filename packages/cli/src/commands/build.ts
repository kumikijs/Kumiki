import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "@kumikijs/compiler";
import { resolveBuiltinIcons } from "@kumikijs/compiler/node";
import type { Command } from "commander";
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
   * Minify the generated `app.js`, keeping `runtime/` as separate modules.
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
   * and drop `runtime/`. Implies `minify`.
   *
   * Worth its own flag rather than being implied by `--minify` because the two
   * optimise opposite things. The modular layout gives `runtime/core.js` a URL
   * that does not change when the app does, so a returning visitor re-downloads
   * only `app.js`. Bundling gives a first visitor one request and one
   * compression stream over the whole payload, which is worth 20–30% on the
   * examples — gzip and brotli build their dictionary per response, so twenty
   * small modules compress markedly worse than the same bytes linked together.
   *
   * It also tree-shakes across the seam the module boundary hides: a tile
   * module's renderer that the app's `_tiles` never names, a stdlib helper it
   * never calls.
   */
  bundle?: boolean;
};

/** The files a build writes, as content — assembled before anything lands on disk. */
type Artifacts = { appJs: string; modules: Map<string, string>; html: string };

/**
 * Minify `app.js`, and with `bundle` also link the runtime modules into it.
 *
 * Both flags go through rolldown — the same linker `@kumikijs/vite` already
 * depends on, pinned to the same version so one native toolchain ships rather
 * than two. `external` is what separates them: keeping `./runtime/*` external
 * minifies the app module alone and leaves the imports (and therefore the
 * modular layout) intact; dropping it pulls them in.
 *
 * It runs over a staging copy on disk rather than in memory, so what is linked
 * is exactly what the modular build produces — one code path, and the
 * optimised output cannot drift from the layout the other tiers test. Nothing
 * reaches `outdir` until this returns, so a linker error leaves no partial
 * build behind for a deploy step to ship by mistake.
 *
 * rolldown is imported here rather than at module scope because it is a native
 * addon and both flags are opt-in: `kumiki check` / `list` / `view` / `fix`,
 * and `@kumikijs/mcp` at startup, would otherwise pay to load it.
 */
async function link(artifacts: Artifacts, bundle: boolean): Promise<Artifacts> {
  const { rolldown } = await import("rolldown");
  const stage = mkdtempSync(join(tmpdir(), "kumiki-link-"));
  try {
    writeFileSync(join(stage, "app.js"), artifacts.appJs);
    mkdirSync(join(stage, "runtime"), { recursive: true });
    for (const [name, code] of artifacts.modules) {
      writeFileSync(join(stage, "runtime", `${name}.js`), code);
    }
    const build = await rolldown({
      input: join(stage, "app.js"),
      platform: "browser",
      ...(bundle ? {} : { external: (id: string) => id.startsWith("./runtime/") }),
    });
    try {
      const { output } = await build.generate({ format: "esm", minify: true });
      const chunks = output.filter((o) => o.type === "chunk");
      if (chunks.length !== 1) {
        // Every import the generated header emits is static and relative, so
        // the graph has no split point. More than one chunk means something
        // changed upstream, and silently writing the first would ship a
        // broken app.
        const names = chunks.map((c) => c.fileName).join(", ");
        throw new Error(`kumiki build: expected one chunk, got ${chunks.length} (${names})`);
      }
      const [chunk] = chunks;
      if (!chunk) throw new Error("kumiki build: linker produced no chunk");
      return {
        appJs: chunk.code,
        modules: bundle ? new Map() : artifacts.modules,
        html: artifacts.html,
      };
    } finally {
      await build.close();
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
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
  const linked = result.runtimeModules.length;
  let artifacts: Artifacts = {
    appJs: result.js,
    modules: new Map(result.runtimeModules.map((m) => [m, readRuntimeModule(m)])),
    html: buildHtml(),
  };
  if (options.minify || options.bundle) {
    artifacts = await link(artifacts, options.bundle === true);
  }
  mkdirSync(outdir, { recursive: true });
  writeFileSync(resolve(outdir, "app.js"), artifacts.appJs);
  writeFileSync(resolve(outdir, "index.html"), artifacts.html);
  if (artifacts.modules.size > 0) {
    mkdirSync(resolve(outdir, "runtime"), { recursive: true });
    for (const [name, code] of artifacts.modules) {
      writeFileSync(resolve(outdir, "runtime", `${name}.js`), code);
    }
    console.log(
      `Wrote ${outdir}/index.html, app.js${options.minify ? " (minified)" : ""}, runtime/ (${[...artifacts.modules.keys()].join(", ")})`,
    );
    return;
  }
  console.log(
    `Wrote ${outdir}/index.html, app.js (bundled, minified — ${linked} runtime modules linked in)`,
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
