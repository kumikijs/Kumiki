// A stdlib member is not an assignable lvalue (language.md §1.6.3).
//
// The read side and the write side answer the same question about `recv.member`
// — a record's own field wins, otherwise the name is a member — but the write
// side only knew how to answer it for a record. For every other receiver whose
// type is known it recorded "shortcut" and said nothing, so the member name
// became a literal key and the write replaced the slot with a record: `name`
// declared `Text` ended up holding `{"length": 9}`, which is not a `Text`, not
// a value any reader can use, and reported by nothing until a render tripped
// over it.
//
// The lvalue step set is closed — a field, an index, and `.get` where §1.6.3
// defines it — so a member is E0602. The receiver has to be understood first:
// a type the checker cannot decide raises nothing here, exactly as it raises
// nothing on the read side, because a false error on a dynamic receiver is
// worse than the silence.
//
// Both sides ask one classifier, `classifyMember`, so "what is this name on
// this receiver" has a single answer. The tests below pin the answer from each
// side, and the last block pins that the two sides give the same one.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { defined } from "./helpers/defined.ts";

const errsOf = (src: string) => check(parse(lex(src)));
const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** The reducer body under test, wrapped in the smallest program that parses. */
const withBody = (decls: string, body: string): string =>
  app(`${decls}
reducer act on=ui.click(Btn)
    do= ${body}
tile Btn = button(text="go")
tile App = column(Btn)`);

const codesOf = (src: string): string[] => errsOf(src).map((e) => e.code);

describe("a member is not an assignable lvalue", () => {
  // The reported program, both halves.
  it("rejects a shortcut on a scalar, naming the member and the receiver", () => {
    const errs = errsOf(withBody(`slot name : Text = "abc"`, `name.length := 9`));
    const e = errs.find((x) => x.code === "E0602");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("unassignable-member");
    expect(e?.message).toContain(".length");
    expect(e?.message).toContain("Text");
  });

  it("rejects a shortcut on a container", () => {
    const errs = errsOf(withBody(`slot maybe : Option(Text) = None`, `maybe.is-some := 0`));
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(".is-some");
  });

  // Each of these used to pass `check` and replace the slot with a record.
  it.each([
    [`slot xs : List(Int) = []`, `xs.length := 0`, ".length"],
    [`slot xs : List(Int) = []`, `xs.head := 1`, ".head"],
    [`slot s : Text = ""`, `s.upper := "X"`, ".upper"],
    [`slot n : Int = 0`, `n.abs := 1`, ".abs"],
    [`slot m : Map(Text, Int) = {}`, `m.keys := []`, ".keys"],
    [`slot st : Set(Int) = []`, `st.size := 0`, ".size"],
  ])("%s / %s", (decls, body, member) => {
    const errs = errsOf(withBody(decls, body));
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(member);
  });

  // A record's own field wins, and a name it does not declare is dispatched to
  // the stdlib — so `.show`, which every value has, is a *member* of a record
  // and not an undefined one. The read side has always accepted it. Under the
  // closed step set the write is E0602, the same answer any other member gets,
  // rather than the "no such field" the write side used to give.
  it("rejects .show on a record, the one member every value has", () => {
    const errs = errsOf(
      withBody(`type Rec = { title: Text }\nslot rec : Rec = { title: "" }`, `rec.show := "x"`),
    );
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(".show");
  });

  // `.get` on a receiver that does not unwrap is the same corruption, not an
  // exemption: the runtime's setter falls through an unwrap segment on a value
  // carrying no `_tag`, so the write lands on the whole slot.
  it.each([
    [`slot m : Map(Text, Int) = {}`, `m.get := 1`],
    [`slot xs : List(Int) = []`, `xs.get := 1`],
  ])("rejects .get on %s, which does not unwrap", (decls, body) => {
    expect(codesOf(withBody(decls, body))).toContain("E0602");
  });
});

describe("what stays legal", () => {
  // §1.6.3 defines this one, and it is the reason the set is "closed except
  // `.get`" rather than simply closed.
  it("accepts .get on an Option, which §1.6.3 defines", () => {
    const errs = errsOf(
      withBody(`slot draft : Option({title: Text}) = None`, `draft.get.title := "x"`),
    );
    expect(errs).toEqual([]);
  });

  it("accepts .get on a Result", () => {
    const errs = errsOf(
      withBody(`slot r : Result({title: Text}, Text) = Err("no")`, `r.get.title := "x"`),
    );
    expect(errs).toEqual([]);
  });

  // The name is dispatched, not reserved (§1.6.3). A record that declares a
  // field named like a shortcut is still written through it — otherwise this
  // fix would have made a working program report.
  it.each(["length", "size", "get", "head", "keys"])("accepts a record field named %s", (field) => {
    const errs = errsOf(
      withBody(
        `type Rec = { ${field}: Int }\nslot rec : Rec = { ${field}: 0 }`,
        `rec.${field} := 1`,
      ),
    );
    expect(errs).toEqual([]);
  });

  // `File` is a scalar to the type system and a record to the runtime, so its
  // metadata fields are structural fields rather than members (stdlib.md §2.1)
  // — a field, and therefore an lvalue. This is the one receiver where the
  // "field" answer comes from somewhere other than a record declaration, and
  // it is reached through `.get`, so both exceptions are in one expression.
  it("accepts a File's structural field, through the unwrap", () => {
    const errs = errsOf(withBody(`slot f : Option(File) = None`, `f.get.name := "x"`));
    expect(errs).toEqual([]);
  });

  it("accepts a plain field and an index, the other two steps §1.6.3 gives", () => {
    const errs = errsOf(
      withBody(
        `type Rec = { title: Text }\nslot rows : List(Rec) = []\nslot rec : Rec = { title: "" }`,
        `rec.title := "x"\n        rows[0].title := "y"`,
      ),
    );
    expect(errs).toEqual([]);
  });
});

describe("a receiver the checker cannot decide stays silent", () => {
  // The read side's policy, which the write side now shares: we only flag
  // members of types we fully understand. A union resolves to a type — so the
  // lvalue is checked, the base type is not null, and the classifier is asked
  // — but not to a shape with members, so there is nothing to judge.
  //
  // The whole result is asserted, not the absence of one code: this passes
  // only if the checker reaches the member and declines to speak, and fails if
  // it reports anything at all about the program.
  it("says nothing about a member on a union-typed receiver", () => {
    const errs = errsOf(
      withBody(
        `type Filter = All | Active | Done\nslot filter : Filter = All`,
        `filter.length := 1`,
      ),
    );
    expect(errs).toEqual([]);
  });

  it("says nothing on the read side either, for the same receiver", () => {
    const errs = errsOf(
      withBody(
        `type Filter = All | Active | Done\nslot filter : Filter = All\nslot n : Int = 0`,
        `n := filter.length`,
      ),
    );
    expect(errs).toEqual([]);
  });
});

describe("the write side answers the read side's question too", () => {
  // Not a member at all, on a receiver that is understood. The read side calls
  // this E0108; the write side used to call it nothing.
  it("reports an unknown member on a known receiver as E0108", () => {
    const errs = errsOf(withBody(`slot name : Text = "abc"`, `name.frist := 9`));
    expect(errs.map((x) => x.code)).toContain("E0108");
  });

  it("still reports an unknown member on a record as E0108", () => {
    const errs = errsOf(
      withBody(`type Rec = { title: Text }\nslot rec : Rec = { title: "" }`, `rec.nope := 1`),
    );
    expect(errs.map((x) => x.code)).toContain("E0108");
  });

  // A member that exists, but not on this receiver. `.abs` is a method of the
  // numeric prims, so on a `Text` it is not a member being written through —
  // it is not a member at all, and E0602's sentence ("it is a member of
  // \"Text\"") would be false. The read side has always said so; saying
  // something else here would make the same expression two different errors
  // depending on which side of `:=` it landed on.
  it("reports a member of a number on a non-numeric receiver as E0108, not E0602", () => {
    const errs = errsOf(withBody(`slot s : Text = ""`, `s.abs := 1`));
    expect(errs.map((x) => x.code)).toEqual(["E0108"]);
    expect(errs[0]?.message).toContain("Int / Float");
  });

  // The guard on the whole arrangement: one classifier, so one answer. Each
  // expression is checked as an lvalue and as an rvalue, and the codes have to
  // match. A branch added to one side and not the other fails here.
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

// An index step is one of §1.6.3's three, but only on a receiver that has a
// place for it to name. A `List` index names a position and a `Map` index names
// an entry; a `Set` has membership and nothing else, so `s[x] := v` is refused
// with the code a member gets.
describe("an index step into a Set", () => {
  it("is E0602, naming the Set and the members that change it", () => {
    const errs = errsOf(withBody(`slot tags : Set(Int) = []`, `tags[7] := 8`));
    const e = errs.find((x) => x.code === "E0602");
    expect(e?.kind).toBe("unassignable-member");
    expect(e?.message).toContain('into "Set"');
    expect(e?.message).toContain(".add");
  });

  it("is reported once, with no type mismatch on the right-hand side behind it", () => {
    const errs = errsOf(withBody(`slot tags : Set(Int) = []`, `tags[7] := "not an Int"`));
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

// A `Map` and a `List` are the only receivers an index names a place in
// (§1.6.3). Any other receiver whose type is known has none for it to name — a
// record has fields, a scalar has no inside, an `Option` is reached through
// `.get` — so the step is refused with the code a `Set` index gets, at the step
// itself. Let through, the right-hand side would be checked against nothing,
// and the write would land under a literal key (`r["a"] := "oops"` puts a Text
// in an Int field) or panic at run time.
describe("an index step into a receiver with no places", () => {
  /**
   * Where the `[` at offset `step` of the reducer body sits in `src` — the
   * position the step that has no place is reported at.
   */
  const stepPos = (src: string, body: string, step: number) => {
    const lines = src.split("\n");
    const at = lines.findIndex((l) => l.endsWith(`do= ${body}`));
    const line = defined(lines[at], `a line ending in ${body}`);
    return { line: at + 1, col: line.length - body.length + step + 1 };
  };

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
    const errs = errsOf(src);
    // Alone: the step has no place, so there is no type for the right-hand
    // side to be checked against, and nothing behind the E0602.
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.kind).toBe("unassignable-member");
    expect(errs[0]?.message).toBe(
      `Cannot assign through an index into "${name}": an index names a place only in a Map or a List`,
    );
    // The last `[` of each body opens the step that has no place.
    expect(errs[0]?.pos).toEqual(stepPos(src, body, body.lastIndexOf("[")));
  });

  // The reported program. The field-path spelling of the same write is E0201
  // against the field's type; the index spelling names no place, and a key that
  // is one of the record's fields is answered with that field's step.
  it("is E0602 on a record, and a key that names one of its fields gets that field's step", () => {
    const decls = `type R = { a: Int }\nslot r : R = { a: 1 }`;
    const errs = errsOf(withBody(decls, `r["a"] := "oops"`));
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
    const errs = errsOf(withBody(decls, body));
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).not.toContain("field step");
  });

  // One refusal per write: past the step that names no place, the path has no
  // type, so the steps after it are not judged again.
  it("reports the first step that names no place, not every step after it", () => {
    const body = `n[0][1] := 7`;
    const src = withBody(`slot n : Int = 5`, body);
    const errs = errsOf(src);
    expect(errs.map((e) => e.code)).toEqual(["E0602"]);
    expect(errs[0]?.message).toContain('into "Int"');
    expect(errs[0]?.pos).toEqual(stepPos(src, body, body.indexOf("[")));
  });

  // The other side of the line: a receiver whose type is not known has no
  // answer to give about its places, so it stays silent rather than guess. A
  // name that resolves to no type is reported once, where the type is written.
  it("stays silent on a receiver whose type is not known", () => {
    const errs = errsOf(withBody(`slot u : Mystery = 0`, `u[0] := 1`));
    expect(errs.map((e) => e.code)).toEqual(["E0117"]);
  });
});

describe("an index step into a List or a Map stays legal", () => {
  it("accepts a List index write of the element type", () => {
    expect(errsOf(withBody(`slot xs : List(Int) = [1, 2, 3]`, `xs[0] := 7`))).toEqual([]);
  });

  it("checks the right-hand side of a List index write against the element type", () => {
    expect(codesOf(withBody(`slot xs : List(Int) = [1, 2, 3]`, `xs[0] := "x"`))).toContain("E0201");
  });

  it("accepts a Map index write of the value type", () => {
    expect(errsOf(withBody(`slot m : Map(Text, Int) = {}`, `m["a"] := 1`))).toEqual([]);
  });
});

// A List index names a position, and a position is an `Int` (§1.6.3). Any other
// index is a mistake the checker can see, so it is reported rather than left to
// name no element at run time — on both sides of `:=`, since the read and the
// write name the same element.
describe("a List index is an Int", () => {
  const list = `slot xs : List(Int) = [1, 2, 3]\nslot picked : Int = 0`;

  it.each([
    ["Text", `slot k : Text = "0"`],
    ["Float", `slot k : Float = 0.5`],
  ])("reports a %s index on the left of := as E0201", (name, decl) => {
    const errs = errsOf(withBody(`${list}\n${decl}`, `xs[k] := 7`));
    expect(errs.map((x) => x.code)).toEqual(["E0201"]);
    expect(errs[0]?.message).toBe(`Expected Int but got ${name}`);
  });

  it.each([
    ["Text", `slot k : Text = "0"`],
    ["Float", `slot k : Float = 0.5`],
  ])("reports a %s index on the right of := as E0201", (name, decl) => {
    const errs = errsOf(withBody(`${list}\n${decl}`, `picked := xs[k]`));
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
