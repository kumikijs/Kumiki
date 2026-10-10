import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { compileOrFail } from "./helpers/module.ts";

describe("stable tile identity (key)", () => {
  function findWkForBoundary(
    js: string,
    boundaryName: string,
  ): Array<{ payload: string; key: string }> {
    const marker = `"${boundaryName}"`;
    const results: Array<{ payload: string; key: string }> = [];
    for (let i = 0; i < js.length; i++) {
      if (!js.startsWith("_wk(", i)) continue;
      // Walk to the matching close paren of the _wk( call.
      let depth = 1;
      let j = i + 4;
      const start = j;
      for (; j < js.length && depth > 0; j++) {
        const c = js[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        if (depth === 0) break;
      }
      const args = js.slice(start, j);
      // Split at the top-level comma (depth 0) between payload and key.
      let d = 0;
      let splitAt = -1;
      for (let k = 0; k < args.length; k++) {
        const c = args[k];
        if (c === "(") d++;
        else if (c === ")") d--;
        else if (c === "," && d === 0) {
          splitAt = k;
          break;
        }
      }
      if (splitAt === -1) continue;
      const payload = args.slice(0, splitAt).trim();
      const key = args.slice(splitAt + 1).trim();
      let directNamedName: string | null = null;
      // Strip a leading error-boundary IIFE if present: `((() => { try { return _named(...)...`
      let scan = payload;
      const iifeMatch = scan.match(/^\(\(\(\)\s*=>\s*\{\s*try\s*\{\s*return\s+/);
      if (iifeMatch) scan = scan.slice(iifeMatch[0].length);
      if (scan.startsWith("_named(")) {
        // Walk to the matching close paren of _named(
        let dd = 1;
        let k = "_named(".length;
        const s2 = k;
        for (; k < scan.length && dd > 0; k++) {
          const c = scan[k];
          if (c === "(") dd++;
          else if (c === ")") dd--;
          if (dd === 0) break;
        }
        const namedArgs = scan.slice(s2, k);
        // Split at top-level comma to isolate the boundary name (second arg).
        let d2 = 0;
        let split2 = -1;
        for (let p = 0; p < namedArgs.length; p++) {
          const c = namedArgs[p];
          if (c === "(") d2++;
          else if (c === ")") d2--;
          else if (c === "," && d2 === 0) {
            split2 = p;
            break;
          }
        }
        if (split2 !== -1) directNamedName = namedArgs.slice(split2 + 1).trim();
      }
      if (directNamedName === marker) {
        results.push({ payload, key });
      }
    }
    return results;
  }

  function implicitKeyOf(js: string, bind: string): string {
    const m = new RegExp(`\\.map\\(\\(${bind}, (__fi\\w+)\\) =>`).exec(js);
    if (!m) throw new Error(`no for over ${bind} in the emitted JS`);
    const index = m[1] as string;
    return `${index.replace("__fi", "__fk")}[${index}]`;
  }

  it("lifts an explicit {key: expr} on a builtin tile call to a top-level `key` field", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      tile Row = text("row")
      tile App = column(for x in xs Row {key: x.show})
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    const wraps = findWkForBoundary(js, "Row");
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) expect(w.key).toContain("_s.show(x)");
    expect(js).not.toMatch(/el:\s*\{[^}]*key:/);
  });

  it("synthesizes an implicit key from the loop variable when the tile-for body omits {key: ...}", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      tile Row = text("row")
      tile App = column(for x in xs Row)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    const wraps = findWkForBoundary(js, "Row");
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) expect(w.key).toBe(implicitKeyOf(js, "x"));
  });

  it("does not synthesize an implicit key outside of a for iteration", () => {
    const src = `
      tile Row = text("row")
      tile App = column(Row)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    // The Row call inside App must not be wrapped in _wk.
    expect(findWkForBoundary(js, "Row").length).toBe(0);
  });

  it("nested for-iteration uses the innermost loop variable for the implicit key", () => {
    const src = `
      slot outer : List(Int) = [1]
      slot inner : List(Int) = [2]
      tile Cell = text("c")
      tile App = column(for o in outer row(for i in inner Cell))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    const wraps = findWkForBoundary(js, "Cell");
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) {
      expect(w.key).toBe(implicitKeyOf(js, "i"));
      expect(w.key).not.toBe(implicitKeyOf(js, "o"));
    }
  });

  it("propagates the implicit key through TileWhen (for x in xs when(cond, Row))", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      tile Row = text("row")
      tile App = column(for x in xs when(x > 0, Row))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    const wraps = findWkForBoundary(js, "Row");
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) expect(w.key).toBe(implicitKeyOf(js, "x"));
  });

  it("propagates the implicit key through TileMatch (for id in ids match kind with |A -> Row)", () => {
    const src = `
      type Kind = A | B
      slot kind : Kind = A
      slot ids : List(Int) = [1, 2, 3]
      tile Row = text("row")
      tile App = column(for id in ids match kind with |A -> Row |B -> Row)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    const wraps = findWkForBoundary(js, "Row");
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) expect(w.key).toBe(implicitKeyOf(js, "id"));
  });

  it("resets the implicit key at user-tile boundaries (inner for uses its own loop var)", () => {
    const src = `
      slot outer : List(Int) = [1]
      slot inner : List(Int) = [2, 3]
      tile Cell = text("c")
      tile Inner = column(for i in inner Cell)
      tile Outer = column(Inner)
      tile App = column(for o in outer Outer)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    // The Outer boundary itself is the target of the outer for → key = o.
    const outerWraps = findWkForBoundary(js, "Outer");
    expect(outerWraps.length).toBeGreaterThan(0);
    for (const w of outerWraps) expect(w.key).toBe(implicitKeyOf(js, "o"));
    const cellWraps = findWkForBoundary(js, "Cell");
    expect(cellWraps.length).toBeGreaterThan(0);
    for (const w of cellWraps) {
      expect(w.key).toBe(implicitKeyOf(js, "i"));
      expect(w.key).not.toBe(implicitKeyOf(js, "o"));
    }
  });

  function loopNamesIn(js: string): string[] {
    const names = Array.from(js.matchAll(/_s\.loopKeys\(__xs, ("[^"]*")\)/g), (m) =>
      JSON.parse(m[1] as string),
    );
    return [...new Set(names)];
  }

  it("names a loop by its tile and its ordinal there, so an edit above it keeps every key", () => {
    const tiles = `
      tile Row = text("row")
      tile App = column(for x in xs Row, for y in xs when(y > 1, Row))`;
    const program = (above: string) => `
      slot xs : List(Int) = [1, 2, 3]
      ${above}${tiles}
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const named = (src: string): string[] => {
      const result = compile(src, { runtimeSpecifier: "./runtime.js" });
      if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
      return loopNamesIn(result.js);
    };
    const before = named(program(""));
    expect(before).toEqual(["App_0", "App_1"]);
    expect(named(program('\n\n\n        tile Other = text("other")\n'))).toEqual(before);
  });

  it("computes no implicit keys for a loop whose every tile call has its own key", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      tile App = column(for x in xs text(x.show) {key: x.show}, for y in xs text(y.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const js = compileOrFail(src);
    // Only the second loop, whose `text` has no key, reads an implicit one.
    expect(loopNamesIn(js)).toEqual(["App_1"]);
  });
});
