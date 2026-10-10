import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "@kumikijs/examples";
import { createServer, type PluginOption } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";
import { buildInto, project as projectWith } from "./helpers/plugin.ts";
import { scratchRoot } from "./helpers/scratch.ts";

const SOURCE = readFileSync(app("01-counter"), "utf8");

const TMP = scratchRoot(import.meta.url);

const project = (main = ""): string => projectWith(TMP, SOURCE, main);

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
const NOT_VITES = ["inline", "no-inline", "raw=1", "url=x"] as const;
const DEV_QUERIES = [...ASSET_QUERIES, "worker", "sharedworker"] as const;

describe("vite build of each import form", () => {
  it("compiles the plain import", async () => {
    const out = await buildMain(`import App from "./app.kumiki";\nconsole.log(App);\n`, [kumiki()]);
    expect(out).toContain("kumiki-state-styles");
    expect(out).not.toContain(JSON.stringify(SOURCE));
  }, 60_000);

  it("gives `?raw` the file's text", async () => {
    const out = await buildMain(`import src from "./app.kumiki?raw";\nconsole.log(src);\n`, [
      kumiki(),
    ]);
    expect(out).toContain(JSON.stringify(SOURCE));
  }, 60_000);

  it.each(ASSET_QUERIES)("builds `?%s` exactly as Vite does without the plugin", async (query) => {
    const root = project(`import v from "./app.kumiki?${query}";\nconsole.log(v);\n`);
    const alone = await outcome(() => buildInto(root, join(root, "alone"), []));
    const withPlugin = await outcome(() => buildInto(root, join(root, "plugin"), [kumiki()]));
    expect(alone).toMatch(/^ok: /);
    expect(withPlugin).toBe(alone);
  }, 60_000);

  it.each(NOT_VITES)("compiles `?%s`, which Vite leaves alone", async (query) => {
    const out = await buildMain(`import App from "./app.kumiki?${query}";\nconsole.log(App);\n`, [
      kumiki(),
    ]);
    expect(out).toContain("kumiki-state-styles");
    expect(out).not.toContain(JSON.stringify(SOURCE));
  }, 60_000);

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

  it.each(DEV_QUERIES)("serves `?%s` exactly as Vite does without the plugin", async (query) => {
    const url = `/src/app.kumiki?${query}`;
    const expected = await outcome(async () => (await alone.transformRequest(url))?.code);
    const actual = await outcome(async () => (await withPlugin.transformRequest(url))?.code);
    expect(expected).toMatch(/^ok: /);
    expect(actual).toBe(expected);
  });

  it.each(NOT_VITES)("compiles `?%s`, which Vite leaves alone", async (query) => {
    const out = await withPlugin.transformRequest(`/src/app.kumiki?${query}`);
    expect(out?.code).toContain("export default App");
  });
});
