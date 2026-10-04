// Inside a fragment argument — `xs.map(…)`, `m.filter(…)` — `$1` / `$2` are
// bound to what the lowering hands the fragment, read off the receiver's type
// (stdlib.md §2.2, language.md §1.8.6): the element of a `List` or `Option`,
// the two halves of a `.entries` tuple, a Map's key and value, `fold`'s
// accumulator (of the init's type) and element. A positional bound with no
// type decides nothing read through it: `rs.map($1.ids.to-list)` over an
// untyped `$1` reads a `Set(Int)`'s keys back as strings.
//
// Bound, they are checked like any other value, and a `fn` named as the
// fragment is checked as the call it stands for. Where the lowering's reading
// is not certain the name stays untyped, because a wrong guess reports a
// working program.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { FRAGMENT_ARGUMENTS } from "../src/codegen/expr.ts";

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
  // The lowering binds from the element type, not from the value's length, so
  // an element that is a `List` is `$1` whole — two items or not.
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

  it("binds the element to $2 of fold, and the accumulator to the init's type", () => {
    const defs = `${LOUD}\nslot xs : List(Int) = [1, 2]`;
    expect(diagnostics(defs, `xs.fold("", loud($2))`, "Text", '""')).toEqual([
      "E0201 Expected Text but got Int",
    ]);
    expect(diagnostics(defs, "xs.fold(0, $1 + $2)", "Int", "0")).toEqual([]);
    expect(diagnostics(defs, `xs.fold("", loud($1))`, "Text", '""')).toEqual([]);
    expect(diagnostics(defs, "xs.fold(0, loud($1))", "Text", '""')).toEqual([
      "E0201 Expected Text but got Int",
    ]);
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
    // Codegen binds from this decision; without it the fragment falls back to
    // reading the value's length at run time, and a `fn` of two named there
    // is refused.
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

describe("a fn named as the fragment is checked as the call it stands for", () => {
  // `xs.map(loud)` is `xs.map(loud($1))` (language.md §1.8.6): the name is
  // checked as that call, in the scope that binds the positionals, so the two
  // spellings report the same mismatch.
  const both = (defs: string, call: (f: string) => string, fn: string, args: string) => ({
    bare: (res: string, init = "[]") => diagnostics(defs, call(fn), res, init),
    inline: (res: string, init = "[]") => diagnostics(defs, call(`${fn}(${args})`), res, init),
  });

  it("reports a List element the fn's parameter does not take", () => {
    const defs = `${LOUD}\nslot xs : List(Int) = [1, 2]`;
    const map = both(defs, (f) => `xs.map(${f})`, "loud", "$1");
    expect(map.inline("List(Text)")).toEqual(["E0201 Expected Text but got Int"]);
    expect(map.bare("List(Text)")).toEqual(map.inline("List(Text)"));
  });

  it("accepts a fn over a Map's key and value types, and reports one over another key type", () => {
    const keep = (k: string) =>
      both(
        `fn keep(k: ${k}, v: Int) -> Bool = v > 0\nslot m : Map(Text, Int) = {}`,
        (f) => `m.filter(${f})`,
        "keep",
        "$1, $2",
      );
    expect(keep("Text").bare("Map(Text, Int)", "{}")).toEqual([]);
    expect(keep("Text").inline("Map(Text, Int)", "{}")).toEqual([]);
    expect(keep("Int").inline("Map(Text, Int)", "{}")).toEqual(["E0201 Expected Int but got Text"]);
    expect(keep("Int").bare("Map(Text, Int)", "{}")).toEqual(
      keep("Int").inline("Map(Text, Int)", "{}"),
    );
  });

  it("checks fold's first parameter against the init's type and its second against the element", () => {
    const step = (acc: string, x: string, init = "0") =>
      both(
        `fn step(acc: ${acc}, x: ${x}) -> Int = 0\nslot xs : List(Int) = [1, 2]`,
        (f) => `xs.fold(${init}, ${f})`,
        "step",
        "$1, $2",
      );
    expect(step("Int", "Int").bare("Int", "0")).toEqual([]);
    expect(step("Int", "Int").inline("Int", "0")).toEqual([]);
    for (const [acc, x, init] of [
      ["Text", "Int", "0"],
      ["Int", "Text", "0"],
      ["Int", "Int", '""'],
    ] as const) {
      const fold = step(acc, x, init);
      expect(fold.inline("Int", "0"), `${acc}, ${x} from ${init}`).toEqual([
        init === '""' ? "E0201 Expected Int but got Text" : "E0201 Expected Text but got Int",
      ]);
      expect(fold.bare("Int", "0"), `${acc}, ${x} from ${init}`).toEqual(fold.inline("Int", "0"));
    }
  });

  it("checks the value Map.update hands its fn, and the value the fn answers", () => {
    const update = both(
      `${LOUD}\nslot m : Map(Text, Int) = {}`,
      (f) => `m.update("a", ${f})`,
      "loud",
      "$1",
    );
    expect(update.inline("Map(Text, Int)", "{}")).toEqual([
      "E0201 Expected Text but got Int",
      "E0201 Expected Int but got Text",
    ]);
    expect(update.bare("Map(Text, Int)", "{}")).toEqual(update.inline("Map(Text, Int)", "{}"));
  });

  it("checks a Result's error under map-err and its value under flat-map", () => {
    const defs = `fn errI(e: Int) -> Int = e
fn next(t: Text) -> Result(Int, Text) = Ok(t.length)
slot r : Result(Int, Text) = Ok(1)`;
    const mapErr = both(defs, (f) => `r.map-err(${f})`, "errI", "$1");
    expect(mapErr.inline("Result(Int, Int)", "Ok(1)")).toEqual(["E0201 Expected Int but got Text"]);
    expect(mapErr.bare("Result(Int, Int)", "Ok(1)")).toEqual(
      mapErr.inline("Result(Int, Int)", "Ok(1)"),
    );
    const flat = both(defs, (f) => `r.flat-map(${f})`, "next", "$1");
    expect(flat.inline("Result(Int, Text)", "Ok(1)")).toEqual(["E0201 Expected Text but got Int"]);
    expect(flat.bare("Result(Int, Text)", "Ok(1)")).toEqual(
      flat.inline("Result(Int, Text)", "Ok(1)"),
    );
  });

  it("binds every positional FRAGMENT_ARGUMENTS lists, in both spellings", () => {
    // A parameter no positional has (`Bool`), over receivers whose type
    // arguments differ, so each mismatch names the type its positional is. A
    // row for a receiver that lacks the method would show up as E0108 here.
    const receivers: Record<string, { type: string; is: Record<string, string> }> = {
      List: { type: "List(Int)", is: { T: "Int", Acc: "Int" } },
      Option: { type: "Option(Int)", is: { T: "Int" } },
      Result: { type: "Result(Int, Text)", is: { T: "Int", E: "Text" } },
      Map: { type: "Map(Text, Int)", is: { K: "Text", V: "Int" } },
    };
    const rows: string[] = [];
    for (const [method, fragment] of FRAGMENT_ARGUMENTS) {
      for (const [receiver, positionals] of Object.entries(fragment.on)) {
        const r = receivers[receiver];
        if (!r || !positionals) throw new Error(`no probe receiver for ${receiver}`);
        rows.push(`${receiver}.${method}`);
        const params = positionals.map((_, i) => `p${i + 1}: Bool`).join(", ");
        const args = positionals.map((_, i) => `$${i + 1}`).join(", ");
        // The argument ahead of the fragment: `fold`'s init, `update`'s key.
        const lead = ["", method === "fold" ? "0, " : '"k", '][fragment.index];
        const errors = (f: string) =>
          check(
            parse(
              lex(`fn probe(${params}) = true
fn run(c: ${r.type}) = c.${method}(${lead}${f})
tile App = text("x")
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`),
            ),
          ).map((e) => `${e.code} ${e.message}`);
        const want = positionals.map((p) => `E0201 Expected Bool but got ${r.is[p]}`);
        expect(errors(`probe(${args})`), `${receiver}.${method}(probe(${args}))`).toEqual(want);
        expect(errors("probe"), `${receiver}.${method}(probe)`).toEqual(want);
      }
    }
    // The rows themselves: every fragment method, on each receiver
    // language.md §1.8.6 lists it for. A `Set`'s `filter` has none.
    expect(rows.sort()).toEqual([
      "List.filter",
      "List.find",
      "List.fold",
      "List.map",
      "List.sort-by",
      "Map.filter",
      "Map.map",
      "Map.update",
      "Option.filter",
      "Option.flat-map",
      "Option.map",
      "Result.flat-map",
      "Result.map",
      "Result.map-err",
    ]);
  });
});

describe("where the lowering's reading is not certain, nothing is bound", () => {
  // A `fn` with no `->` has no inferred result yet, so its elements are not
  // known here. That is a gap in inference, not a rule: once the result is
  // inferred this is the E0201 above, so only its absence today is pinned.
  it("a receiver whose type is not decided", () => {
    const defs = `${LOUD}\nfn anything(n: Int) = [n]`;
    expect(diagnostics(defs, "anything(1).map(loud($1))", "List(Text)")).not.toContain(
      "E0201 Expected Text but got Int",
    );
    expect(diagnostics(defs, "anything(1).map(loud)", "List(Text)")).not.toContain(
      "E0201 Expected Text but got Int",
    );
  });

  it("an accumulator whose init is `{}`, which is the empty Map and the empty Set alike", () => {
    // Typed as either, the init would refuse a fn written for the other.
    for (const acc of ["Map(Text, Int)", "Set(Int)"]) {
      const defs = `fn step(acc: ${acc}, x: Int) -> ${acc} = acc\nslot xs : List(Int) = [1, 2]`;
      expect(diagnostics(defs, "xs.fold({}, step)", acc, "{}"), acc).toEqual([]);
      expect(diagnostics(defs, "xs.fold({}, step($1, $2))", acc, "{}"), acc).toEqual([]);
    }
  });

  it("a Set's filter, which stdlib.md §2.2.3 gives no binding", () => {
    // `_s.filter` hands a Set's predicate each member as an `[element, true]`
    // entry, its key unrestored, so `$1` is not decided to be the element.
    const defs = `${LOUD}\nslot s : Set(Int) = []`;
    expect(diagnostics(defs, "s.filter(loud)", "Set(Int)")).not.toContain(
      "E0201 Expected Text but got Int",
    );
  });
});
