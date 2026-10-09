import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "@kumikijs/compiler";
import type { Command } from "commander";
import { formatDiagnostic } from "../diagnostic.ts";
import { builtinIconSubset } from "../icons.ts";
import { capsFor, reportCapabilitySearch } from "./_shared/caps.ts";
import { exitWithUsage } from "./_shared/usage.ts";

const require = createRequire(import.meta.url);

const USAGE = "Usage: kumiki build <input.kumiki> <outdir> [--minify] [--bundle]";

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
  minify?: boolean;
  bundle?: boolean;
};

/** The files a build writes, as content — assembled before anything lands on disk. */
type Artifacts = { appJs: string; modules: Map<string, string>; html: string };

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
      console.error(formatDiagnostic(w));
    }
    for (const err of first.errors) {
      console.error(formatDiagnostic(err));
    }
    reportCapabilitySearch(first.errors, caps);
    process.exit(1);
  }
  for (const w of first.warnings) {
    console.error(formatDiagnostic(w));
  }
  let result = first;
  const icons = await builtinIconSubset(inputPath, first.usedIcons);
  if (icons) {
    const second = compile(source, { ...baseOpts, icons });
    if (second.kind === "ok") result = second;
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

export function registerBuild(program: Command): string {
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
        if (!input || !outdir) exitWithUsage(USAGE);
        await buildCmd(input, outdir, {
          minify: options.minify === true,
          bundle: options.bundle === true,
        });
      },
    );
  return USAGE;
}
