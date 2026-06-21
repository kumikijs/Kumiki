import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { type KumikiPluginOptions, kumiki } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER = join(here, "..", "..", "examples", "apps", "01-counter", "app.kumiki");
// A feature whose capability lives in a sibling kumiki.caps.json (exercises
// resolveCapabilities wiring through the plugin).
const CUSTOM_CAP = join(here, "..", "..", "examples", "features", "27-custom-capability.kumiki");

const TMP = join(here, "test-tmp");
mkdirSync(TMP, { recursive: true });

/** Vite's transform may be a function or an object hook; normalize to a callable. */
function transformOf(opts?: KumikiPluginOptions) {
  const plugin = kumiki(opts);
  const t = plugin.transform;
  const fn = typeof t === "function" ? t : t?.handler;
  if (!fn) throw new Error("plugin has no transform hook");
  return fn;
}

// Minimal Rollup-ish context: `error` throws (mirroring its `never` contract).
const ctx = {
  error(e: unknown): never {
    throw new Error(typeof e === "string" ? e : (e as Error).message);
  },
};

async function runTransform(file: string, opts?: KumikiPluginOptions): Promise<string> {
  const src = readFileSync(file, "utf8");
  const out = (await transformOf(opts).call(ctx as never, src, file)) as { code: string } | null;
  if (!out) throw new Error("transform returned null");
  return out.code;
}

async function importModule(code: string): Promise<AppShape> {
  const dir = mkdtempSync(join(TMP, "mod-"));
  const path = join(dir, "app.mjs");
  writeFileSync(path, code);
  const mod = (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)) as {
    default: AppShape;
  };
  return mod.default;
}

describe("vite-plugin-kumiki", () => {
  it("compiles a .kumiki file to a default-exported, self-contained module (bundle)", async () => {
    const code = await runTransform(COUNTER);
    expect(code).toContain("export default App;");
    // bundled: runtime inlined, no bare external import left behind
    expect(code).not.toMatch(/^import \{[^}]*\} from "@kumikijs\/runtime"/m);
    const app = await importModule(code);
    expect(app.slots).toHaveProperty("count");
    expect(Array.isArray(app.reducers)).toBe(true);
    expect(typeof app.effects).toBe("object");
  });

  it("exports a createApp factory yielding independent instances", async () => {
    const code = await runTransform(COUNTER);
    expect(code).toContain("export { createApp };");
    const dir = mkdtempSync(join(TMP, "factory-"));
    const file = join(dir, "app.mjs");
    writeFileSync(file, code);
    const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as {
      createApp: () => AppShape;
    };
    const a = mod.createApp();
    const b = mod.createApp();
    expect(a.live).not.toBe(b.live);
  });

  it("keeps the runtime as an external import when bundle is false", async () => {
    const code = await runTransform(COUNTER, { bundle: false });
    expect(code).toContain("export default App;");
    expect(code).toMatch(/from "@kumikijs\/runtime"/);
  });

  it("ignores non-.kumiki ids", async () => {
    const out = await transformOf().call(ctx as never, "const x = 1;", "/abs/foo.ts");
    expect(out).toBeNull();
  });

  it("strips a query suffix from the id before matching", async () => {
    const src = readFileSync(COUNTER, "utf8");
    const out = (await transformOf().call(ctx as never, src, `${COUNTER}?import`)) as {
      code: string;
    };
    expect(out.code).toContain("export default App;");
  });

  it("resolves project capabilities from a sibling kumiki.caps.json", async () => {
    // Without manifest resolution this would fail typecheck (E0302 unknown cap).
    const code = await runTransform(CUSTOM_CAP);
    expect(code).toContain("export default App;");
    const app = await importModule(code);
    expect(app.caps).toContain("telemetry.track");
  });

  it("reports a compile error through ctx.error", async () => {
    const bad = `app A caps=[] routes={"/" -> Missing, "/404" -> Missing} init=[]`;
    await expect(transformOf().call(ctx as never, bad, "/abs/bad.kumiki")).rejects.toThrow(
      /Kumiki compile failed/,
    );
  });

  it("emits a sibling <name>.kumiki.gen.ts of typed helpers when types is enabled", async () => {
    const dir = mkdtempSync(join(TMP, "types-"));
    const file = join(dir, "app.kumiki");
    const src = `
      slot count : Int = 0
      effect track cap=telemetry.track in={name: Text} out=Unit
      reducer fire on=ui.click(B) do= emit track({name: "x"})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `;
    writeFileSync(file, src);
    writeFileSync(
      join(dir, "kumiki.caps.json"),
      JSON.stringify({ capabilities: ["telemetry.track"] }),
    );
    await transformOf({ types: true }).call(ctx as never, src, file);
    const genPath = `${file}.gen.ts`;
    expect(existsSync(genPath)).toBe(true);
    const gen = readFileSync(genPath, "utf8");
    expect(gen).toContain("export interface Slots {");
    expect(gen).toContain("count: number;");
    expect(gen).toMatch(/"telemetry\.track"\??: Provider<\{ name: string \}, null>/);
  });
});
