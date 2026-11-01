import { describe, expect, it } from "vitest";
import { compileOrFail, loadApp } from "./helpers/module.ts";
import { withRoot } from "./helpers/programs.ts";

/** Each line of `js` that declares or fills a shape. */
const shapeLines = (js: string): string[] =>
  js.split("\n").filter((line) => /^(const|Object\.assign\()\s*_show\d/.test(line));

/** The shapes the generated module for `src` declares, built as the module builds them. */
function declaredShapes(src: string): { js: string; shapes: Record<string, unknown> } {
  const js = compileOrFail(src);
  const lines = shapeLines(js);
  const names = [...lines.join("\n").matchAll(/const (_show\d+)/g)].map((m) => m[1]);
  const shapes = new Function(`${lines.join("\n")}\nreturn { ${names.join(", ")} };`)();
  return { js, shapes };
}

/** The name a show site passes for the value read from slot `slot`. */
function shapeAt(js: string, slot: string): string | undefined {
  return new RegExp(`_s\\.show\\(_live\\["${slot}"\\], (_show\\d+)\\)`).exec(js)?.[1];
}

describe("a shape is declared once in the app and named where a value is shown", () => {
  it("declares one shape for two sites that show the same type", () => {
    const { js } = declaredShapes(
      withRoot(
        'text("a: " + m), text("b: " + m.show), text(fmt("{0}", m))',
        "slot m : Map(Text, Int) = {}",
      ),
    );
    expect(shapeLines(js)).toEqual(['const _show0 = ["m",0,0,0];']);
    // Each route that renders `App` writes the three sites again.
    const sites = js.match(/_s\.show\(_live\["m"\][^)]*\)/g) ?? [];
    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sites)).toEqual(new Set(['_s.show(_live["m"], _show0)']));
  });

  it("builds a type that contains itself through a List once, referring back to itself", () => {
    const { js, shapes } = declaredShapes(
      withRoot(
        'text("f: " + f)',
        `type Tree = {label: Text, kids: Forest, marks: Set(Int)}
type Forest = List(Tree)
slot f : Forest = []`,
      ),
    );
    const name = shapeAt(js, "f") ?? "";
    const forest = shapes[name] as ["l", { kids: unknown; marks: unknown }];
    expect(forest[0]).toBe("l");
    expect(forest[1].kids).toBe(forest);
    expect(forest[1].marks).toEqual(["s", "number", 0]);
  });

  it("declares both types of a mutual recursion that each reach again, each naming the other", () => {
    const { js, shapes } = declaredShapes(
      withRoot(
        'text("a: " + a)',
        `type A = {bs: List(B), m: Map(Text, Int)}
type B = {as: List(A), next: List(B), s: Set(Int)}
slot a : A = {bs: [], m: {}}`,
      ),
    );
    const lines = shapeLines(js);
    expect(lines.join("\n").match(/const _show\d+ = /g)).toHaveLength(2);
    const a = shapes[shapeAt(js, "a") ?? ""] as { bs: ["l", { as: unknown; next: unknown }] };
    const b = a.bs[1];
    expect(b.as).toEqual(["l", a]);
    expect((b.as as unknown[])[1]).toBe(a);
    expect((b.next as unknown[])[1]).toBe(b);
    expect(Object.values(shapes)).toEqual(expect.arrayContaining([a, b]));
  });

  it("names the recursion once where only one type is reached again", () => {
    const { js, shapes } = declaredShapes(
      withRoot(
        'text("a: " + a)',
        `type A = {bs: List(B), m: Map(Text, Int)}
type B = {as: List(A), s: Set(Int)}
slot a : A = {bs: [], m: {}}`,
      ),
    );
    const a = shapes[shapeAt(js, "a") ?? ""] as { bs: ["l", { as: ["l", unknown] }] };
    expect(a.bs[1].as[1]).toBe(a);
  });

  it("leaves a value with no shape to read as itself, a number `+` included", () => {
    const js = compileOrFail(withRoot('text("n=" + n), text((n + 1).show)', "slot n : Int = 1"));
    expect(shapeLines(js)).toEqual([]);
    expect(js).toContain('_s.show(_s.add("n=", _live["n"]))');
    expect(js).toContain('_s.show(_s.add(_live["n"], 1))');
  });

  it("shows through the declared shapes when the app runs", async () => {
    type Node = { text?: string; children?: Node[] };
    const app = await loadApp<{ routes: { tile: () => Node }[] }>(
      withRoot(
        'text("t: " + t), text("u: " + t)',
        `type Tree = {label: Text, kids: List(Tree), marks: Set(Int)}
slot t : Tree = {label: "a", kids: [{label: "b", kids: [], marks: [2]}], marks: [1]}`,
      ),
    );
    const texts = (app.routes[0]?.tile().children ?? []).map((c) => c.text);
    const shown = '{label: "a", kids: [{label: "b", kids: [], marks: [2]}], marks: [1]}';
    expect(texts).toEqual([`t: ${shown}`, `u: ${shown}`]);
  });
});
