// A bundler plugin exists so the bundler can do its job. Inlining the runtime
// into every compiled module took that away: a project that imports one
// `.kumiki` file and calls `mount` — the pattern this plugin's own
// documentation recommends — shipped the runtime twice, and each further
// `.kumiki` import added another copy. Two copies is not only size: the
// runtime keeps module-level state (the injected state-style sheet is found by
// DOM id while its sequence counter restarts per copy), so the copies disagree.
//
// The assertions run a real `vite build` and count copies against a baseline
// measured from a project that imports the runtime and nothing else.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { type KumikiPluginOptions, kumiki } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = join(here, "..", "..", "examples", "apps", "01-counter", "app.kumiki");
const TMP = join(here, "test-tmp");
mkdirSync(TMP, { recursive: true });

/** A literal the runtime carries and nothing else does — one hit set per copy. */
const RUNTIME_MARK = "kumiki-state-styles";

/** Build a one-entry project and return the concatenated output. */
async function buildProject(main: string, opts?: KumikiPluginOptions): Promise<string> {
  const root = mkdtempSync(join(TMP, "build-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.kumiki"), readFileSync(COUNTER, "utf8"));
  writeFileSync(join(root, "src", "main.ts"), main);
  await build({
    root,
    logLevel: "silent",
    plugins: [kumiki(opts)],
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      lib: { entry: join(root, "src", "main.ts"), formats: ["es"], fileName: "out" },
      minify: false,
    },
  });
  const outDir = join(root, "dist");
  return readdirSync(outDir)
    .map((f) => readFileSync(join(outDir, f), "utf8"))
    .join("\n");
}

const marks = (code: string): number => code.split(RUNTIME_MARK).length - 1;

const MOUNTS_THE_APP = `
import App from "./app.kumiki";
import { mount } from "@kumikijs/runtime";
mount(App, document.body);
`;

describe("the built app carries one runtime", () => {
  // One `vite build` each, so the whole file shares a single baseline.
  it("ships exactly the runtime the importer already imports", async () => {
    const baseline = marks(
      await buildProject(`import { mount } from "@kumikijs/runtime";\nconsole.log(mount);\n`),
    );
    expect(baseline).toBeGreaterThan(0);

    const dflt = marks(await buildProject(MOUNTS_THE_APP));
    expect(dflt).toBe(baseline);

    const bundled = marks(await buildProject(MOUNTS_THE_APP, { bundle: true }));
    expect(bundled).toBe(baseline * 2);
  }, 60_000);

  it("compiles to a module that imports the runtime by default", async () => {
    const plugin = kumiki();
    const t = plugin.transform;
    const fn = typeof t === "function" ? t : t?.handler;
    const src = readFileSync(COUNTER, "utf8");
    const out = (await fn?.call({ warn() {} } as never, src, COUNTER)) as { code: string };
    expect(out.code).toMatch(/from "@kumikijs\/runtime"/);
    expect(out.code).not.toContain(RUNTIME_MARK);
  });
});

describe("resolving the runtime", () => {
  /** The hook, plus a context whose `resolve` answers however the case needs. */
  function resolverWith(answer: unknown) {
    const plugin = kumiki();
    const r = plugin.resolveId;
    const fn = typeof r === "function" ? r : r?.handler;
    if (!fn) throw new Error("plugin has no resolveId hook");
    const calls: unknown[][] = [];
    const ctx = {
      resolve(...args: unknown[]) {
        calls.push(args);
        return Promise.resolve(answer);
      },
    };
    return {
      calls,
      run: (source: string) => fn.call(ctx as never, source, "/proj/src/main.ts", {} as never),
    };
  }

  it("says nothing when the project resolves the runtime itself", async () => {
    const { run, calls } = resolverWith({ id: "/proj/node_modules/@kumikijs/runtime/index.js" });
    await expect(run("@kumikijs/runtime")).resolves.toBeNull();
    // …and it asked, rather than assuming: without `skipSelf` the hook would
    // re-enter itself.
    expect(calls[0]?.[2]).toMatchObject({ skipSelf: true });
  });

  it("resolves the runtime from the plugin when the project cannot", async () => {
    const { run } = resolverWith(null);
    const id = (await run("@kumikijs/runtime")) as string;
    expect(typeof id).toBe("string");
    // A path Vite can load: posix-separated (Windows backslashes break the
    // module graph's id comparisons) and actually on disk.
    expect(id).not.toContain("\\");
    expect(readFileSync(id, "utf8").length).toBeGreaterThan(0);
  });

  it("leaves every other specifier alone", async () => {
    const { run, calls } = resolverWith(null);
    await expect(run("react")).resolves.toBeNull();
    await expect(run("@kumikijs/runtime/modules/core")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("asks the bundler to keep one copy of the runtime", () => {
    const plugin = kumiki();
    const c = plugin.config;
    const fn = typeof c === "function" ? c : c?.handler;
    const partial = fn?.call({} as never, {}, { command: "build", mode: "production" }) as
      | { resolve?: { dedupe?: string[] } }
      | null
      | undefined;
    expect(partial?.resolve?.dedupe).toContain("@kumikijs/runtime");
  });
});
