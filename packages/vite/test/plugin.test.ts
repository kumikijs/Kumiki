import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, feature } from "@kumikijs/examples";
import type { AppShape } from "@kumikijs/runtime";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { APP_A, TMP, throwingCtx, transformCode, transformOf } from "./helpers/plugin.ts";

const COUNTER = app("01-counter");
const CUSTOM_CAP = feature("27-custom-capability");
const COUNTER_SRC = readFileSync(COUNTER, "utf8");

async function importModule<T>(code: string, prefix: string): Promise<T> {
  const path = join(mkdtempSync(join(TMP, `${prefix}-`)), "app.mjs");
  writeFileSync(path, code);
  return (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)) as T;
}

describe("vite-plugin-kumiki", () => {
  it("compiles a .kumiki file to a default-exported, self-contained module (bundle)", async () => {
    const code = await transformCode(COUNTER_SRC, COUNTER, { bundle: true });
    expect(code).toContain("export default App;");
    expect(code).not.toMatch(/^import \{[^}]*\} from "@kumikijs\/runtime"/m);
    const { default: app } = await importModule<{ default: AppShape }>(code, "mod");
    expect(app.slots).toHaveProperty("count");
    expect(Array.isArray(app.reducers)).toBe(true);
    expect(typeof app.effects).toBe("object");
  });

  it("exports a createApp factory yielding independent instances", async () => {
    const code = await transformCode(COUNTER_SRC, COUNTER);
    expect(code).toContain("export { createApp };");
    const { createApp } = await importModule<{ createApp: () => AppShape }>(code, "factory");
    expect(createApp().live).not.toBe(createApp().live);
  });

  it("ignores non-.kumiki ids", async () => {
    expect(
      await transformOf().call(throwingCtx() as never, "const x = 1;", "/abs/foo.ts"),
    ).toBeNull();
  });

  it.each([
    "import",
    "t=1700000000000",
    "worker_file&type=module",
    "import&v=abc123",
    "inline",
    "no-inline",
    "raw=1",
    "url=x",
  ])("compiles an id whose query `?%s` still names the module itself", async (query) => {
    expect(await transformCode(COUNTER_SRC, `${COUNTER}?${query}`)).toContain(
      "export default App;",
    );
  });

  it.each([
    "raw",
    "url",
    "url&inline",
    "url&no-inline",
    "import&raw",
    "worker",
    "sharedworker",
  ])("leaves Vite's own `?%s` import to Vite", async (query) => {
    const asJs = `export default ${JSON.stringify("text")}`;
    expect(
      await transformOf().call(throwingCtx() as never, asJs, `${COUNTER}?${query}`),
    ).toBeNull();
  });

  it("resolves project capabilities from a sibling kumiki.caps.json", async () => {
    const code = await transformCode(readFileSync(CUSTOM_CAP, "utf8"), CUSTOM_CAP);
    expect(code).toContain("export default App;");
    const { default: app } = await importModule<{ default: AppShape }>(code, "mod");
    expect(app.caps).toContain("telemetry.track");
  });

  it("reports a compile error through ctx.error", async () => {
    const bad = `app A caps=[] routes={"/" -> Missing, "/404" -> Missing} init=[]`;
    await expect(transformCode(bad, "/abs/bad.kumiki")).rejects.toThrow(/Kumiki compile failed/);
  });

  it("surfaces W0212 ui-event-tile-mismatch through this.warn with source loc", async () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(Card) do= f := "x"
      tile Card = box(text("hi"))
      tile App = column(Card)
      ${APP_A}
    `;
    const warnings: unknown[] = [];
    const file = "/abs/warn.kumiki";
    expect(await transformCode(src, file, {}, warnings)).toContain("export default App;");
    expect(warnings).toEqual([
      {
        message: expect.stringContaining("W0212") as string,
        loc: { file, line: 3, column: 29 },
      },
    ]);
  });

  it("emits W0212 via this.warn before this.error when a compile failure co-occurs", async () => {
    const src = `
      slot f : Text = ""
      reducer recordFocus on=ui.focus(Card) do= emit nope({})
      tile Card = box(text("hi"))
      tile App = column(Card)
      ${APP_A}
    `;
    const warnings: unknown[] = [];
    await expect(transformCode(src, "/abs/fail-warn.kumiki", {}, warnings)).rejects.toThrow(
      /Kumiki compile failed/,
    );
    expect(warnings).toEqual([
      { message: expect.stringContaining("W0212"), loc: expect.anything() },
    ]);
  });

  it("emits a sibling <name>.kumiki.gen.ts of typed helpers when types is enabled", {
    timeout: 30_000,
  }, async () => {
    const dir = mkdtempSync(join(TMP, "types-"));
    const file = join(dir, "app.kumiki");
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
    await transformCode(src, file, { types: true });
    const genPath = `${file}.gen.ts`;
    expect(existsSync(genPath)).toBe(true);
    const gen = readFileSync(genPath, "utf8");
    expect(gen).toContain("export interface KumikiSlots {");
    expect(gen).toContain("count: number;");
    expect(gen).toContain('"last-error": string;');
    expect(gen).toMatch(/"telemetry\.track"\??: KumikiProvider<\{ name: string \}, null>/);
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

  it("leaves an unchanged .kumiki.gen.ts untouched so the watcher is not retriggered", async () => {
    const dir = mkdtempSync(join(TMP, "types-"));
    const file = join(dir, "app.kumiki");
    const src = `slot count : Int = 0
tile App = text(count.show)
${APP_A}
`;
    writeFileSync(file, src);
    await transformCode(src, file, { types: true });
    const genPath = `${file}.gen.ts`;
    const past = new Date(Date.now() - 60_000);
    utimesSync(genPath, past, past);
    const before = statSync(genPath).mtimeMs;
    await transformCode(src, file, { types: true });
    expect(statSync(genPath).mtimeMs).toBe(before);
  });
});
