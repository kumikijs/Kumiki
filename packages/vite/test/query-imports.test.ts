// Vite gives the same file different meanings through a query: `?raw` is its
// text, `?url` its URL (`&inline` / `&no-inline` choosing the form), `?worker`
// a wrapper that starts it as a worker. Those imports belong to Vite. The
// plugin compiles the module a `.kumiki` file *is* — the plain import, and
// the `?import` marker Vite's dev server adds to it — so a project can show an
// app's source next to the app.
//
// Each of Vite's query forms is checked against a project with no plugin at
// all: Vite alone must succeed, and with the plugin enabled it must produce
// the same thing. A query Vite does not act on (a bare `?inline`, `?raw=1`)
// fails without the plugin, so it is the plugin's, and it still compiles.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, type PluginOption } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = join(here, "..", "..", "examples", "apps", "01-counter", "app.kumiki");
const SOURCE = readFileSync(COUNTER, "utf8");
const TMP = join(here, "test-tmp");
mkdirSync(TMP, { recursive: true });

/** A throwaway project holding the counter app at `src/app.kumiki`. */
function project(main = ""): string {
  const root = mkdtempSync(join(TMP, "query-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.kumiki"), SOURCE);
  writeFileSync(join(root, "src", "main.ts"), main);
  return root;
}

/** `vite build` the project's `src/main.ts` into `outDir`; return the concatenated output. */
async function buildInto(
  root: string,
  outDir: string,
  plugins: PluginOption[],
  workerPlugins: PluginOption[] = [],
): Promise<string> {
  await build({
    root,
    logLevel: "silent",
    plugins,
    worker: { format: "es", plugins: () => workerPlugins },
    build: {
      outDir,
      emptyOutDir: true,
      lib: { entry: join(root, "src", "main.ts"), formats: ["es"], fileName: "out" },
      minify: false,
    },
  });
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

function buildMain(main: string, plugins: PluginOption[]): Promise<string> {
  const root = project(main);
  return buildInto(root, join(root, "dist"), plugins);
}

/** What a build or a transform came to: its output, or the message it failed with. */
async function outcome(run: () => Promise<string | undefined>): Promise<string> {
  try {
    return `ok: ${await run()}`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}

const ASSET_QUERIES = ["raw", "url", "url&inline", "url&no-inline"] as const;
/** Queries Vite gives no meaning to on a `.kumiki` file: the module itself. */
const NOT_VITES = ["inline", "no-inline", "raw=1", "url=x"] as const;
// A worker's own entry is bundled by a separate build that runs only
// `worker.plugins`, so a `vite build` of `?worker` fails in that build the same
// way with or without this plugin and cannot tell the two apart. The wrapper
// the importer gets is checked through the dev server instead.
const DEV_QUERIES = [...ASSET_QUERIES, "worker", "sharedworker"] as const;

describe("vite build of each import form", () => {
  it("compiles the plain import", async () => {
    const out = await buildMain(`import App from "./app.kumiki";\nconsole.log(App);\n`, [kumiki()]);
    // The runtime was pulled in by the compiled module; the source text was not.
    expect(out).toContain("kumiki-state-styles");
    expect(out).not.toContain(JSON.stringify(SOURCE));
  }, 60_000);

  it("gives `?raw` the file's text", async () => {
    const out = await buildMain(`import src from "./app.kumiki?raw";\nconsole.log(src);\n`, [
      kumiki(),
    ]);
    expect(out).toContain(JSON.stringify(SOURCE));
  }, 60_000);

  for (const query of ASSET_QUERIES) {
    it(`builds \`?${query}\` exactly as Vite does without the plugin`, async () => {
      const root = project(`import v from "./app.kumiki?${query}";\nconsole.log(v);\n`);
      const alone = await outcome(() => buildInto(root, join(root, "alone"), []));
      const withPlugin = await outcome(() => buildInto(root, join(root, "plugin"), [kumiki()]));
      expect(alone).toMatch(/^ok: /);
      expect(withPlugin).toBe(alone);
    }, 60_000);
  }

  for (const query of NOT_VITES) {
    it(`compiles \`?${query}\`, which Vite leaves alone`, async () => {
      const out = await buildMain(`import App from "./app.kumiki?${query}";\nconsole.log(App);\n`, [
        kumiki(),
      ]);
      expect(out).toContain("kumiki-state-styles");
      expect(out).not.toContain(JSON.stringify(SOURCE));
    }, 60_000);
  }

  it("bundles a `?worker` entry compiled, once the plugin is a worker plugin too", async () => {
    const root = project(`import W from "./app.kumiki?worker";\nconsole.log(new W());\n`);
    const out = await buildInto(root, join(root, "dist"), [kumiki()], [kumiki()]);
    expect(out).toContain("kumiki-state-styles");
    expect(out).not.toContain(JSON.stringify(SOURCE));
  }, 60_000);
});

describe("dev server transform of each import form", () => {
  type Server = Awaited<ReturnType<typeof createServer>>;
  let withPlugin: Server;
  let alone: Server;

  beforeAll(async () => {
    const root = project();
    const serve = (plugins: PluginOption[]) =>
      createServer({
        root,
        logLevel: "silent",
        configFile: false,
        plugins,
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true, include: [] },
      });
    withPlugin = await serve([kumiki()]);
    alone = await serve([]);
  }, 60_000);

  afterAll(async () => {
    await withPlugin?.close();
    await alone?.close();
  });

  it("compiles the `?import` request Vite makes for a plain import", async () => {
    const out = await withPlugin.transformRequest("/src/app.kumiki?import");
    expect(out?.code).toContain("export default App");
    expect(out?.code).not.toContain(JSON.stringify(SOURCE));
  });

  it("gives `?raw` the file's text", async () => {
    const out = await withPlugin.transformRequest("/src/app.kumiki?raw");
    expect(out?.code).toContain(JSON.stringify(SOURCE));
  });

  for (const query of DEV_QUERIES) {
    it(`serves \`?${query}\` exactly as Vite does without the plugin`, async () => {
      const url = `/src/app.kumiki?${query}`;
      const expected = await outcome(async () => (await alone.transformRequest(url))?.code);
      const actual = await outcome(async () => (await withPlugin.transformRequest(url))?.code);
      expect(expected).toMatch(/^ok: /);
      expect(actual).toBe(expected);
    });
  }

  for (const query of NOT_VITES) {
    it(`compiles \`?${query}\`, which Vite leaves alone`, async () => {
      const out = await withPlugin.transformRequest(`/src/app.kumiki?${query}`);
      expect(out?.code).toContain("export default App");
    });
  }
});
