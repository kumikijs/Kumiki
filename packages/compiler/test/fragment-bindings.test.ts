import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const diagnostics = (defs: string, rhs: string, resType: string, init = "[]") =>
  check(
    parse(
      lex(`${defs}
slot res : ${resType} = ${init}
reducer act on=ui.click(Btn)
    do= res := ${rhs}
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`),
    ),
  ).map((e) => `${e.code} ${e.message}`);

/** The `fragmentShape` the checker recorded on every `.method(…)` call in `node`. */
function shapesOf(node: unknown, method: string): unknown[] {
  if (Array.isArray(node)) return node.flatMap((n) => shapesOf(n, method));
  if (node === null || typeof node !== "object") return [];
  const own =
    "kind" in node && node.kind === "MethodCall" && "method" in node && node.method === method
      ? ["fragmentShape" in node ? node.fragmentShape : undefined]
      : [];
  return [...own, ...Object.values(node).flatMap((v) => shapesOf(v, method))];
}

const LOUD = `fn loud(t: Text) -> Text = t + "!"`;

describe("$1 is the element a List hands its fragment", () => {
  it("binds an element that is itself a List whole", () => {
    const defs = `${LOUD}\nslot xss : List(List(Int)) = []`;
    expect(diagnostics(defs, "xss.map(loud($1))", "List(Text)")).toEqual([
      "E0201 Expected Text but got List(Int)",
    ]);
  });

  it("reports an element passed where the fn wants another type", () => {
    const defs = `${LOUD}\nslot xs : List(Int) = [1, 2]`;
    expect(diagnostics(defs, "xs.map(loud($1))", "List(Text)")).toEqual([
      "E0201 Expected Text but got Int",
    ]);
  });

  it("accepts an element of the type the fn wants", () => {
    const defs = `${LOUD}\nslot xs : List(Text) = ["a"]`;
    expect(diagnostics(defs, "xs.map(loud($1))", "List(Text)")).toEqual([]);
  });

  it("binds the element to $2 of fold, and leaves the accumulator open", () => {
    const defs = `${LOUD}\nslot xs : List(Int) = [1, 2]`;
    expect(diagnostics(defs, `xs.fold("", loud($2))`, "Text", '""')).toEqual([
      "E0201 Expected Text but got Int",
    ]);
    expect(diagnostics(defs, "xs.fold(0, $1 + $2)", "Int", "0")).toEqual([]);
  });
});

describe("$1 / $2 are a Map's key and value, and the halves of an entry", () => {
  const KEEP = (k: string) => `fn keep(k: ${k}, v: Int) -> Bool = v > 0`;

  it("accepts a predicate over the key and value types", () => {
    const defs = `${KEEP("Text")}\nslot m : Map(Text, Int) = {}`;
    expect(diagnostics(defs, "m.filter(keep($1, $2))", "Map(Text, Int)", "{}")).toEqual([]);
  });

  it("reports a predicate whose key parameter is not the key type", () => {
    const defs = `${KEEP("Int")}\nslot m : Map(Text, Int) = {}`;
    expect(diagnostics(defs, "m.filter(keep($1, $2))", "Map(Text, Int)", "{}")).toEqual([
      "E0201 Expected Int but got Text",
    ]);
  });

  it("binds the key and value of Map.map's expression", () => {
    const defs = `fn label(k: Int, v: Text) -> Text = v\nslot m : Map(Text, Text) = {}`;
    expect(diagnostics(defs, "m.map(label($1, $2))", "Map(Text, Text)", "{}")).toEqual([
      "E0201 Expected Int but got Text",
    ]);
  });

  it("records Map.map's fragment as handed the key and the value", () => {
    const ast = parse(
      lex(`slot m : Map(Int, Int) = {}
slot res : Map(Int, Int) = {}
reducer act on=ui.click(Btn)
    do= res := m.map($1 * 10 + $2)
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`),
    );
    expect(check(ast)).toEqual([]);
    expect(shapesOf(ast, "map")).toEqual(["key-value"]);
  });

  it("takes an entry apart the way the lowering does", () => {
    const defs = `${KEEP("Int")}\nslot m : Map(Text, Int) = {}`;
    expect(diagnostics(defs, "m.entries.filter(keep($1, $2))", "List(Tuple(Text, Int))")).toEqual([
      "E0201 Expected Int but got Text",
    ]);
  });
});

describe("where the lowering's reading is not certain, nothing is bound", () => {
  it("a receiver whose type is not decided", () => {
    const defs = `${LOUD}\nfn anything(n: Int) = [n]`;
    expect(diagnostics(defs, "anything(1).map(loud($1))", "List(Text)")).not.toContain(
      "E0201 Expected Text but got Int",
    );
  });
});
