// The member's answer claims the receiver's type, so an argument not of it would put, say, a
// `Text` into a `List(Int)` slot.

import { describe, expect, it } from "vitest";
import { RECEIVER_PARAMS } from "../src/stdlib-members.ts";
import { codesOf, pointedErrorsOf, summariesOf } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const app = (defs: string): string =>
  withApp(`${defs}\ntile Btn = button(text="go")\ntile App = column(Btn)`);

const SLOTS = `type TodoId = nominal Text
type PostId = nominal Text
slot xs   : List(Int)         = []
slot ts   : List(Text)        = []
slot m    : Map(Text, Int)    = {}
slot mi   : Map(Int, Text)    = {}
slot byId : Map(TodoId, Int)  = {}
slot post : PostId            = "p"
slot s    : Set(Text)         = []
slot b    : Bool              = false
slot n    : Int               = 0
fn toText(x: Int) -> Text = x.show
fn shown(x: Int) = x.show`;

/** The errors of a reducer that runs `stmt`, each with the source text it is reported at. */
const write = (stmt: string) =>
  pointedErrorsOf(app(`${SLOTS}\nreducer go on=ui.click(Btn) do= ${stmt}`));

describe("a member argument the receiver types", () => {
  it("reports each write of the wrong element, key or value at its argument", () => {
    expect(
      pointedErrorsOf(
        app(`slot xs : List(Int)      = [1, 2]
slot ys : List(Int)      = [9]
slot m  : Map(Text, Int) = {}
slot s  : Set(Text)      = []
reducer go on=ui.click(Btn) do=
    xs := xs.push("3")
    ys := ys.prepend("z").concat(["w"])
    m := m.insert("k", "not an int")
    s := s.add(42)`),
      ),
    ).toEqual([
      { code: "E0201", message: "Expected Int but got Text", text: '"3")' },
      { code: "E0201", message: "Expected Int but got Text", text: '"z").concat(["w"])' },
      { code: "E0201", message: "Expected Int but got Text", text: '"w"])' },
      { code: "E0201", message: "Expected Int but got Text", text: '"not an int")' },
      { code: "E0201", message: "Expected Text but got Int", text: "42)" },
    ]);
  });

  // `at` is the source text from the reported position to the end of the line.
  it.each([
    ["List.push", "xs := xs.push(n.show)", "n.show)", "Expected Int but got Text"],
    ["List.prepend", `xs := xs.prepend("a")`, '"a")', "Expected Int but got Text"],
    ["List.concat, a list", "xs := xs.concat(ts)", "ts)", "Expected List(Int) but got List(Text)"],
    ["List.concat, a literal", `xs := xs.concat(["a"])`, '"a"])', "Expected Int but got Text"],
    ["List.contains", `b := xs.contains("a")`, '"a")', "Expected Int but got Text"],
    ["Map.has", "b := m.has(1)", "1)", "Expected Text but got Int"],
    ["Map.get", "n := m.get(1).get-or(0)", "1).get-or(0)", "Expected Text but got Int"],
    ["Map.get-or's key", "n := m.get-or(1, 0)", "1, 0)", "Expected Text but got Int"],
    ["Map.insert's key", "m := m.insert(1, 2)", "1, 2)", "Expected Text but got Int"],
    ["Map.insert's value", `m := m.insert("k", "v")`, '"v")', "Expected Int but got Text"],
    ["Map.remove", "m := m.remove(1)", "1)", "Expected Text but got Int"],
    ["Map.update's key", "m := m.update(1, $1 + 1)", "1, $1 + 1)", "Expected Text but got Int"],
    ["Map.update's value", `m := m.update("k", $1.show)`, "$1.show)", "Expected Int but got Text"],
    [
      "Map.update's value, a fn named",
      `m := m.update("k", toText)`,
      "toText)",
      "Expected Int but got Text",
    ],
    [
      "Map.update's value, a fn with no -> named",
      `m := m.update("k", shown)`,
      "shown)",
      "Expected Int but got Text",
    ],
    ["Map.merge", "m := m.merge(mi)", "mi)", "Expected Map(Text, Int) but got Map(Int, Text)"],
    ["a nominal key", "byId := byId.insert(post, 1)", "post, 1)", "Expected TodoId but got PostId"],
    ["Set.has", "b := s.has(1)", "1)", "Expected Text but got Int"],
    ["Set.add", "s := s.add(1)", "1)", "Expected Text but got Int"],
    ["Set.remove", "s := s.remove(1)", "1)", "Expected Text but got Int"],
    ["Set.toggle", "s := s.toggle(1)", "1)", "Expected Text but got Int"],
    ["Set.union", "s := s.union([1])", "1])", "Expected Text but got Int"],
  ])("%s is one E0201, at the argument", (_member, stmt, at, message) => {
    expect(write(stmt)).toEqual([{ code: "E0201", message, text: at }]);
  });

  it("reports nothing for arguments of the receiver's types, however they are written", () => {
    expect(
      summariesOf(
        app(`type Color  = Red | Green | Blue
type Todo   = {id: Int, title: Text, note: Option(Text)}
type TodoId = nominal Text
type Small  = Int where between(0, 10)
type Stack(T) = {items: List(T)}
type Ids    = nominal List(Int)
type Point  = {x: Int, y: Int}
slot fs       : List(Float)          = [1.5]
slot fset     : Set(Float)           = []
slot fmap     : Map(Text, Float)     = {}
slot os       : List(Option(Int))    = []
slot cs       : Set(Color)           = []
slot todos    : List(Todo)           = []
slot byId     : Map(TodoId, Todo)    = {}
slot tid      : TodoId               = "t1"
slot byNum    : Map(Int, Text)       = {}
slot byColor  : Map(Color, Int)      = {}
slot byPoint  : Map(Point, Int)      = {}
slot byOpt    : Map(Option(Int), Int) = {}
slot smalls   : List(Small)          = []
slot sets     : List(Set(Int))       = []
slot setOfSets : Set(Set(Int))       = []
slot nested   : List(List(Int))      = []
slot pairs    : List(Tuple(Int, Text)) = []
slot st       : Stack(Int)           = {items: []}
slot ids      : Ids                  = []
slot nums     : List(Int)            = [1, 2]
slot b        : Bool                 = false
slot n        : Int                  = 0
slot txt      : Text                 = ""
fn pushed(s: Stack(Int), x: Int) -> Stack(Int) = s.copy(items = s.items.push(x))
fn exclaimed(t: Text) -> Text = t + "!"
reducer go on=ui.click(Btn) do=
    fs := fs.push(1).prepend(2).concat([3, 4.5]).concat(nums)
    fset := fset.add(1).remove(2).toggle(3).union([4])
    fmap := fmap.insert("a", 1).update("a", $1 + 1)
    os := os.push(None).push(Some(1)).concat([]).prepend(Some(2))
    cs := cs.add(Red).toggle(Green).remove(Blue).union([Red]).union({}).diff(cs)
    todos := todos.push({id: 1, title: "a", note: None}).concat([{id: 2, title: "b", note: Some("x")}])
    byId := byId.insert("t1", {id: 1, title: "a", note: Some("n")}).insert(tid, {id: 2, title: "b", note: None}).remove(tid)
    b := byId.has(tid) && byId.has("raw") && cs.has(Red) && nums.contains(1) && fs.contains(1)
    byNum := byNum.insert(1, "one").remove(2).update(3, $1 + "!").update(4, exclaimed).merge({4: "four"})
    byColor := byColor.insert(Red, 1).update(Green, $1 + 1)
    byPoint := byPoint.insert({x: 1, y: 2}, 3).remove({x: 1, y: 2})
    byOpt := byOpt.insert(None, 1).insert(Some(2), 3)
    smalls := smalls.push(3)
    sets := sets.push([1]).push({}).prepend([2, 3])
    setOfSets := setOfSets.add([1]).remove([1]).toggle({})
    nested := nested.map($1.push(1)).push([]).concat([[1]])
    pairs := pairs.push((1, "a")).concat(nums.zip(["a"]))
    st := pushed(st, 1)
    ids := ids.push(1).concat([2]).concat(ids)
    n := byNum.get(1).map($1.length).get-or(0) + byColor.get-or(Red, 0)
    txt := byNum.get-or(1, "none")`),
      ),
    ).toEqual([]);
  });

  it("reads no argument against a parameter the receiver does not type", () => {
    // Each argument below is of another type than the receiver's element, key and value.
    expect(
      summariesOf(
        app(`slot nums   : List(Int)              = [1, 2]
slot ts     : List(Text)             = ["a"]
slot s      : Set(Text)              = []
slot byNum  : Map(Int, Text)         = {}
slot flags  : Map(Int, Bool)         = {}
slot chunks : List(List(Text))       = []
slot shown  : List(Text)             = []
slot pairs  : List(Tuple(Int, Text)) = []
slot first  : Text                   = ""
slot joined : Text                   = ""
slot folded : Text                   = ""
slot found  : Int                    = 0
reducer go on=ui.click(Btn) do=
    first := ts.get(0).get-or("")
    ts := ts.slice(0, 1).sort-by($1.length)
    chunks := ts.chunk(2)
    joined := nums.join(",")
    byNum := byNum.filter($2 != "")
    flags := byNum.map($2 == "")
    s := s.filter($1 != "")
    nums := nums.filter($1 > 0)
    found := nums.find($1 > 0).get-or(0)
    folded := nums.fold("", $1 + $2.show)
    shown := nums.map($1.show)
    pairs := nums.zip(ts)`),
      ),
    ).toEqual([]);
  });

  it("checks inside a fragment against the element its $1 is bound to", () => {
    expect(
      pointedErrorsOf(
        app(`slot sets : List(Set(Int)) = []
reducer go on=ui.click(Btn) do= sets := sets.map($1.add("x"))`),
      ),
    ).toEqual([{ code: "E0201", message: "Expected Int but got Text", text: '"x"))' }]);
  });

  it("reads no argument against a receiver whose element type is undecided", () => {
    // From `[]`, `fold`'s accumulator `$1` is a List whose element type is not decided, so `push`
    // reads its argument against nothing.
    expect(
      summariesOf(
        app(`slot nums  : List(Int)  = [1]
slot texts : List(Text) = []
reducer go on=ui.click(Btn) do=
    texts := nums.fold([], $1.push($2.show))`),
      ),
    ).toEqual([]);
  });

  it("reads an argument against the result of a fn with no `->`, which is its body's type", () => {
    // `mk` has no `->`, so it returns its body's type, a `List(Int)`.
    expect(
      pointedErrorsOf(
        app(`slot texts : List(Text) = []
fn mk() = [1]
reducer go on=ui.click(Btn) do=
    texts := mk().push("z").map($1.show)`),
      ),
    ).toEqual([{ code: "E0201", message: "Expected Int but got Text", text: '"z").map($1.show)' }]);
  });

  it("leaves a call whose count selects no reading on its receiver to the arity report", () => {
    // `m.get-or(d)` is the Option reading; on a Map its one argument is no key.
    expect(write("n := m.get-or(1)")).toEqual([
      {
        code: "E0213",
        message:
          'Method ".get-or" on "Map" expects 2 argument(s) (key, default) but got 1 — ".get-or(default)" is the "Option" / "Result" reading',
        text: "m.get-or(1)",
      },
    ]);
  });
});

// A call given fewer arguments than a row lists has none read against it, so a row longer than
// the arity `check` enforces would turn the check off for every call that arity allows.
describe("each row of the parameter table is the member's arity", () => {
  /** A call of `member` on the parameter `recv`, one row per member that takes arguments. */
  const rowsOf = (
    receiver: string,
    recv: string,
    row: Readonly<Record<string, readonly unknown[]>>,
  ) =>
    Object.entries(row)
      .filter(([, params]) => params.length > 0)
      .map(([member, params]) => ({
        name: `${receiver}.${member}`,
        n: params.length,
        call: (count: number) =>
          `${recv}.${member}(${Array.from({ length: count }, () => "1").join(", ")})`,
      }));
  const rows = [
    ...rowsOf("Map", "m", RECEIVER_PARAMS.Map),
    ...rowsOf("Set", "s", RECEIVER_PARAMS.Set),
    ...rowsOf("List", "xs", RECEIVER_PARAMS.List),
  ];
  const codes = (call: string): string[] =>
    codesOf(
      withApp(`fn probe(m: Map(Int, Int), s: Set(Int), xs: List(Int)) = ${call}
tile App = column(text("x"))`),
    );

  // stdlib.md writes `slice(start, end)`, but `check` sets `slice` no lower bound yet.
  const bounded = rows.filter(({ name }) => name !== "List.slice");

  it.each(bounded)("$name with one argument fewer than its row is E0213", ({ n, call }) => {
    expect(codes(call(n - 1))).toContain("E0213");
  });

  it.each(rows)("$name with as many arguments as its row is no E0213", ({ n, call }) => {
    expect(codes(call(n))).not.toContain("E0213");
  });
});
