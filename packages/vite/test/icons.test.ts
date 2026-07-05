// Vite plugin: when @kumikijs/icons is resolvable from the project, the plugin
// runs a second codegen pass that bakes the referenced SVG paths into the
// emitted module's App.icons (#101).

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kumiki } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TMP = join(here, "test-tmp");
mkdirSync(TMP, { recursive: true });

const ctx = {
  error(e: unknown): never {
    throw new Error(typeof e === "string" ? e : (e as Error).message);
  },
};

function transformFn(opts: Parameters<typeof kumiki>[0] = {}) {
  const plugin = kumiki(opts);
  const t = plugin.transform;
  const fn = typeof t === "function" ? t : t?.handler;
  if (!fn) throw new Error("plugin has no transform hook");
  return fn;
}

const FIXTURE = `
slot _ : Text = ""
tile A = icon(name="check")
tile B = icon(name="alert-triangle") {color: "warning"}
tile Root = column(A, B)
app IconApp
    caps   = []
    routes = {"/" -> Root, "/404" -> Root}
    init   = []
`;

describe("vite-plugin-kumiki icon registry", () => {
  it("bakes referenced @kumikijs/icons paths into the emitted App.icons", async () => {
    const dir = mkdtempSync(join(TMP, "icons-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(file, FIXTURE);
    const out = (await transformFn().call(ctx as never, FIXTURE, file)) as { code: string };
    // The plugin resolves @kumikijs/icons from the workspace, so the well-known
    // Heroicons-solid paths for check + alert-triangle land in the output.
    expect(out.code).toContain("App.icons = {");
    expect(out.code).toMatch(/"check":\s*"[mM][^"]+"/);
    expect(out.code).toMatch(/"alert-triangle":\s*"[mM][^"]+"/);
    // Unreferenced names are not baked.
    expect(out.code).not.toContain("x-circle");
    expect(out.code).not.toContain("paperclip");
  });
});

// `{ strictIcons: true }` opts the plugin into the E0704 diagnostic so
// unknown literal icon names surface in Vite's error overlay at dev time.
describe("vite-plugin-kumiki strict-icons", () => {
  const UNKNOWN = `
slot _ : Text = ""
tile Bad = icon(name="cheque")
tile Root = column(Bad)
app StrictIcons
    caps   = []
    routes = {"/" -> Root, "/404" -> Root}
    init   = []
`;

  it("passes silently without strictIcons (default behavior)", async () => {
    const dir = mkdtempSync(join(TMP, "strict-icons-off-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(file, UNKNOWN);
    const out = (await transformFn().call(ctx as never, UNKNOWN, file)) as { code: string };
    // The unknown literal makes it through codegen — the runtime renders the
    // `[cheque]` placeholder rather than blocking compile.
    expect(out.code).toContain("cheque");
  });

  it("raises an E0704 error when strictIcons is on", async () => {
    const dir = mkdtempSync(join(TMP, "strict-icons-on-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(file, UNKNOWN);
    await expect(
      transformFn({ strictIcons: true }).call(ctx as never, UNKNOWN, file),
    ).rejects.toThrow(/E0704/);
  });

  it("accepts a built-in name from @kumikijs/icons when strictIcons is on", async () => {
    const dir = mkdtempSync(join(TMP, "strict-icons-builtin-"));
    const file = join(dir, "app.kumiki");
    const src = `
slot _ : Text = ""
tile Good = icon(name="check")
tile Root = column(Good)
app StrictOK caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
`;
    writeFileSync(file, src);
    const out = (await transformFn({ strictIcons: true }).call(ctx as never, src, file)) as {
      code: string;
    };
    // First pass passed check + codegen, second pass baked the registry entry.
    expect(out.code).toMatch(/"check":\s*"[mM][^"]+"/);
  });

  it("accepts a custom name declared in theme.icons when strictIcons is on", async () => {
    const dir = mkdtempSync(join(TMP, "strict-icons-themed-"));
    const file = join(dir, "app.kumiki");
    const src = `
slot _ : Text = ""
tile Good = icon(name="logo")
tile Root = column(Good)
theme Light = { icons: { logo: "M3 3h18v18H3z" } }
app StrictThemed caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
`;
    writeFileSync(file, src);
    const out = (await transformFn({ strictIcons: true }).call(ctx as never, src, file)) as {
      code: string;
    };
    // `logo` isn't in @kumikijs/icons but is in theme.icons — accepted, and
    // the runtime renders via the theme override.
    expect(out.code).toContain("logo");
  });
});

// #149 — `{ strictSelectorId: true }` opts the plugin into the E0212
// diagnostic so a `Tile#id` selector whose id cannot match the tile's literal
// `{id: "..."}` prop surfaces in Vite's error overlay at dev time. Parity
// with strict-icons / strict-a11y (#127, §10.7).
describe("vite-plugin-kumiki strict-selector-id", () => {
  const MISMATCH = `
slot x : Int = 0
reducer add on=ui.submit(NewForm#nw) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile Root = column(NewForm)
app StrictSelId
    caps   = []
    routes = {"/" -> Root, "/404" -> Root}
    init   = []
`;

  it("passes silently without strictSelectorId (default behavior)", async () => {
    const dir = mkdtempSync(join(TMP, "strict-selid-off-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(file, MISMATCH);
    // The runtime `_dispatch` filter is authoritative by default; codegen
    // succeeds and ships the reducer even though `#nw` never matches.
    const out = (await transformFn().call(ctx as never, MISMATCH, file)) as { code: string };
    expect(out.code).toContain("NewForm");
  });

  it("raises an E0212 error when strictSelectorId is on", async () => {
    const dir = mkdtempSync(join(TMP, "strict-selid-on-"));
    const file = join(dir, "app.kumiki");
    writeFileSync(file, MISMATCH);
    await expect(
      transformFn({ strictSelectorId: true }).call(ctx as never, MISMATCH, file),
    ).rejects.toThrow(/E0212/);
  });

  it("accepts a matching literal id when strictSelectorId is on", async () => {
    const dir = mkdtempSync(join(TMP, "strict-selid-ok-"));
    const file = join(dir, "app.kumiki");
    const src = `
slot x : Int = 0
reducer add on=ui.submit(NewForm#new) do= x := x + 1
tile NewForm = form(text="a") {id: "new"}
tile Root = column(NewForm)
app StrictSelIdOk caps=[] routes={"/" -> Root, "/404" -> Root} init=[]
`;
    writeFileSync(file, src);
    const out = (await transformFn({ strictSelectorId: true }).call(ctx as never, src, file)) as {
      code: string;
    };
    expect(out.code).toContain("NewForm");
  });
});
