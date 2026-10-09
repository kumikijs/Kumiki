import { readFileSync } from "node:fs";
import { compile } from "@kumikijs/compiler";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

const COUNTER_PATH = app("01-counter");

const COUNTER = readFileSync(COUNTER_PATH, "utf8");

const ROUTED = `
slot n : Int = 0
tile Home = column(link(to="/about", text="go"))
tile About = column(text("about"))
app A caps=[nav.push] routes={"/" -> Home, "/about" -> About, "/404" -> Home} init=[]
`;

const STORED = `
slot v : Text = ""
effect save cap=storage.write in={key: Text, value: Text} out=Unit
reducer go on=ui.click(B) do= emit save({key: "k", value: v})
tile B = button(text="save")
tile App = column(B)
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
`;

const SESSIONED = `
slot v : Text = ""
effect save cap=session.write in={key: Text, value: Text} out=Unit
reducer go on=ui.click(B) do= emit save({key: "k", value: v})
tile B = button(text="save")
tile App = column(B)
app A caps=[session.write] routes={"/" -> App, "/404" -> App} init=[]
`;

function modular(src: string) {
  const result = compile(src, { runtimeSpecifier: "unused", runtimeModulesDir: "./runtime" });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("compile failed");
  return result;
}

describe("modular runtime emission (#71)", () => {
  it("counter imports only core + stdlib + the tiles it renders", () => {
    const r = modular(COUNTER);
    expect(r.js).toContain('import { mountCore } from "./runtime/core.js"');
    expect(r.js).toContain('import { _stdlibCore } from "./runtime/stdlib.js"');
    expect(r.js).toContain('from "./runtime/tiles-layout.js"');
    expect(r.js).toContain('from "./runtime/tiles-text-heading.js"');
    expect(r.js).toContain('from "./runtime/tiles-input-button.js"');
    for (const unused of ["tiles-text-link", "tiles-text-icon", "tiles-input-select"]) {
      expect(r.js, `${unused} should not ship`).not.toContain(unused);
    }
    // counter neither routes nor uses effects/collections/overlays — none ship
    expect(r.js).not.toContain("router.js");
    expect(r.js).not.toContain("effects-");
    expect(r.js).not.toContain("tiles-collection.js");
    expect(r.js).not.toContain("tiles-overlay.js");
    expect(r.js).not.toContain("testkit.js");
    expect(r.runtimeModules).toEqual([
      "core",
      "stdlib",
      "tiles-layout",
      "tiles-input-button",
      "tiles-text-heading",
      "tiles-input-shared",
    ]);
    // mounts through the granular core with the assembled registry
    expect(r.js).toContain("const _s = _stdlibCore;");
    expect(r.js).toMatch(/mountCore\(App, document\.getElementById\("root"\), \{ tiles: _tiles/);
  });

  it("assembles the patcher registry alongside the renderers", () => {
    const r = modular(COUNTER);
    expect(r.js).toContain(
      'import { layoutTiles, layoutPatchers } from "./runtime/tiles-layout.js"',
    );
    expect(r.js).toContain(
      'import { headingTile, headingPatcher } from "./runtime/tiles-text-heading.js"',
    );
    // A whole family spreads in; a per-tile module lands under its own kind.
    expect(r.js).toContain(
      "const _patchers = { ...layoutPatchers, button: buttonPatcher, heading: headingPatcher };",
    );
    expect(r.js).toContain("tilePatchers: _patchers");
  });

  it("a routing app (link + extra route + nav cap) ships the router module", () => {
    const r = modular(ROUTED);
    expect(r.js).toContain('import { routing } from "./runtime/router.js"');
    expect(r.js).toMatch(/mountCore\([\s\S]*\{ tiles: _tiles, tilePatchers: _patchers, routing,/);
    expect(r.runtimeModules).toContain("router");
  });

  it("a storage app ships effects-storage (and only the handlers it uses)", () => {
    const r = modular(STORED);
    expect(r.js).toContain('import { storageWrite } from "./runtime/effects-storage.js"');
    expect(r.js).not.toContain("storageRead");
    expect(r.js).not.toContain("sessionRead");
    expect(r.js).not.toContain("sessionWrite");
    expect(r.js).not.toContain("effects-http.js");
    expect(r.runtimeModules).toContain("effects-storage");
  });

  it("a session app ships sessionWrite from the same effects-storage module (#84)", () => {
    const r = modular(SESSIONED);
    expect(r.js).toContain('import { sessionWrite } from "./runtime/effects-storage.js"');
    expect(r.js).not.toContain("sessionRead");
    expect(r.js).not.toContain("storageRead");
    expect(r.js).not.toContain("storageWrite");
    expect(r.runtimeModules).toContain("effects-storage");
  });

  const clearing = (cap: string, decl: string) => `
type Nothing = Unit
effect wipe cap=${cap} ${decl} out=Result(Unit, Text)
reducer go on=ui.click(B) do= emit wipe()
tile B = button(text="wipe")
tile App = column(B)
app A caps=[${cap}] routes={"/" -> App, "/404" -> App} init=[]
`;

  for (const [cap, clear, write] of [
    ["storage.write", "storageClear", "storageWrite"],
    ["session.write", "sessionClear", "sessionWrite"],
  ] as const) {
    it(`an in=Unit ${cap} with no map-request calls ${clear} and ships only it`, () => {
      for (const decl of ["in=Unit", "in=Nothing"]) {
        const r = modular(clearing(cap, decl));
        expect(r.js).toContain(`import { ${clear} } from "./runtime/effects-storage.js"`);
        expect(r.js).toContain(`: ${clear}());`);
        expect(r.js).not.toContain(write);
      }
    });

    it(`an in=Unit ${cap} WITH a map-request stays a ${write}`, () => {
      const r = modular(clearing(cap, `in=Unit map-request={key: "k"}`));
      expect(r.js).toContain(`import { ${write} } from "./runtime/effects-storage.js"`);
      expect(r.js).not.toContain(clear);
    });
  }

  it("monolith mode pulls storageClear through the one import", () => {
    const result = compile(clearing("storage.write", "in=Unit"), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const importLines = result.js.split("\n").filter((l) => l.startsWith("import "));
    expect(importLines).toEqual(['import { mount, _stdlib, storageClear } from "./runtime.js";']);
  });

  it("monolith mode keeps the single-import shape for the inlining path", () => {
    const result = compile(COUNTER, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const importLines = result.js.split("\n").filter((l) => l.startsWith("import "));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toBe('import { mount, _stdlib } from "./runtime.js";');
  });

  it("monolith mode pulls the bare effect handler names through the one import", () => {
    const result = compile(STORED, { runtimeSpecifier: "./runtime.js" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const importLines = result.js.split("\n").filter((l) => l.startsWith("import "));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toBe('import { mount, _stdlib, storageWrite } from "./runtime.js";');
  });

  it("rejects bundle: true combined with runtimeModulesDir", () => {
    expect(() =>
      compile(COUNTER, {
        runtimeSpecifier: "x",
        runtimeModulesDir: "./runtime",
        bundle: true,
        readRuntimeBundle: () => "",
      }),
    ).toThrow(/mutually exclusive/);
  });
});
