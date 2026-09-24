// A stdlib member is not an assignable lvalue (#370, language.md §1.6.3).
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
  // The issue's own repro, both halves.
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
  ])("%s / %s", (decls, body, member) => {
    const errs = errsOf(withBody(decls, body));
    expect(errs.map((x) => x.code)).toContain("E0602");
    expect(errs.find((x) => x.code === "E0602")?.message).toContain(member);
  });

  // `.get` on a receiver that does not unwrap is the same corruption, not an
  // exemption: the runtime's setter falls through an unwrap segment on a value
  // carrying no `_tag`, so the write lands on the whole slot.
  it("rejects .get on a receiver that does not unwrap", () => {
    const errs = errsOf(withBody(`slot m : Map(Text, Int) = {}`, `m.get := 1`));
    expect(errs.map((x) => x.code)).toContain("E0602");
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
  // members of types we fully understand.
  it("says nothing about a member on an undecidable receiver", () => {
    // `$event` carries no declared type, so the base type is null and the
    // write side has nothing to judge.
    const src = app(`slot seen : Text = ""
reducer act on=ui.click(Btn)
    do= $event.length := 1
tile Btn = button(text="go")
tile App = column(Btn, text(seen))`);
    expect(codesOf(src)).not.toContain("E0602");
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
});
