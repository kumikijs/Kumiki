// Issue #71: per-app DCE. With `runtimeModulesDir`, codegen must import only
// the runtime feature modules the app actually uses (tile families, router,
// effect handlers) and mount through `mountCore`; without it, the classic
// single-import monolith shape must survive byte-for-byte semantics (the
// inlining path strips exactly one import line).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COUNTER_PATH = resolve(here, "../../examples/apps/01-counter/app.kumiki");

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
  it("counter imports only core + stdlib + its tile families", () => {
    const r = modular(COUNTER);
    expect(r.js).toContain('import { mountCore } from "./runtime/core.js"');
    expect(r.js).toContain('import { _stdlibCore } from "./runtime/stdlib.js"');
    expect(r.js).toContain('from "./runtime/tiles-layout.js"');
    expect(r.js).toContain('from "./runtime/tiles-text.js"');
    expect(r.js).toContain('from "./runtime/tiles-input.js"');
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
      "tiles-text",
      "tiles-input",
    ]);
    // mounts through the granular core with the assembled registry
    expect(r.js).toContain("const _s = _stdlibCore;");
    expect(r.js).toMatch(/mountCore\(App, document\.getElementById\("root"\), \{ tiles: _tiles/);
  });

  it("a routing app (link + extra route + nav cap) ships the router module", () => {
    const r = modular(ROUTED);
    expect(r.js).toContain('import { routing } from "./runtime/router.js"');
    expect(r.js).toMatch(/mountCore\([\s\S]*\{ tiles: _tiles, routing,/);
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
