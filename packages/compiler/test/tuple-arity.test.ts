import { describe, expect, it } from "vitest";
import { errorsOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const DEFS = `slot pair   : Tuple(Int, Text)      = (1, "a")
slot triple : Tuple(Int, Text, Int) = (0, "z", 9)
slot flag   : Bool = true
slot k      : Int  = 0
slot res    : Text = ""`;

const program = (defs: string, body: string): string =>
  withApp(`${DEFS}
${defs}
reducer go on=ui.click(Go)
    do= ${body}
tile Go = button(text="go")
tile App = column(Go)`);

const errors = (src: string): string[] => errorsOf(src).map((e) => `${e.code} ${e.message}`);

const LISTS = `slot a : List(Tuple(Int, Int))      = []
slot b : List(Tuple(Int, Int, Int)) = []`;

describe("a tuple of another length is a type mismatch", () => {
  it.each([
    [
      "a pair into a triple slot",
      "",
      "triple := pair",
      "Tuple(Int, Text, Int)",
      "Tuple(Int, Text)",
    ],
    [
      "a triple into a pair slot",
      "",
      "pair := triple",
      "Tuple(Int, Text)",
      "Tuple(Int, Text, Int)",
    ],
    [
      "a pair as a fn's triple argument",
      "fn third(t: Tuple(Int, Text, Int)) -> Int = match t with\n    | (x, y, z) -> z",
      "k := third(pair)",
      "Tuple(Int, Text, Int)",
      "Tuple(Int, Text)",
    ],
    [
      "a triple as a fn's pair result",
      "fn cut(t: Tuple(Int, Text, Int)) -> Tuple(Int, Text) = t",
      "pair := cut(triple)",
      "Tuple(Int, Text)",
      "Tuple(Int, Text, Int)",
    ],
    [
      "a pair in an if branch",
      "",
      "triple := if flag then pair else triple",
      "Tuple(Int, Text, Int)",
      "Tuple(Int, Text)",
    ],
    [
      "a List of triples into a List of pairs",
      LISTS,
      "a := b",
      "List(Tuple(Int, Int))",
      "List(Tuple(Int, Int, Int))",
    ],
    [
      "a List of pairs into a List of triples",
      LISTS,
      "b := a",
      "List(Tuple(Int, Int, Int))",
      "List(Tuple(Int, Int))",
    ],
    [
      "a Map's values",
      "slot m : Map(Text, Tuple(Int, Int)) = {}\nslot n : Map(Text, Tuple(Int, Int, Int)) = {}",
      "m := n",
      "Map(Text, Tuple(Int, Int))",
      "Map(Text, Tuple(Int, Int, Int))",
    ],
    [
      "an Option's payload",
      "slot o : Option(Tuple(Int, Text)) = None\nslot o3 : Option(Tuple(Int, Text, Int)) = None",
      "o := o3",
      "Option(Tuple(Int, Text))",
      "Option(Tuple(Int, Text, Int))",
    ],
    [
      "a record field",
      'type R = {p: Tuple(Int, Text)}\nslot r : R = {p: (1, "a")}',
      "r.p := triple",
      "Tuple(Int, Text)",
      "Tuple(Int, Text, Int)",
    ],
    [
      "a tuple inside a tuple",
      'slot n : Tuple(Int, Tuple(Int, Text)) = (1, (2, "a"))',
      "n := (1, triple)",
      "Tuple(Int, Text)",
      "Tuple(Int, Text, Int)",
    ],
  ])("%s", (_what, defs, body, declared, actual) => {
    expect(errors(program(defs, body))).toEqual([`E0201 Expected ${declared} but got ${actual}`]);
  });
});

describe("what the length rule leaves alone", () => {
  it.each([
    ["a tuple of the same length", 'slot p2 : Tuple(Int, Text) = (2, "b")', "pair := p2"],
    [
      "a tuple inside a tuple of the same lengths",
      'slot n : Tuple(Int, Tuple(Int, Text)) = (1, (2, "a"))',
      "n := (3, pair)",
    ],
    ["an Int item widening to Float", 'slot f : Tuple(Float, Text) = (1.5, "a")', "f := pair"],
    [
      "a tuple in a record field",
      'type R = {p: Tuple(Int, Text)}\nslot r : R = {p: (1, "a")}',
      "r := {p: pair}",
    ],
    ["an Option of a tuple", "slot o : Option(Tuple(Int, Text)) = None", "o := Some(pair)"],
    ["a tuple a fn returns", 'fn mk(x: Int) -> Tuple(Int, Text) = (x, "a")', "pair := mk(2)"],
    ["a tuple pattern of the scrutinee's length", "", "res := match pair with\n    | (x, y) -> y"],
    [
      "a List of tuples",
      'slot l : List(Tuple(Int, Text)) = [(1, "a"), (2, "b")]',
      "l := l.push(pair)",
    ],
    [
      "a Map of tuples",
      'slot m : Map(Text, Tuple(Int, Int)) = {"a": (1, 2)}',
      'm := m.insert("b", (3, 4))',
    ],
    [
      "a generic alias of a tuple",
      'type Pair(A, B) = Tuple(A, B)\nslot pp : Pair(Int, Text) = (1, "a")',
      "pp := pair",
    ],
    [
      "the pairs .entries gives",
      'slot m : Map(Text, Int) = {"a": 1}\nslot es : List(Tuple(Text, Int)) = []',
      "es := m.entries",
    ],
  ])("%s", (_what, defs, body) => {
    expect(errors(program(defs, body))).toEqual([]);
  });

  it("reports an item of the wrong type", () => {
    expect(errors(program("slot p2 : Tuple(Int, Int) = (1, 2)", "p2 := pair"))).toEqual([
      "E0201 Expected Tuple(Int, Int) but got Tuple(Int, Text)",
    ]);
  });

  it("leaves a container written with too few arguments to E0210", () => {
    const box = "type Box(A, B) = {a: A, b: B}\nslot bx : Box(Int) = {a: 1, b: 2}";
    expect(errors(program(`${box}\nslot by : Box(Int, Int) = {a: 1, b: 2}`, "bx := by"))).toEqual([
      'E0210 Type "Box" expects 2 type argument(s) but got 1',
    ]);
    const map = "slot m : Map(Text) = {}\nslot m2 : Map(Text, Int) = {}";
    expect(errors(program(map, "m := m2"))).toEqual([
      'E0210 Type "Map" expects 2 type argument(s) but got 1',
    ]);
  });
});
