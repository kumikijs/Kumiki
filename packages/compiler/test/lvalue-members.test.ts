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
    [`slot xs : List(Int) = []`, `xs.size := 0`, ".size"],
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
  it("reports a numeric-only member on a non-numeric receiver as E0108, not E0602", () => {
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
// with the code a member gets, rather than lowered to a write that turned the
// Set into something else.
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

  it("is reported where the Set is reached through a record field", () => {
    const errs = errsOf(
      withBody(
        `type Doc = { tags: Set(Text) }\nslot doc : Doc = { tags: [] }`,
        `doc.tags["a"] := "b"`,
      ),
    );
    expect(errs.map((x) => x.code)).toEqual(["E0602"]);
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
