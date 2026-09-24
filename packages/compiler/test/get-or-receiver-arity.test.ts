// `.get-or` is one name with two readings, told apart by the argument count:
// `Option(T).get-or(d)` and `Map(K, V).get-or(k, d)` (stdlib.md §2.2.1 /
// §2.2.4, runtime.md §10.3.7). The count is therefore not a minimum — it is
// what *selects* the reading, and the receiver is what decides which count is
// right.
//
// A call whose count did not fit its receiver passed `check` and lowered to
// the other reading, silently:
//
//   m.get-or("k")      → `_s.getOr(m, "k")`, and `getOr` ends in
//                        `return v ?? fallback` for a value carrying no
//                        `_tag`, so the slot receives the whole map
//   opt.get-or("k", 0) → `_s.mapGetOr(opt, "k", 0)`, which indexes the Option
//                        object by a key it does not have, so the fallback is
//                        the answer on a `Some` too
//
// The second is the worse shape: a wrong value of the right type, which
// nothing downstream trips over.
//
// Neither check saw it. `METHOD_MIN_ARGS` has `get-or: 1`, so the minimum was
// met and no maximum was stated. And `getOrResultType` takes the receiver and
// the count together and resolves to nothing when they disagree — the right
// answer for an inference table, since a wrong result type rejects working
// programs, but it means inference stays silent by construction. The report
// belongs in the arity check, where the receiver is what decides the count.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** The call under test, wrapped in the smallest program that parses. */
const withCall = (decls: string, call: string): string =>
  app(`${decls}
reducer act on=ui.click(Btn)
    do= sink := ${call}
tile Btn = button(text="go")
tile App = column(Btn)`);

const errsOf = (src: string) => check(parse(lex(src)));
const codesOf = (src: string): string[] => errsOf(src).map((e) => e.code);

const MAP = `slot m : Map(Text, Int) = {}\nslot sink : Int = 0`;
const OPT = `slot o : Option(Int) = None\nslot sink : Int = 0`;
const RES = `slot r : Result(Int, Text) = Err("e")\nslot sink : Int = 0`;

describe("the receiver decides how many arguments .get-or takes", () => {
  // AC 1. One argument is the Option reading, and a Map is not an Option.
  it("rejects the Option reading on a Map, naming both readings", () => {
    const errs = errsOf(withCall(MAP, `m.get-or("k")`));
    const e = errs.find((x) => x.code === "E0213");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("call-arity-mismatch");
    // The receiver it decided on, the count it wants, and the reading the
    // written count would have selected — a message that says only "expects 2"
    // leaves the author guessing why this call is different from the one two
    // lines up.
    expect(e?.message).toContain(".get-or");
    expect(e?.message).toContain("Map");
    expect(e?.message).toContain("Option");
  });

  // AC 2. Two arguments is the Map reading, and neither of these is a Map.
  it.each([
    ["Option", OPT, `o.get-or("k", 0)`],
    ["Result", RES, `r.get-or("k", 0)`],
  ])("rejects the Map reading on %s", (name, decls, call) => {
    const errs = errsOf(withCall(decls, call));
    const e = errs.find((x) => x.code === "E0213");
    expect(e).toBeDefined();
    expect(e?.message).toContain(name);
    expect(e?.message).toContain("Map");
  });

  // The existing minimum still holds: zero arguments fits no reading at all,
  // and the lowering reads an argument it was not given.
  it("still rejects .get-or with no arguments", () => {
    expect(codesOf(withCall(OPT, `o.get-or()`))).toContain("E0213");
    expect(codesOf(withCall(MAP, `m.get-or()`))).toContain("E0213");
  });

  // A count that fits no reading on any receiver — so unlike the two cases
  // above, this one does not need the receiver to be known. Codegen emits
  // `_s.mapGetOr(recv, a0, a1)` for every count but one and drops the rest, so
  // an unreported third argument is the same silent lowering under another
  // name: it vanishes.
  it.each([
    ["a Map", MAP, `m.get-or("k", 0, 1)`],
    ["a receiver the checker cannot decide", `slot sink : Int = 0`, `$event.get-or("k", 0, 1)`],
  ])("rejects a count past both readings on %s", (_label, decls, call) => {
    expect(codesOf(withCall(decls, call))).toContain("E0213");
  });

  // On a known receiver the message stays the receiver's own, because it can
  // say which reading was meant. The count-only message is the fallback for
  // when it cannot.
  it("names the receiver when it knows it, and both readings when it does not", () => {
    const known = errsOf(withCall(MAP, `m.get-or("k", 0, 1)`)).find((e) => e.code === "E0213");
    expect(known?.message).toContain('on "Map"');

    const dynamic = errsOf(withCall(`slot sink : Int = 0`, `$event.get-or("k", 0, 1)`)).find(
      (e) => e.code === "E0213",
    );
    expect(dynamic?.message).not.toContain('on "');
    expect(dynamic?.message).toContain("(default)");
    expect(dynamic?.message).toContain("(key, default)");
  });
});

describe("what stays legal", () => {
  // The two readings the spec gives. These are called widely across the corpus,
  // so reporting either one is the expensive direction.
  it.each([
    ["the Map reading on a Map", MAP, `m.get-or("k", 0)`],
    ["the Option reading on an Option", OPT, `o.get-or(0)`],
    ["the Option reading on a Result", RES, `r.get-or(0)`],
  ])("accepts %s", (_label, decls, call) => {
    expect(errsOf(withCall(decls, call))).toEqual([]);
  });

  // `.get-or` chained onto a member that answers an `Option` — the corpus's
  // most common spelling (`nums.head.get-or(0)`), where the receiver is an
  // expression rather than a slot.
  it("accepts the Option reading on a member that answers one", () => {
    const errs = errsOf(
      withCall(`slot xs : List(Int) = []\nslot sink : Int = 0`, `xs.head.get-or(0)`),
    );
    expect(errs).toEqual([]);
  });
});

describe("a receiver the checker cannot decide stays silent", () => {
  // AC 3, for a count that *is* one of the two readings: which one is right is
  // the receiver's to say, so a receiver that says nothing gets no report.
  //
  // `$1` inside a method-call argument is the honest example. The checker
  // binds it with no type on purpose — which argument a method binds is
  // per-method, and guessing wrong costs a diagnostic on a working program —
  // so there is genuinely nothing here to decide, and the whole result can be
  // asserted.
  it("says nothing about a lambda parameter, whose type is undecided by design", () => {
    const errs = errsOf(
      withCall(`slot xs : List(Int) = []\nslot sink : List(Int) = []`, `xs.map($1.get-or(0))`),
    );
    expect(errs).toEqual([]);
  });

  it("says nothing about an event payload, which carries no declared type", () => {
    expect(codesOf(withCall(`slot sink : Int = 0`, `$event.get-or(0)`))).not.toContain("E0213");
  });

  // A declared union is a weaker case and is asserted more weakly on purpose.
  // The checker *does* know `F` is neither a container nor an unwrapping type,
  // so `.get-or` on it is a wrong program rather than an undecidable one — it
  // is simply not one this check reports, because deciding what `.get-or` on a
  // non-container should say is a per-receiver member table and a change of
  // its own. Asserting the empty list here would write that missed report into
  // the spec and break the day someone adds it.
  it("does not report the count on a union receiver", () => {
    const decls = `type F = All | Done\nslot f : F = All\nslot sink : Int = 0`;
    expect(codesOf(withCall(decls, `f.get-or(0)`))).not.toContain("E0213");
    expect(codesOf(withCall(decls, `f.get-or("k", 0)`))).not.toContain("E0213");
  });
});
