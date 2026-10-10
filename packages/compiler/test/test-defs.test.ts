import type { TestDef } from "@kumikijs/compiler";
import { lex, ParseError, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

describe("test definitions", () => {
  it("parses a reducer-test and a tile-test", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t1 = reducer-test inc given={slots:{count:0}, event:{type: ui.click, target: B}} expect={slots:{count:1}, effects:[]}
test t2 = tile-test App given={slots:{count:0}} expect=column(button(text="+1"))`;
    const program = parse(lex(src));
    const tests = program.defs.filter((d): d is TestDef => d.kind === "TestDef");
    expect(tests.length).toBe(2);
    expect(tests[0]?.testKind).toBe("reducer-test");
    expect(tests[0]?.target).toBe("inc");
    expect(tests[1]?.testKind).toBe("tile-test");
    expect(tests[1]?.target).toBe("App");
  });

  it("reports an unknown reducer in a reducer-test (E0102)", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="x", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test nope given={slots:{count:0}, event:{type: ui.click, target: B}} expect={slots:{count:1}, effects:[]}`;
    expect(checkSource(src).some((e) => e.code === "E0102" && e.message.includes("nope"))).toBe(
      true,
    );
  });

  it("reports an unknown tile in a tile-test (E0105)", () => {
    const src = `
tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = tile-test Nope given={slots:{}} expect=column(text("x"))`;
    expect(checkSource(src).some((e) => e.code === "E0105" && e.message.includes("Nope"))).toBe(
      true,
    );
  });

  it("accepts well-formed tests with no diagnostics", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test inc given={slots:{count:0}, event:{type: ui.click, target: B}} expect={slots:{count:1}, effects:[]}`;
    expect(checkSource(src)).toEqual([]);
  });

  // ----- `expect` wildcards -----

  it("parses and accepts `<any-id>` / `<slots.X>` wildcards in a reducer-test expect", () => {
    const src = `
type TodoId = nominal Text where uuid
type Todo = {id: TodoId, text: Text, done: Bool}
slot todos : Map(TodoId, Todo) = {}
slot draft : Text = ""
effect persist cap=storage.write in=Map(TodoId, Todo) out=Result(Unit, Text)
reducer add on=ui.submit(F) do=
  let id = TodoId.fresh()
  todos[id] := {id, text=draft, done=false}
tile F = form(input(bind=draft))
tile App = column(F)
app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
test add-basic = reducer-test add
  given = {slots:{todos:{}, draft:"Hi"}, event:{type: ui.submit, target: F}}
  expect = {slots:{todos:{<any-id>: {id: <any-id>, text:"Hi", done:false}}, draft:""}, effects:[persist(<slots.todos>)]}`;
    const program = parse(lex(src));
    const tests = program.defs.filter((d): d is TestDef => d.kind === "TestDef");
    expect(tests.length).toBe(1);
    expect(checkSource(src)).toEqual([]);
  });

  it("rejects a wildcard used outside a test expect (E0109)", () => {
    const src = `
slot count : Int = 0
reducer bad on=ui.click(B) do= count := <any-id>
tile B = button(text="x", onClick=bad)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(checkSource(src).some((e) => e.code === "E0109")).toBe(true);
  });

  it("rejects a wildcard in a reducer-test `given` (E0109 — expect only)", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test inc given={slots:{count:<any-id>}, event:{type: ui.click, target: B}} expect={slots:{count:1}, effects:[]}`;
    expect(checkSource(src).some((e) => e.code === "E0109")).toBe(true);
  });

  it("rejects a wildcard nested under another expression in `given` (E0109)", () => {
    // A wildcard buried under a FieldAccess must not escape the given-scan.
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test inc given={slots:{count:<slots.count>.foo}, event:{type: ui.click, target: B}} expect={slots:{count:1}, effects:[]}`;
    expect(checkSource(src).some((e) => e.code === "E0109")).toBe(true);
  });

  it("rejects `<slots.X>` naming an undefined slot in expect (E0103)", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test inc given={slots:{count:0}, event:{type: ui.click, target: B}} expect={slots:{count:1}, effects:[persist(<slots.itms>)]}`;
    expect(checkSource(src).some((e) => e.code === "E0103" && e.message.includes("itms"))).toBe(
      true,
    );
  });

  // ----- effect-result mocks -----

  it("accepts a reducer-test with `given.mocks` for a declared effect", () => {
    const src = `
type Item = {id: Text}
slot items : Map(Text, Item) = {}
slot status : Text = ""
effect load cap=storage.read in=Unit out=Result(Map(Text, Item), Text) map-request={key: "items", decode: Decoder.Json(Map(Text, Item))}
reducer reload on=ui.click(B) do= emit load()
reducer loaded on=load.ok($m, _) do= items := $m
reducer failed on=load.err($e, _) do= status := $e
tile B = button(text="reload", onClick=reload)
tile App = column(B)
app A caps=[storage.read] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test reload
  given  = {slots:{items:{}}, event:{type: ui.click, target: B}, mocks:{load: ok({"i1": {id: "i1"}})}}
  expect = {slots:{items:{"i1": {id: "i1"}}}, effects:[]}`;
    expect(checkSource(src)).toEqual([]);
  });

  it("rejects a mock targeting an undefined effect (E0104)", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test t = reducer-test inc given={slots:{count:0}, event:{type: ui.click, target: B}, mocks:{nope: ok(1)}} expect={slots:{count:1}, effects:[]}`;
    expect(checkSource(src).some((e) => e.code === "E0104" && e.message.includes("nope"))).toBe(
      true,
    );
  });

  // ----- property-test -----

  it("parses and accepts a property-test with for-all / invariant / run-reducer", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
reducer dec on=ui.click(B) do= count := count - 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test rt = property-test
  for-all   = {count: Int where between(0, 50)}
  given     = {slots: {count: count}, event: {type: ui.click, target: B}}
  invariant = run-reducer(inc).run-reducer(dec).slots.count == count`;
    const program = parse(lex(src));
    const tests = program.defs.filter((d): d is TestDef => d.kind === "TestDef");
    expect(tests[0]?.testKind).toBe("property-test");
    expect(tests[0]?.forAll?.[0]?.name).toBe("count");
    expect(checkSource(src)).toEqual([]);
  });

  it("parses optional count / shrink on a property-test", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test rt = property-test
  for-all   = {count: Int}
  given     = {slots: {count: count}, event: {type: ui.click, target: B}}
  invariant = run-reducer(inc).slots.count == count + 1
  count     = 50
  shrink    = false`;
    const tests = parse(lex(src)).defs.filter((d): d is TestDef => d.kind === "TestDef");
    expect(tests[0]?.count).toBe(50);
    expect(tests[0]?.shrink).toBe(false);
    expect(checkSource(src)).toEqual([]);
  });

  describe("a property-test's count is a whole number, 1 or more", () => {
    // The literal sits on line 11, column 15 of every source below.
    const withCount = (count: string) => `
slot clicks : Int = 0
reducer inc on=ui.click(B) do= clicks := clicks + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test rt = property-test
  for-all   = {n: Int}
  given     = {slots: {clicks: n}, event: {type: ui.click, target: B}}
  invariant = run-reducer(inc).slots.clicks == n + 1
  count     = ${count}
  shrink    = false`;

    it.each([
      "0",
      "0.5",
      "0.50",
      "-3",
      "-0",
    ])("refuses count = %s at the literal, as written", (count) => {
      expect(() => parse(lex(withCount(count)))).toThrow(
        new ParseError(
          `property-test "rt" count must be a whole number, 1 or more (got ${count})`,
          { line: 11, col: 15 },
        ),
      );
    });

    it.each(["1", "1.0"])("accepts count = %s, the fewest cases a property can run", (count) => {
      const src = withCount(count);
      const tests = parse(lex(src)).defs.filter((d): d is TestDef => d.kind === "TestDef");
      expect(tests[0]?.count).toBe(1);
      expect(checkSource(src)).toEqual([]);
    });
  });

  it("rejects run-reducer naming an undefined reducer (E0102)", () => {
    const src = `
slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="+1", onClick=inc)
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
test rt = property-test
  for-all   = {count: Int}
  given     = {slots: {count: count}, event: {type: ui.click, target: B}}
  invariant = run-reducer(nope).slots.count == count`;
    expect(checkSource(src).some((e) => e.code === "E0102" && e.message.includes("nope"))).toBe(
      true,
    );
  });
});

describe("episode-test mocks", () => {
  const PREAMBLE = `
    slot count : Int = 0
    effect persist cap=storage.write in=Int out=Result(Unit, Text)
    reducer inc on=ui.click(B) do=
        count := count + 1
        emit persist(count)
    reducer persistFailed on=persist.err($e, _) do= count := 0
    tile B = button(text="+")
    tile App = column(B, heading(count.show))
    app A caps=[storage.write] routes={"/" -> App, "/404" -> App} init=[]
  `;

  it("accepts from-log / ignore / ok(...) / err(...)", () => {
    const src = `
      ${PREAMBLE}
      test t = episode-test
        load   = "x.jsonl"
        mocks  = {persist: from-log}
        expect = {slots-equal: from-log}
      test u = episode-test
        load   = "x.jsonl"
        mocks  = {persist: ignore}
        expect = {slots-equal: from-log}
      test v = episode-test
        load   = "x.jsonl"
        mocks  = {persist: ok(unit)}
        expect = {slots-equal: from-log}
      test w = episode-test
        load   = "x.jsonl"
        mocks  = {persist: err("nope")}
        expect = {slots-equal: from-log}
    `;
    expect(checkSource(src).some((e) => e.code === "E0712")).toBe(false);
  });

  it("rejects an unknown mock policy value (E0712)", () => {
    const src = `
      ${PREAMBLE}
      test t = episode-test
        load   = "x.jsonl"
        mocks  = {persist: from_log}
        expect = {slots-equal: from-log}
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0712" && e.kind === "episode-mock-invalid")).toBe(true);
  });
});
