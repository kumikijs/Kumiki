import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { FRAGMENT_ARGUMENTS } from "../src/stdlib-members.ts";
import { pointedErrorsOf, summariesOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const program = (defs: string, rhs: string, resType: string, init = "[]") => `${defs}
slot res : ${resType} = ${init}
reducer act on=ui.click(Btn)
    do= res := ${rhs}
tile Btn = button(text="go")
tile App = column(Btn)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;

const diagnostics = (defs: string, rhs: string, resType: string, init = "[]") =>
  check(parse(lex(program(defs, rhs, resType, init)))).map((e) => `${e.code} ${e.message}`);

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
  const XS = "slot xs : List(Int) = [1, 2]";
  const STEP = (acc: string, x: string) => `fn step(acc: ${acc}, x: ${x}) -> Int = 0\n${XS}`;
  const KEEP = (k: string, v = "Int") => `fn keep(k: ${k}, v: ${v}) -> Bool = true`;

  it.each([
    {
      name: "a List element the fn's parameter does not take",
      defs: `${LOUD}\n${XS}`,
      inline: "xs.map(loud($1))",
      bare: "xs.map(loud)",
      res: "List(Text)",
      slotInit: "[]",
      want: ["E0201 Expected Text but got Int"],
    },
    {
      name: "a fn over a Map's key and value types",
      defs: `${KEEP("Text")}\nslot m : Map(Text, Int) = {}`,
      inline: "m.filter(keep($1, $2))",
      bare: "m.filter(keep)",
      res: "Map(Text, Int)",
      slotInit: "{}",
      want: [],
    },
    {
      name: "a fn over another key type",
      defs: `${KEEP("Int")}\nslot m : Map(Text, Int) = {}`,
      inline: "m.filter(keep($1, $2))",
      bare: "m.filter(keep)",
      res: "Map(Text, Int)",
      slotInit: "{}",
      want: ["E0201 Expected Int but got Text"],
    },
    {
      name: "a one-parameter fn on a Map's filter, which is handed the key",
      defs: "fn keyOnly(k: Int) -> Bool = true\nslot m : Map(Text, Int) = {}",
      inline: "m.filter(keyOnly($1))",
      bare: "m.filter(keyOnly)",
      res: "Map(Text, Int)",
      slotInit: "{}",
      want: ["E0201 Expected Int but got Text"],
    },
    {
      name: "a Bytes key, which is not read back as its type, so only the value is checked",
      defs: `${KEEP("Int", "Text")}\nslot m : Map(Bytes, Int) = {}`,
      inline: "m.filter(keep($1, $2))",
      bare: "m.filter(keep)",
      res: "Map(Bytes, Int)",
      slotInit: "{}",
      want: ["E0201 Expected Text but got Int"],
    },
    {
      name: "fold's parameters of the init's type and the element's",
      defs: STEP("Int", "Int"),
      inline: "xs.fold(0, step($1, $2))",
      bare: "xs.fold(0, step)",
      res: "Int",
      slotInit: "0",
      want: [],
    },
    {
      name: "fold's first parameter of another type than the init's",
      defs: STEP("Text", "Int"),
      inline: "xs.fold(0, step($1, $2))",
      bare: "xs.fold(0, step)",
      res: "Int",
      slotInit: "0",
      want: ["E0201 Expected Text but got Int"],
    },
    {
      name: "fold's second parameter of another type than the element's",
      defs: STEP("Int", "Text"),
      inline: "xs.fold(0, step($1, $2))",
      bare: "xs.fold(0, step)",
      res: "Int",
      slotInit: "0",
      want: ["E0201 Expected Text but got Int"],
    },
    {
      name: "fold's init of another type than its first parameter",
      defs: STEP("Int", "Int"),
      inline: 'xs.fold("", step($1, $2))',
      bare: 'xs.fold("", step)',
      res: "Int",
      slotInit: "0",
      want: ["E0201 Expected Int but got Text"],
    },
    {
      name: "fold from an Int into a nominal Int",
      defs: "type Cents = nominal Int\nfn addC(acc: Cents, c: Cents) -> Cents = acc\nslot cs : List(Cents) = []",
      inline: "cs.fold(0, addC($1, $2))",
      bare: "cs.fold(0, addC)",
      res: "Cents",
      slotInit: "0",
      want: [],
    },
    {
      name: "fold from an Int into a Float",
      defs: "fn addF(acc: Float, x: Float) -> Float = acc + x\nslot fs : List(Float) = []",
      inline: "fs.fold(0, addF($1, $2))",
      bare: "fs.fold(0, addF)",
      res: "Float",
      slotInit: "0.0",
      want: [],
    },
    {
      name: "fold from an Int into a refined Float",
      defs: "type Price = Float where between(0.0, 100.0)\nfn addP(acc: Price, p: Price) -> Price = acc\nslot ps : List(Price) = []",
      inline: "ps.fold(0, addP($1, $2))",
      bare: "ps.fold(0, addP)",
      res: "Price",
      slotInit: "0.0",
      want: [],
    },
    {
      name: "fold from a record literal into the named record type",
      defs: `type Tally = {n: Int}\nfn bump(t: Tally, x: Int) -> Tally = t\n${XS}`,
      inline: "xs.fold({n: 0}, bump($1, $2))",
      bare: "xs.fold({n: 0}, bump)",
      res: "Tally",
      slotInit: "{n: 0}",
      want: [],
    },
    {
      name: "fold from [] into a List",
      defs: `fn addT(acc: List(Text), x: Int) -> List(Text) = acc.push(x.show)\n${XS}`,
      inline: "xs.fold([], addT($1, $2))",
      bare: "xs.fold([], addT)",
      res: "List(Text)",
      slotInit: "[]",
      want: [],
    },
    {
      name: "fold from None into an Option",
      defs: `fn firstOf(acc: Option(Int), x: Int) -> Option(Int) = acc.or(Some(x))\n${XS}`,
      inline: "xs.fold(None, firstOf($1, $2))",
      bare: "xs.fold(None, firstOf)",
      res: "Option(Int)",
      slotInit: "None",
      want: [],
    },
    {
      name: "fold into a Set from [], which is a List, not a Set",
      defs: `fn into(acc: Set(Int), x: Int) -> Set(Int) = acc.add(x)\n${XS}`,
      inline: "xs.fold([], into($1, $2))",
      bare: "xs.fold([], into)",
      res: "Set(Int)",
      slotInit: "[]",
      want: ["E0201 Expected Set(Int) but got List(?)"],
    },
    {
      name: "fold into a Set from a typed Set",
      defs: `fn into(acc: Set(Int), x: Int) -> Set(Int) = acc.add(x)\n${XS}\nslot seen : Set(Int) = []`,
      inline: "xs.fold(seen, into($1, $2))",
      bare: "xs.fold(seen, into)",
      res: "Set(Int)",
      slotInit: "[]",
      want: [],
    },
    {
      name: "the value Map.update hands its fn, and the value the fn answers",
      defs: `${LOUD}\nslot m : Map(Text, Int) = {}`,
      inline: 'm.update("a", loud($1))',
      bare: 'm.update("a", loud)',
      res: "Map(Text, Int)",
      slotInit: "{}",
      want: ["E0201 Expected Text but got Int", "E0201 Expected Int but got Text"],
    },
    {
      name: "a Result's error under map-err",
      defs: "fn errI(e: Int) -> Int = e\nslot r : Result(Int, Text) = Ok(1)",
      inline: "r.map-err(errI($1))",
      bare: "r.map-err(errI)",
      res: "Result(Int, Int)",
      slotInit: "Ok(1)",
      want: ["E0201 Expected Int but got Text"],
    },
    {
      name: "a Result's value under flat-map",
      defs: "fn next(t: Text) -> Result(Int, Text) = Ok(t.length)\nslot r : Result(Int, Text) = Ok(1)",
      inline: "r.flat-map(next($1))",
      bare: "r.flat-map(next)",
      res: "Result(Int, Text)",
      slotInit: "Ok(1)",
      want: ["E0201 Expected Text but got Int"],
    },
  ])("checks $name in both spellings alike", ({ defs, inline, bare, res, slotInit, want }) => {
    expect(diagnostics(defs, inline, res, slotInit)).toEqual(want);
    expect(diagnostics(defs, bare, res, slotInit)).toEqual(want);
  });

  it("reports at the fn's name, as the inline spelling does at the positional", () => {
    const at = (rhs: string) => pointedErrorsOf(program(`${LOUD}\n${XS}`, rhs, "List(Text)"));
    expect(at("xs.map(loud)")).toEqual([
      { code: "E0201", message: "Expected Text but got Int", text: "loud)" },
    ]);
    expect(at("xs.map(loud($1))")).toEqual([
      { code: "E0201", message: "Expected Text but got Int", text: "$1))" },
    ]);
  });

  it("binds each positional FRAGMENT_ARGUMENTS lists to its type, in both spellings", () => {
    // A parameter no positional has (`Bool`), over receivers whose type arguments differ, and a
    // `fold` from a `Text`, so each mismatch names the type its positional is bound to. A row for a
    // receiver that lacks the method would show up as E0108 here.
    const receivers: Record<string, string> = {
      List: "List(Int)",
      Option: "Option(Int)",
      Result: "Result(Int, Text)",
      Map: "Map(Text, Int)",
    };
    const bound: Record<string, readonly string[]> = {
      "List.filter": ["Int"],
      "List.find": ["Int"],
      "List.fold": ["Text", "Int"],
      "List.map": ["Int"],
      "List.sort-by": ["Int"],
      "Map.filter": ["Text", "Int"],
      "Map.map": ["Text", "Int"],
      "Map.update": ["Int"],
      "Option.filter": ["Int"],
      "Option.flat-map": ["Int"],
      "Option.map": ["Int"],
      "Result.flat-map": ["Int"],
      "Result.map": ["Int"],
      "Result.map-err": ["Text"],
    };
    const rows: string[] = [];
    for (const [method, fragment] of Object.entries(FRAGMENT_ARGUMENTS)) {
      for (const receiver of Object.keys(fragment.on)) {
        const row = `${receiver}.${method}`;
        rows.push(row);
        const types = bound[row] ?? [];
        const params = types.map((_, i) => `p${i + 1}: Bool`).join(", ");
        const args = types.map((_, i) => `$${i + 1}`).join(", ");
        // The argument ahead of the fragment: `fold`'s init, `update`'s key.
        const lead = ["", method === "fold" ? '"", ' : '"k", '][fragment.index];
        const errors = (f: string) =>
          summariesOf(
            withApp(`fn probe(${params}) = true
fn run(c: ${receivers[receiver]}) = c.${method}(${lead}${f})
tile App = text("x")`),
          );
        const want = types.map((t) => `E0201 Expected Bool but got ${t}`);
        expect(errors(`probe(${args})`), `${row}(probe(${args}))`).toEqual(want);
        expect(errors("probe"), `${row}(probe)`).toEqual(want);
      }
    }
    // Every fragment method, on each receiver language.md lists it for. A `Set`'s `filter` has none.
    expect(rows.sort()).toEqual(Object.keys(bound).sort());
  });
});

describe("where the lowering's reading is not certain, nothing is bound", () => {
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

  it("a Set's filter, which stdlib.md gives no binding", () => {
    // `_s.filter` hands a Set's predicate each member as an `[element, true]` entry, the element
    // read back as its type. A one-positional row would bind `$1` to that whole entry.
    const defs = `${LOUD}\nslot s : Set(Int) = []`;
    expect(diagnostics(defs, "s.filter(loud)", "Set(Int)")).not.toContain(
      "E0201 Expected Text but got Int",
    );
  });
});
