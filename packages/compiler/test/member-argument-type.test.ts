// The member's answer claims the receiver's type, so an argument not of it would put, say, a
// `Text` into a `List(Int)` slot.

import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

const app = (defs: string): string =>
  withApp(`${defs}\ntile Btn = button(text="go")\ntile App = column(Btn)`);

function diagnostics(defs: string): string[] {
  return checkSource(app(defs)).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);
}

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
slot n    : Int               = 0`;

const write = (stmt: string): string[] =>
  diagnostics(`${SLOTS}\nreducer go on=ui.click(Btn) do= ${stmt}`);

describe("a member argument the receiver types", () => {
  it("reports each write of the wrong element, key or value at its argument", () => {
    expect(
      diagnostics(`slot xs : List(Int)      = [1, 2]
slot ys : List(Int)      = [9]
slot m  : Map(Text, Int) = {}
slot s  : Set(Text)      = []
reducer go on=ui.click(Btn) do=
    xs := xs.push("3")
    ys := ys.prepend("z").concat(["w"])
    m := m.insert("k", "not an int")
    s := s.add(42)`),
    ).toEqual([
      "E0201 6:19 Expected Int but got Text",
      "E0201 7:22 Expected Int but got Text",
      "E0201 7:35 Expected Int but got Text",
      "E0201 8:24 Expected Int but got Text",
      "E0201 9:16 Expected Text but got Int",
    ]);
  });

  it.each([
    ["List.push", "xs := xs.push(n.show)", "E0201 12:47 Expected Int but got Text"],
    ["List.prepend", `xs := xs.prepend("a")`, "E0201 12:50 Expected Int but got Text"],
    [
      "List.concat, a list",
      "xs := xs.concat(ts)",
      "E0201 12:49 Expected List(Int) but got List(Text)",
    ],
    ["List.concat, a literal", `xs := xs.concat(["a"])`, "E0201 12:50 Expected Int but got Text"],
    ["List.contains", `b := xs.contains("a")`, "E0201 12:50 Expected Int but got Text"],
    ["Map.has", "b := m.has(1)", "E0201 12:44 Expected Text but got Int"],
    ["Map.get", "n := m.get(1).get-or(0)", "E0201 12:44 Expected Text but got Int"],
    ["Map.get-or's key", "n := m.get-or(1, 0)", "E0201 12:47 Expected Text but got Int"],
    ["Map.insert's key", `m := m.insert(1, 2)`, "E0201 12:47 Expected Text but got Int"],
    ["Map.insert's value", `m := m.insert("k", "v")`, "E0201 12:52 Expected Int but got Text"],
    ["Map.remove", "m := m.remove(1)", "E0201 12:47 Expected Text but got Int"],
    ["Map.update's key", "m := m.update(1, $1 + 1)", "E0201 12:47 Expected Text but got Int"],
    ["Map.update's value", `m := m.update("k", $1.show)`, "E0201 12:52 Expected Int but got Text"],
    ["Map.merge", "m := m.merge(mi)", "E0201 12:46 Expected Map(Text, Int) but got Map(Int, Text)"],
    ["a nominal key", "byId := byId.insert(post, 1)", "E0201 12:53 Expected TodoId but got PostId"],
    ["Set.has", "b := s.has(1)", "E0201 12:44 Expected Text but got Int"],
    ["Set.add", "s := s.add(1)", "E0201 12:44 Expected Text but got Int"],
    ["Set.remove", "s := s.remove(1)", "E0201 12:47 Expected Text but got Int"],
    ["Set.toggle", "s := s.toggle(1)", "E0201 12:47 Expected Text but got Int"],
    ["Set.union", "s := s.union([1])", "E0201 12:47 Expected Text but got Int"],
  ])("%s is one E0201, at the argument", (_member, stmt, want) => {
    expect(write(stmt)).toEqual([want]);
  });

  it("reports nothing for arguments of the receiver's types, however they are written", () => {
    expect(
      diagnostics(`type Color  = Red | Green | Blue
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
reducer go on=ui.click(Btn) do=
    fs := fs.push(1).prepend(2).concat([3, 4.5]).concat(nums)
    fset := fset.add(1).remove(2).toggle(3).union([4])
    fmap := fmap.insert("a", 1).update("a", $1 + 1)
    os := os.push(None).push(Some(1)).concat([]).prepend(Some(2))
    cs := cs.add(Red).toggle(Green).remove(Blue).union([Red]).union({}).diff(cs)
    todos := todos.push({id: 1, title: "a", note: None}).concat([{id: 2, title: "b", note: Some("x")}])
    byId := byId.insert("t1", {id: 1, title: "a", note: Some("n")}).insert(tid, {id: 2, title: "b", note: None}).remove(tid)
    b := byId.has(tid) && byId.has("raw") && cs.has(Red) && nums.contains(1) && fs.contains(1)
    byNum := byNum.insert(1, "one").remove(2).update(3, $1 + "!").merge({4: "four"})
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
    ).toEqual([]);
  });

  it("checks inside a fragment against the element its $1 is bound to", () => {
    expect(
      diagnostics(`slot sets : List(Set(Int)) = []
reducer go on=ui.click(Btn) do= sets := sets.map($1.add("x"))`),
    ).toEqual(["E0201 2:57 Expected Int but got Text"]);
  });

  it("reads no argument against a receiver whose type is undecided", () => {
    // `fold`'s accumulator `$1` and a `fn` result with no `->` have no type,
    // so neither is taken for the `List(Int)` the fold walks.
    expect(
      diagnostics(`slot nums  : List(Int)  = [1]
slot texts : List(Text) = []
fn mk() = ["a"]
reducer go on=ui.click(Btn) do=
    texts := nums.fold([], $1.push($2.show)).concat(mk().push("z"))`),
    ).toEqual([]);
  });

  it("leaves a call whose count selects no reading on its receiver to the arity report", () => {
    // `m.get-or(d)` is the Option reading; on a Map its one argument is no key.
    expect(write("n := m.get-or(1)")).toEqual([
      'E0213 12:38 Method ".get-or" on "Map" expects 2 argument(s) (key, default) but got 1 — ".get-or(default)" is the "Option" / "Result" reading',
    ]);
  });
});
