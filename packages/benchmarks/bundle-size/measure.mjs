// What a browser downloads for each example app: build it the two ways
// `kumiki build` ships — `--bundle` (one linked file) and `--minify` (app.js
// beside the runtime modules it imports) — and count raw / gzip / brotli bytes.
//
//   node bundle-size/measure.mjs [--root <repo>] [--out <report.json>]
//
// `--root` measures another checkout with THAT checkout's CLI and runtime, so
// CI can measure a PR's base with the head's script and compare like for like.
// The checkout's runtime must be built (`pnpm --filter @kumikijs/runtime build`,
// or a whole `pnpm build`): `kumiki build` copies its prebuilt `dist/modules`.
// Nothing else needs a build — the CLI and compiler run from `src` via tsx.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { renderReport, sizes } from "./report.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Every `packages/examples/apps/<name>/app.kumiki` under `root`, in name order. */
export function listApps(root) {
  const dir = join(root, "packages", "examples", "apps");
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, path: join(dir, name, "app.kumiki") }))
    .filter((a) => existsSync(a.path));
}

/** Every file under `dir`, recursively. */
function files(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

/**
 * Run `kumiki build` from `root`'s own CLI source.
 *
 * `node --import tsx` with the loader resolved from `root`, the same way the
 * CLI's tests start it: no build of the CLI itself is needed, and a base
 * checkout runs its own code rather than this one's.
 */
function kumikiBuild(root, input, outDir, flag) {
  const tsx = pathToFileURL(createRequire(join(root, "package.json")).resolve("tsx")).href;
  const cli = join(root, "packages", "cli", "src", "kumiki.ts");
  execFileSync(process.execPath, ["--import", tsx, cli, "build", input, outDir, flag], {
    cwd: root,
    stdio: "pipe",
  });
}

/** Sizes of `--bundle` and `--minify` builds of one app. */
export function measureApp(root, app) {
  const tmp = mkdtempSync(join(tmpdir(), "kumiki-bundle-size-"));
  try {
    const bundleDir = join(tmp, "bundle");
    kumikiBuild(root, app.path, bundleDir, "--bundle");
    const bundle = sizes(readFileSync(join(bundleDir, "app.js")));

    const modularDir = join(tmp, "modular");
    kumikiBuild(root, app.path, modularDir, "--minify");
    // Each module is its own response, so each is compressed on its own:
    // summing per-file gzip is what the wire carries, not gzip of the concat.
    const js = files(modularDir).filter((f) => f.endsWith(".js"));
    const per = js.map((f) => ({ f, ...sizes(readFileSync(f)) }));
    const total = (k) => per.reduce((a, x) => a + x[k], 0);
    const appJs = per.find((x) => x.f === join(modularDir, "app.js"));
    if (!appJs) throw new Error(`${app.name}: --minify wrote no app.js`);
    return {
      name: app.name,
      bundle,
      modular: {
        files: js.length,
        raw: total("raw"),
        gzip: total("gzip"),
        brotli: total("brotli"),
      },
      // The runtime modules alone, uncompressed — the figure the CLI's counter
      // size test budgets (packages/cli/test/build.test.ts).
      runtime: total("raw") - appJs.raw,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({
    options: { root: { type: "string" }, out: { type: "string" } },
  });
  const root = resolve(values.root ?? join(here, "..", "..", ".."));
  const report = { apps: listApps(root).map((app) => measureApp(root, app)) };
  if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(renderReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
