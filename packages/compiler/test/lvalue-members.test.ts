import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { compileOrFail, loweredOf } from "./helpers/module.ts";
import { withApp } from "./helpers/programs.ts";

/** The reducer body under test, wrapped in the smallest program that parses. */
const withBody = (decls: string, body: string): string =>
  withApp(`${decls}
reducer act on=ui.click(Btn)
    do= ${body}
tile Btn = button(text="go")
tile App = column(Btn)`);

describe("a member is not an assignable lvalue", () => {
  it("rejects a shortcut on a scalar, naming the member and the receiver", () => {
    const errs = checkSource(withBody(`slot name : Text = "abc"`, `name.length := 9`));
    const e = errs.find((x) => x.code === "E0602");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("unassignable-member");
    expect(e?.message).toContain(".length");
    expect(e?.message).toContain("Text");
  });

  it("rejects a shortcut on a container", () => {
    const errs = checkSource(withBody(`slot maybe : Option(Text) = None`, `maybe.is-some := 0`));
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(".is-some");
  });

  it.each([
    [`slot xs : List(Int) = []`, `xs.length := 0`, ".length"],
    [`slot xs : List(Int) = []`, `xs.head := 1`, ".head"],
    [`slot s : Text = ""`, `s.upper := "X"`, ".upper"],
    [`slot n : Int = 0`, `n.abs := 1`, ".abs"],
    [`slot m : Map(Text, Int) = {}`, `m.keys := []`, ".keys"],
    [`slot st : Set(Int) = []`, `st.size := 0`, ".size"],
  ])("%s / %s", (decls, body, member) => {
    const errs = checkSource(withBody(decls, body));
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(member);
  });

  it("rejects .show on a record, the one member every value has", () => {
    const errs = checkSource(
      withBody(`type Rec = { title: Text }\nslot rec : Rec = { title: "" }`, `rec.show := "x"`),
    );
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(".show");
  });

  it.each([
    [`slot m : Map(Text, Int) = {}`, `m.get := 1`],
    [`slot xs : List(Int) = []`, `xs.get := 1`],
  ])("rejects .get on %s, which does not unwrap", (decls, body) => {
    expect(codesOf(withBody(decls, body))).toContain("E0602");
  });
});

describe("what stays legal", () => {
  it("accepts .get on an Option", () => {
    const errs = checkSource(
      withBody(`slot draft : Option({title: Text}) = None`, `draft.get.title := "x"`),
    );
    expect(errs).toEqual([]);
  });

  it("accepts .get on a Result", () => {
    const errs = checkSource(
      withBody(`slot r : Result({title: Text}, Text) = Err("no")`, `r.get.title := "x"`),
    );
    expect(errs).toEqual([]);
  });

  it.each(["length", "size", "get", "head", "keys"])("accepts a record field named %s", (field) => {
    const errs = checkSource(
      withBody(
        `type Rec = { ${field}: Int }\nslot rec : Rec = { ${field}: 0 }`,
        `rec.${field} := 1`,
      ),
    );
    expect(errs).toEqual([]);
  });

  it("accepts a File's structural field, through the unwrap", () => {
    const errs = checkSource(withBody(`slot f : Option(File) = None`, `f.get.name := "x"`));
    expect(errs).toEqual([]);
  });

  it("accepts a plain field and an index", () => {
    const errs = checkSource(
      withBody(
        `type Rec = { title: Text }\nslot rows : List(Rec) = []\nslot rec : Rec = { title: "" }`,
        `rec.title := "x"\n        rows[0].title := "y"`,
      ),
    );
    expect(errs).toEqual([]);
  });
});

describe("a receiver the checker cannot decide stays silent", () => {
  it("says nothing about a member on a union-typed receiver", () => {
    const errs = checkSource(
      withBody(
        `type Filter = All | Active | Done\nslot filter : Filter = All`,
        `filter.length := 1`,
      ),
    );
    expect(errs).toEqual([]);
  });

  it("says nothing on the read side either, for the same receiver", () => {
    const errs = checkSource(
      withBody(
        `type Filter = All | Active | Done\nslot filter : Filter = All\nslot n : Int = 0`,
        `n := filter.length`,
      ),
    );
    expect(errs).toEqual([]);
  });
});

describe("the write side answers the read side's question too", () => {
  it("reports an unknown member on a known receiver as E0108", () => {
    const errs = checkSource(withBody(`slot name : Text = "abc"`, `name.frist := 9`));
    expect(errs.map((x) => x.code)).toContain("E0108");
  });

  it("still reports an unknown member on a record as E0108", () => {
    const errs = checkSource(
      withBody(`type Rec = { title: Text }\nslot rec : Rec = { title: "" }`, `rec.nope := 1`),
    );
    expect(errs.map((x) => x.code)).toContain("E0108");
  });

  it("reports a member of a number on a non-numeric receiver as E0108, not E0602", () => {
    const errs = checkSource(withBody(`slot s : Text = ""`, `s.abs := 1`));
    expect(errs.map((x) => x.code)).toEqual(["E0108"]);
    expect(errs[0]?.message).toContain("Int / Float");
  });

  it.each([
    [`slot s : Text = ""`, `s.abs`, "E0108"],
    [`slot s : Text = ""`, `s.frist`, "E0108"],
    [`slot xs : List(Int) = []`, `xs.nope`, "E0108"],
    [`type Rec = { title: Text }\nslot rec : Rec = { title: "" }`, `rec.nope`, "E0108"],
  ])("%s / %s reads and writes to the same code", (decls, access, code) => {
    const write = codesOf(withBody(decls, `${access} := 1`));
    const read = codesOf(withBody(`${decls}\nslot sink : Int = 0`, `sink := ${access}`));
    expect(write).toContain(code);
    expect(read).toContain(code);
    expect(write.filter((c) => c === code)).toEqual(read.filter((c) => c === code));
  });
});

const SET_REACHED: [how: string, decls: string, step: string, value: string][] = [
  [
    "a record field",
    `type Doc = { tags: Set(Text) }\nslot doc : Doc = { tags: [] }`,
    `doc.tags["a"]`,
    `"b"`,
  ],
  ["an alias", `type Tags = Set(Text)\nslot tags : Tags = []`, `tags["a"]`, `"b"`],
  ["a nominal type", `type Tags = nominal Set(Text)\nslot tags : Tags = []`, `tags["a"]`, `"b"`],
  ["an element of a List", `slot sets : List(Set(Int)) = []`, `sets[0][1]`, `2`],
  ["a value of a Map", `slot byKey : Map(Text, Set(Int)) = {}`, `byKey["a"][1]`, `2`],
  ["the payload of an Option", `slot maybe : Option(Set(Int)) = None`, `maybe.get[1]`, `2`],
];

/** A tile that shows `expr`, the smallest program that reads it. */
const shown = (decls: string, expr: string): string =>
  withApp(`${decls}\ntile App = column(text("v: " + ${expr}.show))`);

describe("an index step into a Set", () => {
  it("is E0602, naming the Set and the members that change it", () => {
    const errs = checkSource(withBody(`slot tags : Set(Int) = []`, `tags[7] := 8`));
    const e = errs.find((x) => x.code === "E0602");
    expect(e?.kind).toBe("unassignable-member");
    expect(e?.message).toContain('into "Set"');
    expect(e?.message).toContain(".add");
  });

  it("is reported once, with no type mismatch on the right-hand side behind it", () => {
    const errs = checkSource(withBody(`slot tags : Set(Int) = []`, `tags[7] := "not an Int"`));
    expect(errs.map((x) => x.code)).toEqual(["E0602"]);
  });

  it.each(SET_REACHED)("is E0602 where the Set is %s", (_how, decls, step, value) => {
    expect(codesOf(withBody(decls, `${step} := ${value}`))).toEqual(["E0602"]);
  });
});

describe("an index read into a Set", () => {
  it("is E0232, naming the Set and pointing at .has", () => {
    const errs = checkSource(shown(`slot s : Set(Int) = [5]`, `s[5]`));
    expect(errs.map((x) => x.code)).toEqual(["E0232"]);
    expect(errs[0]?.kind).toBe("index-into-set");
    expect(errs[0]?.message).toContain('into "Set"');
    expect(errs[0]?.message).toContain(".has");
  });

  it.each(SET_REACHED)("is E0232 where the Set is %s", (_how, decls, step) => {
    expect(codesOf(shown(decls, step))).toEqual(["E0232"]);
  });

  it.each([
    ["an Int", `slot n : Int = 0`, `n := s[5]`],
    ["a Bool", `slot b : Bool = false`, `b := s[5]`],
    ["an if condition", `slot n : Int = 0`, `if s[5] then n := 1`],
  ])("is reported once where %s is expected", (_how, decl, body) => {
    expect(codesOf(withBody(`slot s : Set(Int) = [5]\n${decl}`, body))).toEqual(["E0232"]);
  });

  it("is reported once as a fn body checked against its declared result", () => {
    const src = withApp(`fn f(s: Set(Int)) -> Bool = s[5]\ntile App = column(text(f([5]).show))`);
    expect(codesOf(src)).toEqual(["E0232"]);
  });

  it("leaves the step after it unjudged", () => {
    expect(codesOf(shown(`slot s : Set(Int) = [5]`, `s[5].foo`))).toEqual(["E0232"]);
  });

  // A bound control reads its target before it writes one.
  it.each([
    ["an input", `input(bind=tags["a"])`],
    ["a check", `check(bind=tags["a"])`],
  ])("is E0232 at the target of %s", (_how, control) => {
    const src = withApp(`slot tags : Set(Text) = []\ntile App = column(${control})`);
    expect(codesOf(src)).toEqual(["E0232"]);
  });
});

describe("a membership read and the other index reads stay legal", () => {
  it.each([
    ["Set.has", `slot s : Set(Int) = [5]`, `s.has(5)`],
    ["Set.has through .get", `slot maybe : Option(Set(Int)) = None`, `maybe.get.has(1)`],
    ["a List index", `slot xs : List(Int) = [1]`, `xs[0]`],
    ["a Map index", `slot m : Map(Text, Int) = {"a": 1}`, `m["a"]`],
    ["a Map keyed by a Set", `slot s : Set(Int) = []\nslot m : Map(Set(Int), Int) = {}`, `m[s]`],
  ])("accepts %s", (_how, decls, expr) => {
    expect(checkSource(shown(decls, expr))).toEqual([]);
  });

  // `{}` is the empty Map and the empty Set alike, so a fold it starts has an
  // accumulator of no known type, and a false error there is worse than silence.
  it.each([
    ["the accumulator of a fold from {}", `slot xs : List(Int) = [1]`, `xs.fold({}, $1[$2])`],
  ])("says nothing about an index into %s", (_how, decls, expr) => {
    expect(checkSource(shown(decls, expr))).toEqual([]);
  });
});

describe("an index step into a List or a Map stays legal", () => {
  it("accepts a List index write of the element type", () => {
    expect(checkSource(withBody(`slot xs : List(Int) = [1, 2, 3]`, `xs[0] := 7`))).toEqual([]);
  });

  it("checks the right-hand side of a List index write against the element type", () => {
    expect(codesOf(withBody(`slot xs : List(Int) = [1, 2, 3]`, `xs[0] := "x"`))).toContain("E0201");
  });

  it("accepts a Map index write of the value type", () => {
    expect(checkSource(withBody(`slot m : Map(Text, Int) = {}`, `m["a"] := 1`))).toEqual([]);
  });
});

describe("a List index is an Int", () => {
  const list = `slot xs : List(Int) = [1, 2, 3]\nslot picked : Int = 0`;

  it.each([
    ["Text", `slot k : Text = "0"`],
    ["Float", `slot k : Float = 0.5`],
  ])("reports a %s index on the left of := as E0201", (name, decl) => {
    const errs = checkSource(withBody(`${list}\n${decl}`, `xs[k] := 7`));
    expect(errs.map((x) => x.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Expected Int but got ${name}`);
  });

  it.each([
    ["Text", `slot k : Text = "0"`],
    ["Float", `slot k : Float = 0.5`],
  ])("reports a %s index on the right of := as E0201", (name, decl) => {
    const errs = checkSource(withBody(`${list}\n${decl}`, `picked := xs[k]`));
    expect(errs.map((x) => x.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Expected Int but got ${name}`);
  });

  it("reports a whole number spelled as text", () => {
    expect(codesOf(withBody(list, `xs["0"] := 7`))).toEqual(["E0201"]);
  });

  it("reports the index of a List reached through a field", () => {
    const decls = `type Row = { n: Int }\nslot rows : List(Row) = []\nslot k : Text = "0"`;
    expect(codesOf(withBody(decls, `rows[k].n := 7`))).toEqual(["E0201"]);
  });

  it.each([
    ["an Int slot", `slot k : Int = 0`, `xs[k] := 7`],
    ["arithmetic on an Int", `slot k : Int = 0`, `xs[k + 1] := 7`],
    ["a refinement of Int", `type Idx = Int where between(0, 2)\nslot k : Idx = 0`, `xs[k] := 7`],
    ["a negative literal", ``, `xs[-1] := 7`],
  ])("accepts %s", (_how, decl, body) => {
    expect(codesOf(withBody(`${list}\n${decl}`, body))).toEqual([]);
  });

  it("leaves a Map's key to the Map", () => {
    expect(codesOf(withBody(`slot m : Map(Text, Int) = {}`, `m["a"] := 1`))).toEqual([]);
  });
});

describe("the build agrees with check about a member write", () => {
  it("refuses to emit one", () => {
    const r = compile(withBody(`slot name : Text = "abc"`, `name.length := 9`), {
      runtimeSpecifier: "./runtime.js",
    });
    expect(r.kind === "fail" && r.errors.map((e) => e.code)).toEqual(["E0602"]);
  });

  it("emits a write to a record field named like a member as a plain key", () => {
    const js = compileOrFail(
      withBody(
        `type Ruler = { length: Int, get: Text }\nslot ruler : Ruler = {length: 0, get: "held"}`,
        `ruler.length := 1\n        ruler.get := "taken"`,
      ),
    );
    expect(js).toContain('"length"');
    expect(js).toContain('"get"');
    expect(js).not.toContain('{"get":true}');
  });

  it("emits the unwrap, then a File's structural field as a key", () => {
    const js = compileOrFail(withBody(`slot f : Option(File) = None`, `f.get.name := "x"`));
    expect(js).toContain('[{"get":true}, "name"]');
  });

  it("emits the unwrap for .get on an Option", () => {
    const js = compileOrFail(
      withBody(`slot draft : Option({title: Text}) = None`, `draft.get.title := "x"`),
    );
    expect(js).toContain('{"get":true}');
  });
});

describe("assignment through .get is an unwrap, not a field named get", () => {
  const source = (decl: string) => `slot draft : ${decl}
reducer edit on=app.start do= draft.get.title := "b"
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  function buildChecked(src: string): string {
    const program = parse(lex(src));
    check(program);
    return codegen(program, { runtimeSpecifier: "./runtime.js" }).js;
  }

  it("lowers the segment as an unwrap when the receiver is an Option", () => {
    expect(buildChecked(source("Option({title: Text}) = None"))).toContain(
      '[{"get":true}, "title"]',
    );
  });

  it("lowers it as a field when the receiver is a record that has one", () => {
    expect(buildChecked(source('{get: {title: Text}} = {get: {title: "a"}}'))).toContain(
      '["get", "title"]',
    );
  });

  it("checks the value being written against the payload's field type", () => {
    const src = `slot draft : Option({title: Text}) = None
reducer bad on=app.start do= draft.get.title := 3
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const errors = checkSource(src);
    expect(errors.map((e) => e.code)).toEqual(["E0201"]);
    expect(errors[0]?.message).toBe("Expected Text but got Int");
  });

  it("reports a member the record does not have, as the read side does", () => {
    const src = `slot rec : {title: Text} = {title: "a"}
reducer bad on=app.start do= rec.get.title := "x"
tile App = column(text(rec.title))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const errors = checkSource(src);
    expect(errors.map((e) => e.code)).toEqual(["E0108"]);
    expect(errors[0]?.message).toBe(
      'Record type has no field or method ".get" — it is a member of Map / List / Option / Result',
    );
  });

  it("keeps the name-based reading when codegen runs without check", () => {
    expect(loweredOf(source('{get: {title: Text}} = {get: {title: "a"}}'))).toContain(
      '[{"get":true}, "title"]',
    );
  });
});
