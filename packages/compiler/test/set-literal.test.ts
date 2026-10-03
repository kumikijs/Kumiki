// A list literal where a `Set` is declared is built as a Set (stdlib.md
// §2.2.2): the checker marks it (`asSet`) wherever it checks a value against a
// Set type, and codegen lowers a marked literal to `_s.setOf`. The runtime
// half, and every member reading the result, is pinned in
// `packages/tests/set-literal.test.ts`; this pins the decision.

import { check, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string, caps = "[]"): string =>
  `${defs}\ntile Btn = button(text="go")\ntile App = column(Btn)\napp A\n    caps   = ${caps}\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

function js(defs: string, caps?: string): string {
  const r = compile(app(defs, caps), { runtimeSpecifier: "./runtime.js", includeTests: true });
  if (r.kind !== "ok") throw new Error(r.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  return r.js;
}

/** Every diagnostic as `code line:col message`, in report order. */
function diagnostics(defs: string, caps?: string): string[] {
  return check(parse(lex(app(defs, caps)))).map(
    (e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`,
  );
}

describe("a list literal checked against a Set type", () => {
  it("lowers to setOf in a slot, a record field, a reducer write and a Set operand, and nowhere a List is declared", () => {
    const out = js(`type Bag = {tags: Set(Text)}
slot s   : Set(Int)  = [5]
slot xs  : List(Int) = [6]
slot bag : Bag       = {tags: ["x"]}
slot w   : Set(Text) = []
reducer go on=ui.click(Btn) do= w := w.union(["a"])`);
    expect(out).toContain("_s.setOf([5])");
    expect(out).toContain('_s.setOf(["x"])');
    expect(out).toContain('_s.setOf(["a"])');
    expect(out).toContain('"xs": { value: [6] }');
    expect(out).not.toContain("_s.setOf([6])");
  });

  it("lowers an empty literal to an empty Set", () => {
    expect(js("slot w : Set(Text) = []")).toContain('"w": { value: _s.setOf([]) }');
  });

  // Each row writes the literal in one position whose declared type is a Set
  // only through the position's own type — an element, a value, a payload, an
  // alias, a return type, a member's argument, a `let … in` body.
  it.each([
    ["a List element", "slot v : List(Set(Int)) = [[1]]", "[_s.setOf([1])]"],
    [
      "a Map value",
      'slot v : Map(Text, Set(Int)) = {"a": [1]}',
      '[_s.entryKey("a")]: _s.setOf([1])',
    ],
    ["an Option payload", "slot v : Option(Set(Int)) = Some([1])", "_s.setOf([1])"],
    ["an alias", "type Ids = Set(Int)\nslot v : Ids = [1]", '"v": { value: _s.setOf([1]) }'],
    ["a fn's return value", "fn one() -> Set(Int) = [1]", "return _s.setOf([1])"],
    [
      "a let … in body",
      "slot v : Set(Int) = []\nreducer go on=ui.click(Btn) do= v := let x = 1 in [x]",
      "return _s.setOf([x])",
    ],
    [
      "the argument of List.contains",
      "slot ls : List(Set(Int)) = []\nslot b : Bool = false\nreducer go on=ui.click(Btn) do= b := ls.contains([1])",
      "_s.contains(",
    ],
    [
      "the argument of List.push",
      "slot ls : List(Set(Int)) = []\nreducer go on=ui.click(Btn) do= ls := ls.push([1])",
      ", _s.setOf([1])]",
    ],
    [
      "the argument of List.prepend",
      "slot ls : List(Set(Int)) = []\nreducer go on=ui.click(Btn) do= ls := ls.prepend([1])",
      "[_s.setOf([1]), ...",
    ],
    [
      "the value of Map.insert",
      'slot m : Map(Text, Set(Int)) = {}\nreducer go on=ui.click(Btn) do= m := m.insert("a", [1])',
      '"a", _s.setOf([1]))',
    ],
    [
      "the value Map.update answers",
      'slot m : Map(Text, Set(Int)) = {}\nreducer go on=ui.click(Btn) do= m := m.update("a", [1])',
      "=> (_s.setOf([1]))",
    ],
  ])("in %s", (_position, defs, want) => {
    const out = js(defs);
    expect(out).toContain(want);
    expect(out).toContain("_s.setOf([");
  });

  it("builds the member a List.contains argument names, so it can equal a Set the list holds", () => {
    expect(
      js(
        "slot ls : List(Set(Int)) = []\nslot b : Bool = false\nreducer go on=ui.click(Btn) do= b := ls.contains([1])",
      ),
    ).toMatch(/_s\.contains\(.*, _s\.setOf\(\[1\]\)\)/);
  });
});

describe("a Set literal in a test", () => {
  it("counts each <any-id> member for the matcher instead of keying the sentinel", () => {
    const out = js(`type ItemId = nominal Text where uuid
slot sel : Set(ItemId) = {}
reducer pick on=ui.click(Btn) do= sel := [ItemId.fresh()]
test t = reducer-test pick
    given  = {event: {type: ui.click, target: Btn}}
    expect = {slots: {sel: ["00000000-0000-4000-8000-000000000001", <any-id>, <any-id>]}}`);
    expect(out).toContain(
      '{ ..._s.setOf(["00000000-0000-4000-8000-000000000001"]), [_s.WILD_MEMBERS]: 2 }',
    );
  });

  it("hands each <slots.X> member and map key to the matcher instead of keying the sentinel", () => {
    const out = js(`slot tags : Set(Text)       = []
slot m    : Map(Text, Int) = {}
slot pick : Text           = ""
reducer go on=ui.click(Btn) do= tags := tags.add(pick)
test t = reducer-test go
    given  = {event: {type: ui.click, target: Btn}}
    expect = {slots: {tags: ["z", <slots.pick>], m: {"y": 2, <slots.pick>: 1}}}`);
    expect(out).toContain(
      '{ ..._s.setOf(["z"]), [_s.WILD_SLOT_KEYS]: [[_s.wild("slot", "pick"), true]] }',
    );
    expect(out).toContain(
      '{ [_s.entryKey("y")]: 2, [_s.WILD_SLOT_KEYS]: [[_s.wild("slot", "pick"), 1]] }',
    );
  });

  it("is built as a Set in an expected effect's argument and in a mocked result", () => {
    const out = js(
      // An HTTP effect: a storage-family one must declare its error as Text
      // (E0306), and this case needs a Set on both sides of the Result.
      `effect save cap=http.post in=Set(Text) out=Result(Set(Text), Set(Int))
slot w : Set(Text) = []
reducer go on=ui.click(Btn) do= emit save(w)
test t = reducer-test go
    given  = {event: {type: ui.click, target: Btn}, mocks: {save: ok(["m"])}}
    expect = {slots: {}, effects: [save(["e"])]}
test u = reducer-test go
    given  = {event: {type: ui.click, target: Btn}, mocks: {save: delay(5, err([7]))}}
    expect = {slots: {}}`,
      "[http.post]",
    );
    expect(out).toContain('_s.setOf(["m"])');
    expect(out).toContain('_s.setOf(["e"])');
    expect(out).toContain("_s.setOf([7])");
  });
});

describe("an argument whose type the receiver fixes (E0201)", () => {
  const SLOTS = `slot w  : Set(Text)         = []
slot n  : Set(Int)          = []
slot o  : Option(Set(Text)) = None
slot xs : List(Text)        = []`;

  it.each([
    ["union with a List", "w.union(xs)", "E0201 5:46 Expected Set(Text) but got List(Text)"],
    [
      "intersect with a List",
      "w.intersect(xs)",
      "E0201 5:50 Expected Set(Text) but got List(Text)",
    ],
    [
      "diff with a Set of another element",
      "w.diff(n)",
      "E0201 5:45 Expected Set(Text) but got Set(Int)",
    ],
    [
      "union with an Option(Set)",
      "w.union(o)",
      "E0201 5:46 Expected Set(Text) but got Option(Set(Text))",
    ],
    [
      "union with a literal of another element",
      "w.union([1])",
      "E0201 5:47 Expected Text but got Int",
    ],
  ])("%s is one E0201, at the argument", (_case, call, want) => {
    expect(diagnostics(`${SLOTS}\nreducer go on=ui.click(Btn) do= w := ${call}`)).toEqual([want]);
  });

  it("reports nothing for a Set of the receiver's type, `{}`, or an alias or nominal receiver", () => {
    expect(
      diagnostics(`type Tags   = Set(Text)
type Picked = nominal Set(Text)
slot w : Set(Text) = []
slot v : Set(Text) = []
slot a : Tags      = []
slot p : Picked    = []
reducer go  on=ui.click(Btn) do= w := w.union(v).intersect({}).diff(a)
reducer go2 on=ui.click(Btn) do= a := a.union(["x"])
reducer go3 on=ui.click(Btn) do= p := p.union(["x"])`),
    ).toEqual([]);
  });

  it("leaves a same-named member of a non-Set type alone", () => {
    expect(diagnostics("fn gap(x: Time, y: Time) -> Duration = x.diff(y)")).toEqual([]);
  });

  it("checks a List element and a Map value against the receiver's", () => {
    expect(
      diagnostics(`slot ls : List(Set(Int))     = []
slot m  : Map(Text, Set(Int)) = {}
reducer go on=ui.click(Btn) do=
    ls := ls.push(["a"])
    m := m.insert("k", ["b"])`),
    ).toEqual(["E0201 4:20 Expected Int but got Text", "E0201 5:25 Expected Int but got Text"]);
  });
});

describe("a test's slot values", () => {
  it("are checked against the slot's type, as its initializer is", () => {
    expect(
      diagnostics(`type Bag = {tags: Set(Text)}
slot count : Int      = 0
slot nums  : Set(Int) = []
slot bag   : Bag      = {tags: []}
reducer go on=ui.click(Btn) do= count := count + 1
test t = reducer-test go
    given  = {slots: {count: "five", nums: ["a", "b"], bag: {tagz: []}}, event: {type: ui.click, target: Btn}}
    expect = {slots: {count: 6}}`),
    ).toEqual([
      "E0201 7:30 Expected Int but got Text",
      "E0201 7:45 Expected Int but got Text",
      "E0201 7:50 Expected Int but got Text",
      expect.stringMatching(/^E0214 7:\d+ /),
      expect.stringMatching(/^E0215 7:\d+ /),
    ]);
  });
});

describe("a test's expected effect argument and mocked result", () => {
  it("are checked against the effect's in= type and its out= halves", () => {
    expect(
      diagnostics(
        `effect save cap=storage.write in=Set(Text) out=Result(Set(Int), Text)
slot w : Set(Text) = []
reducer go on=ui.click(Btn) do= emit save(w)
test t = reducer-test go
    given  = {event: {type: ui.click, target: Btn}, mocks: {save: ok(["a"])}}
    expect = {slots: {}, effects: [save([1])]}
test u = reducer-test go
    given  = {event: {type: ui.click, target: Btn}, mocks: {save: err(5)}}
    expect = {slots: {}}`,
        "[storage.write]",
      ),
    ).toEqual([
      "E0201 5:71 Expected Int but got Text",
      "E0201 6:42 Expected Text but got Int",
      "E0201 8:71 Expected Text but got Int",
    ]);
  });
});
