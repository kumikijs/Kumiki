import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AppShape } from "@kumikijs/runtime";
import ts from "typescript";
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
    const code = await runTransform(COUNTER, { bundle: true });
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

  it("keeps the runtime as an external import by default", async () => {
    const code = await runTransform(COUNTER);
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

  it("threads strictA11y into compile so a11y warnings become transform errors (§10.7)", async () => {
    const bad = `
      tile App = button()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const file = "/abs/a11y.kumiki";
    // Lax: a11y warning is filtered, transform succeeds.
    const lax = (await transformOf().call(ctx as never, bad, file)) as { code: string };
    expect(lax.code).toContain("export default App;");
    // Strict: same source is rejected with the E0701 message.
    await expect(transformOf({ strictA11y: true }).call(ctx as never, bad, file)).rejects.toThrow(
      /E0701/,
    );
  });

  it("surfaces W0212 ui-event-tile-mismatch through this.warn with source loc (#143)", async () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(Card) do= f := "x"
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const warnings: unknown[] = [];
    const warnCtx = {
      error(e: unknown): never {
        throw new Error(typeof e === "string" ? e : (e as Error).message);
      },
      warn(w: unknown): void {
        warnings.push(w);
      },
    };
    const file = "/abs/warn.kumiki";
    const out = (await transformOf().call(warnCtx as never, src, file)) as {
      code: string;
    };
    expect(out.code).toContain("export default App;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      message: expect.stringContaining("W0212") as string,
      loc: {
        file,
        // The selector `ui.focus(Card)` sits on the `reducer recordFocus`
        // line — 3rd source line counting the leading newline in the
        // template literal. Pin both fields so a regression in `pos`
        // threading (e.g. dropping `loc.column`) is caught.
        line: expect.any(Number) as number,
        column: expect.any(Number) as number,
      },
    });
    const loc = (warnings[0] as { loc?: { file: string; line: number; column: number } }).loc;
    expect(loc?.file).toBe(file);
    expect(loc?.line).toBeGreaterThan(0);
    expect(loc?.column).toBeGreaterThan(0);
  });

  it("emits W0212 via this.warn BEFORE this.error when a compile fail co-occurs (#143)", async () => {
    // The same source carries a W0212 (ui.focus on box) AND a fatal error
    // (undefined effect in `emit`). The warning must reach `this.warn`
    // even though `this.error` then throws — otherwise diagnostics
    // detected in the same check pass would be silently dropped on the
    // error path.
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(Card) do= emit nope({})
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const warnings: unknown[] = [];
    const failCtx = {
      error(e: unknown): never {
        throw new Error(typeof e === "string" ? e : (e as Error).message);
      },
      warn(w: unknown): void {
        warnings.push(w);
      },
    };
    await expect(
      transformOf().call(failCtx as never, src, "/abs/fail-warn.kumiki"),
    ).rejects.toThrow(/Kumiki compile failed/);
    expect(warnings).toHaveLength(1);
    const w = warnings[0] as { message: string };
    expect(w.message).toContain("W0212");
  });

  // Runs a whole TypeScript program over the generated file, which is far
  // heavier than the rest of this suite and past Vitest's 5 s default when the
  // machine is loaded.
  it("emits a sibling <name>.kumiki.gen.ts of typed helpers when types is enabled", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(TMP, "types-"));
    const file = join(dir, "app.kumiki");
    // A slot named the way Kumiki allows and TypeScript does not, next to a
    // user type named after one of the generated helpers: this file is written
    // into the user's project, so it has to survive their `tsc`.
    const src = `
      slot count : Int = 0
      slot last-error : Text = ""
      type Slots = { seen: Int }
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
    expect(gen).toContain("export interface KumikiSlots {");
    expect(gen).toContain("count: number;");
    expect(gen).toContain('"last-error": string;');
    expect(gen).toMatch(/"telemetry\.track"\??: KumikiProvider<\{ name: string \}, null>/);
    // The generated declaration is only useful if the project it lands in
    // still compiles.
    const program = ts.createProgram([genPath], {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    expect(diagnostics).toEqual([]);
  });
});
