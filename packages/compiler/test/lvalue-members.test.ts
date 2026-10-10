import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";
import { checkSource, codesOf, textAt } from "./helpers/diagnostics.ts";
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

  // However the Set is reached, the step into it is the same step.
  it.each([
    [
      "a record field",
      `type Doc = { tags: Set(Text) }\nslot doc : Doc = { tags: [] }`,
      `doc.tags["a"] := "b"`,
    ],
    ["an alias", `type Tags = Set(Text)\nslot tags : Tags = []`, `tags["a"] := "b"`],
    ["a nominal type", `type Tags = nominal Set(Text)\nslot tags : Tags = []`, `tags["a"] := "b"`],
    ["an element of a List", `slot sets : List(Set(Int)) = []`, `sets[0][1] := 2`],
    ["a value of a Map", `slot byKey : Map(Text, Set(Int)) = {}`, `byKey["a"][1] := 2`],
    ["the payload of an Option", `slot maybe : Option(Set(Int)) = None`, `maybe.get[1] := 2`],
  ])("is E0602 where the Set is %s", (_how, decls, body) => {
    expect(codesOf(withBody(decls, body))).toEqual(["E0602"]);
  });
});

describe("an index step into a receiver with no places", () => {
  it.each([
    ["an Int", `slot n : Int = 5`, `n[0] := 7`, "Int"],
    ["a Text", `slot t : Text = "abc"`, `t[0] := "z"`, "Text"],
    ["a Bool", `slot b : Bool = false`, `b[0] := true`, "Bool"],
    ["an Option", `slot o : Option(Int) = Some(1)`, `o[0] := 5`, "Option(Int)"],
    ["a Result", `slot res : Result(Int, Text) = Ok(1)`, `res[0] := 5`, "Result(Int, Text)"],
    ["a Tuple", `slot p : Tuple(Int, Int) = (1, 2)`, `p[0] := 3`, "Tuple(Int, Int)"],
    ["a union", `type Filter = All | Done\nslot f : Filter = All`, `f[0] := Done`, "Filter"],
    ["a record", `type R = { a: Int }\nslot r : R = { a: 1 }`, `r[0] := 2`, "R"],
    ["an alias of Int", `type Count = Int\nslot c : Count = 0`, `c[0] := 1`, "Count"],
    ["a List's Int element", `slot xs : List(Int) = [1, 2, 3]`, `xs[0][0] := 9`, "Int"],
    ["a Map's Text value", `slot m : Map(Text, Text) = {}`, `m["k"][0] := "v"`, "Text"],
    ["an Option's payload", `slot o : Option(Int) = Some(1)`, `o.get[0] := 5`, "Int"],
  ])("is E0602 on %s, at the step and alone", (_what, decls, body, name) => {
    const src = withBody(decls, body);
    const errs = checkSource(src);
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.kind).toBe("unassignable-member");
    expect(errs[0]?.message).toBe(
      `Cannot assign through an index into "${name}": an index names a place only in a Map or a List`,
    );
    expect(textAt(src, defined(errs[0], "an E0602").pos)).toBe(body.slice(body.lastIndexOf("[")));
  });

  it("is E0602 on a record, and a key that names one of its fields gets that field's step", () => {
    const decls = `type R = { a: Int }\nslot r : R = { a: 1 }`;
    const errs = checkSource(withBody(decls, `r["a"] := "oops"`));
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).toBe(
      `Cannot assign through an index into "R": an index names a place only in a Map or a List — write the field step ".a"`,
    );
    expect(codesOf(withBody(decls, `r.a := "oops"`))).toEqual(["E0201"]);
  });

  it.each([
    ["a key that is no field of the record", `r["b"] := 2`],
    ["a key that is not written as a literal", `r[k] := 2`],
  ])("names no field step for %s", (_what, body) => {
    const decls = `type R = { a: Int }\nslot r : R = { a: 1 }\nslot k : Text = "a"`;
    const errs = checkSource(withBody(decls, body));
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).not.toContain("field step");
  });

  it("reports the first step that names no place, not every step after it", () => {
    const body = `n[0][1] := 7`;
    const src = withBody(`slot n : Int = 5`, body);
    const errs = checkSource(src);
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).toContain('into "Int"');
    expect(textAt(src, defined(errs[0], "an E0602").pos)).toBe(body.slice(body.indexOf("[")));
  });

  it("stays silent on a receiver whose type is not known", () => {
    const errs = checkSource(withBody(`slot u : Mystery = 0`, `u[0] := 1`));
    expect(errs.map((e) => e.code)).toEqual(["E0117"]);
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
