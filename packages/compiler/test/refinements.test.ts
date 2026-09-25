// The twelve registered predicates (language.md §1.3.3) as runtime checks.
//
// Seven of them used to reach the runtime as `(_v) => true`: the parser
// accepted the name and `refinementToJs` ended in a `default` arm that lowered
// anything it did not implement to a check that cannot fail, so
// `slot n : Int where positive` accepted -7 (#352). The two lists are one table
// now, and these drive every entry of it through the predicate it emits.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import type { Refinement, SlotDef } from "../src/ast.ts";
import { REFINEMENT_PREDS, refinementProblem, refinementToJs } from "../src/refinements.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const NO_POS = { line: 0, col: 0 };
const refinement = (pred: string, args: (number | string)[] = []): Refinement => ({
  kind: "Refinement",
  pred,
  args,
  pos: NO_POS,
});

/** The predicate a slot of this refinement would be given, as a callable. */
function predicate(pred: string, args: (number | string)[] = []): (v: unknown) => boolean {
  const js = refinementToJs(refinement(pred, args));
  if (js === undefined) throw new Error(`"${pred}" lowers to nothing`);
  return new Function(`return (${js});`)() as (v: unknown) => boolean;
}

const TAIL = `tile B = button(text="b")
tile App = column(B)
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
const codes = (src: string): string[] => check(parse(lex(`${src}\n${TAIL}`))).map((e) => e.code);

/** A well-formed argument list per predicate, for the sweeps below. */
const ARGS_FOR: Record<string, (number | string)[]> = {
  between: [0, 3],
  "len-eq": [3],
  "len-lt": [3],
  "len-gt": [3],
  regex: ["[a-z]+"],
  "one-of": ["sm", "md"],
};

describe("the registered set is the one the spec lists", () => {
  // §1.3.3 is a code block of names, one call shape each. A predicate added to
  // the document and not to the table is a name the parser rejects; one added
  // to the table and not the document is a check nothing specifies.
  it("matches language.md §1.3.3", () => {
    const spec = readFileSync(path.join(repoRoot, "docs", "spec", "language.md"), "utf8");
    const section = spec.split("### 1.3.3 Registered Refinement Predicates")[1] ?? "";
    const block = section.split("```")[1] ?? "";
    // Argument positions carry names of their own (`regex("pattern")`), and
    // they are not predicates — the name is what precedes the call.
    const listed = new Set(block.replace(/\([^)]*\)/g, "").match(/[a-z][a-z-]*/g) ?? []);
    expect([...listed].sort()).toEqual([...REFINEMENT_PREDS].sort());
  });

  it("lowers every one of them to a check", () => {
    const unlowered = [...REFINEMENT_PREDS].filter(
      (p) => refinementToJs(refinement(p, ARGS_FOR[p] ?? [])) === undefined,
    );
    expect(unlowered).toEqual([]);
  });
});

describe("what each predicate accepts and refuses", () => {
  const cases: [string, (number | string)[], unknown[], unknown[]][] = [
    ["between", [0, 3], [0, 1.5, 3], [-1, 4, "2", null]],
    ["nonempty", [], ["a", " "], ["", 1, null]],
    ["len-eq", [3], ["abc"], ["ab", "abcd", 3]],
    ["len-lt", [3], ["", "ab"], ["abc", "abcd"]],
    ["len-gt", [3], ["abcd"], ["abc", ""]],
    ["positive", [], [1, 0.5, 1e9], [0, -1, "1", null]],
    ["negative", [], [-1, -0.5], [0, 1, "-1", null]],
    [
      "email",
      [],
      ["ada@example.com", "a.b+c@sub.example.co.jp"],
      ["", "not-an-email", "ada@example", "ada @example.com", "a@b@c.com", 1],
    ],
    [
      "url",
      [],
      ["https://kumiki.dev", "http://localhost:3000/p?q=1#f"],
      ["kumiki.dev", "https://", "javascript:alert(1)", "", 1],
    ],
    [
      "uuid",
      [],
      ["3f2504e0-4f89-11d3-9a0c-0305e82c3301", "3F2504E0-4F89-11D3-9A0C-0305E82C3301"],
      ["nope", "3f2504e0-4f89-11d3-9a0c-0305e82c330", "3f2504e04f8911d39a0c0305e82c3301", 1],
    ],
    ["regex", ["[a-z]+"], ["abc"], ["abc1", "", "ABC", 1]],
    // Anchored: a pattern is a description of the whole value, not of a part
    // of it, or `regex("[0-9]{4}")` would accept a postcode with a letter in
    // front of it.
    ["regex", ["b"], ["b"], ["abc"]],
    ["one-of", ["sm", "md", "lg"], ["sm", "lg"], ["xl", "", 1, null]],
    ["one-of", [1, 2], [1, 2], [3, "1", null]],
  ];

  for (const [pred, args, accepted, refused] of cases) {
    const label = args.length > 0 ? `${pred}(${args.join(", ")})` : pred;
    it(`${label} accepts what it should`, () => {
      const p = predicate(pred, args);
      expect(accepted.filter((v) => !p(v))).toEqual([]);
    });
    it(`${label} refuses what it should`, () => {
      const p = predicate(pred, args);
      expect(refused.filter((v) => p(v))).toEqual([]);
    });
  }

  // Every predicate is handed whatever the slot's type admits, and a reducer
  // can put `None` or a record there. A check that throws would take the mount
  // down instead of refusing the write.
  it("refuses a value of the wrong shape rather than throwing", () => {
    for (const pred of REFINEMENT_PREDS) {
      const p = predicate(pred, ARGS_FOR[pred] ?? []);
      for (const v of [undefined, null, {}, [], Number.NaN]) {
        expect(p(v), `${pred} on ${String(v)}`).toBe(false);
      }
    }
  });
});

describe("a predicate with no lowering is a diagnostic, not a pass", () => {
  it("lowers an unknown predicate to nothing at all", () => {
    expect(refinementToJs(refinement("cube-free"))).toBeUndefined();
  });

  it("describes it as unimplemented", () => {
    expect(refinementProblem(refinement("cube-free"))?.kind).toBe("unimplemented-refinement");
  });

  // The parser rejects an unregistered name, so the only way into this state
  // is a table that grew a name without a lowering. Reaching it through the
  // AST is what keeps E0803 wired to the checker rather than merely written
  // down in it.
  it("reports E0803 when the checker meets one", () => {
    const program = parse(lex(`slot n : Int where positive = 1\n${TAIL}`));
    const slot = program.defs.find((d): d is SlotDef => d.kind === "SlotDef");
    if (slot?.type.kind !== "TypeRefinement") throw new Error("expected a refined slot");
    (slot.type.refinement as { pred: string }).pred = "cube-free";
    expect(check(program).map((e) => [e.code, e.kind])).toContainEqual([
      "E0803",
      "unimplemented-refinement",
    ]);
  });
});

describe("arguments a predicate cannot be built from are reported", () => {
  const bad: [string, string][] = [
    ["between with one bound", `slot n : Int where between(0) = 1`],
    ["between with a text bound", `slot n : Int where between(0, "x") = 1`],
    ["between with three", `slot n : Int where between(0, 1, 2) = 1`],
    ["an empty range", `slot n : Int where between(5, 1) = 1`],
    ["a fractional length", `slot s : Text where len-eq(2.5) = "ab"`],
    ["a negative length", `slot s : Text where len-gt(-1) = "ab"`],
    ["a length that is text", `slot s : Text where len-lt("3") = "ab"`],
    ["a pattern that is a number", `slot s : Text where regex(3) = "a"`],
    ["a pattern that does not compile", `slot s : Text where regex("(") = "a"`],
    // A pattern that fails on its own and parses once wrapped: `^(?:a)|(b)$`
    // is `^(?:a)` OR `(b)$`, so the value would be matched unanchored against
    // a pattern the author did not write.
    ["a pattern that escapes the anchors", `slot s : Text where regex("a)|(b") = "a"`],
    [
      "a pattern whose parentheses close the anchor group",
      `slot s : Text where regex("a)(b") = "a"`,
    ],
    ["one-of with nothing to choose from", `slot s : Text where one-of() = "a"`],
    ["an argument to a predicate that takes none", `slot s : Text where nonempty(1) = "a"`],
  ];

  for (const [label, src] of bad) {
    it(`reports ${label}`, () => {
      expect(codes(src)).toContain("E0804");
    });
  }

  // errors.md quotes these, and a message that drifts from the catalogue is a
  // diagnostic whose documentation answers a different question than the tool.
  it("emits the messages errors.md documents", () => {
    const messageFor = (src: string): string =>
      check(parse(lex(`${src}\n${TAIL}`)))
        .filter((e) => e.code === "E0804")
        .map((e) => e.message)
        .join("");
    expect(messageFor(`slot n : Int where between(0) = 1`)).toBe(
      'Refinement "between" takes 2 argument(s) but got 1',
    );
    expect(messageFor(`slot n : Int where between(0, "x") = 1`)).toBe(
      'Refinement "between" takes a number but argument 2 is "x"',
    );
    expect(messageFor(`slot s : Text where one-of() = "a"`)).toBe(
      'Refinement "one-of" needs at least 1 value(s) but got 0',
    );
    expect(messageFor(`slot n : Int where between(5, 1) = 1`)).toBe(
      "Refinement between(5, 1) has a lower bound above its upper bound, so no value satisfies it",
    );
    expect(messageFor(`slot s : Text where regex("(") = "a"`)).toMatch(
      /^Refinement regex\("\("\) is not a pattern: /,
    );
  });

  it("pairs E0804 with its kind", () => {
    const errors = check(parse(lex(`slot n : Int where between(0) = 1\n${TAIL}`)));
    expect(errors.map((e) => [e.code, e.kind])).toContainEqual([
      "E0804",
      "refinement-args-invalid",
    ]);
  });

  const good = [
    `slot n : Int where between(0, 3) = 1`,
    `slot n : Int where between(-40, -1) = -1`,
    `slot n : Float where between(0.0, 1.0) = 0.5`,
    `slot s : Text where len-eq(0) = ""`,
    `slot s : Text where nonempty = "a"`,
    `slot s : Text where regex("[a-z]+(-[a-z]+)*") = "a-b"`,
    `slot s : Text where one-of("sm") = "sm"`,
    `slot n : Int where one-of(1, 2, 3) = 1`,
    `type Score = nominal Int where positive\nslot s : Score = 1`,
  ];

  for (const src of good) {
    it(`accepts ${src.split("\n").slice(-1)[0]}`, () => {
      expect(codes(src)).not.toContain("E0804");
    });
  }
});

// Every predicate lowers to a check guarded by the shape it tests, so one
// written over a base type it cannot test refuses every value — the slot takes
// nothing from then on. It is E0804's own defect reached from the other side:
// not arguments no value can satisfy, but a base no value of which can.
describe("a predicate over a base type it cannot test is reported", () => {
  /** Every diagnostic, as `code line:col`, for the program and the shared tail. */
  const diagnostics = (src: string): string[] =>
    check(parse(lex(`${src}\n${TAIL}`))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col}`);

  // Each of these is otherwise a valid program, so the whole list is exactly
  // one E0804 — at the `where` that asks the question, or at the application
  // that puts a generic's question over the wrong base.
  const bad: [string, string, string][] = [
    // One row per column of the §1.3.3 pairing: the text family over a number…
    ["nonempty over Int", `slot n : Int where nonempty = 1`, "1:20"],
    ["len-eq over Int", `slot n : Int where len-eq(2) = 1`, "1:20"],
    ["len-lt over Float", `slot n : Float where len-lt(2) = 1.0`, "1:22"],
    ["len-gt over Time", `slot n : Time where len-gt(2) = now`, "1:21"],
    ["email over Int", `slot n : Int where email = 1`, "1:20"],
    ["url over Bool", `slot b : Bool where url = true`, "1:21"],
    ["uuid over Int", `slot n : Int where uuid = 1`, "1:20"],
    ["regex over Int", `slot n : Int where regex("[0-9]+") = 1`, "1:20"],
    // …and the numeric family over text.
    ["between over Text", `slot s : Text where between(0, 3) = "a"`, "1:21"],
    ["positive over Text", `slot s : Text where positive = "ada"`, "1:21"],
    ["negative over Text", `slot s : Text where negative = "a"`, "1:21"],
    // A structural type is not a base either predicate tests.
    ["nonempty over a record", `slot r : {a: Text} where nonempty = {a: "x"}`, "1:26"],
    ["positive over a list", `slot l : List(Int) where positive = []`, "1:26"],
    ["nonempty over a union", `type Sz = Sm | Md\nslot u : Sz where nonempty = Sm`, "2:19"],
    // The base is read through the chain the refinement is: an alias, a
    // `nominal`, an earlier `where`.
    [
      "positive under a nominal over Text",
      `type Handle = nominal Text\nslot h : Handle where positive = "a"`,
      "2:23",
    ],
    [
      "nonempty over an alias of Int",
      `type Count = Int where between(0, 9)\nslot c : Count where nonempty = 1`,
      "2:22",
    ],
    [
      "a second where over the wrong base",
      `slot s : Text where nonempty where positive = "a"`,
      "1:36",
    ],
    [
      "a predicate folded onto a nominal",
      `type Id = nominal Int where uuid\nslot i : Id = 1`,
      "1:29",
    ],
    // A refinement is judged wherever a type is written, not only on a slot.
    ["a record field", `slot r : {a: Text where positive} = {a: "x"}`, "1:25"],
    ["a union payload", `type U = Idle | Got(Text where positive)\nslot u : U = Idle`, "1:32"],
    ["a fn parameter", `fn f(x: Text where positive) -> Int = 1`, "1:20"],
    ["a tile's in=", `tile T in=Text where positive = text($1)`, "1:22"],
    // A generic's own parameter says nothing until it is applied — and then
    // the argument is the base, judged at the application.
    [
      "a generic applied over the wrong base",
      `type NonEmpty(T) = T where nonempty\nslot n : NonEmpty(Int) = 1`,
      "2:10",
    ],
    [
      "a generic applied through an alias",
      `type NonEmpty(T) = T where nonempty\ntype N = NonEmpty(Int)\nslot n : N = 1`,
      "2:10",
    ],
    [
      "a nominal generic applied over the wrong base",
      `type W(T) = nominal T where positive\nslot w : W(Text) = "a"`,
      "2:10",
    ],
    [
      "a generic whose body applies another generic",
      `type NonEmpty(T) = T where nonempty\ntype W(T) = NonEmpty(T)\nslot w : W(Int) = 1`,
      "3:10",
    ],
    [
      "a generic whose refinement is on a record field",
      `type Box(T) = {v: T where positive}\nslot b : Box(Text) = {v: "a"}`,
      "2:10",
    ],
    [
      "a generic applied inside a container in another generic",
      `type NonEmpty(T) = T where nonempty\ntype L(T) = List(NonEmpty(T))\nslot l : L(Int) = []`,
      "3:10",
    ],
    [
      "a generic applied inside a fn parameter",
      `type NonEmpty(T) = T where nonempty\nfn f(x: NonEmpty(Int)) -> Int = 1`,
      "2:9",
    ],
    // `one-of` lowers to a strict `includes`, so a choice whose type is not
    // the base's is one no value of the slot equals.
    ["one-of numbers over Text", `slot s : Text where one-of(1, 2) = "a"`, "1:21"],
    ["one-of text over Int", `slot n : Int where one-of("1") = 1`, "1:20"],
    [
      "one-of with one choice of the wrong type",
      `slot s : Text where one-of("a", 1) = "a"`,
      "1:21",
    ],
    ["one-of over Bool", `slot b : Bool where one-of("x") = true`, "1:21"],
    [
      "one-of over a nominal Text",
      `type Size = nominal Text\nslot s : Size where one-of(1) = "a"`,
      "2:21",
    ],
    [
      "one-of applied through a generic",
      `type Pick(T) = T where one-of("a", "b")\nslot p : Pick(Int) = 1`,
      "2:10",
    ],
  ];

  for (const [label, src, at] of bad) {
    it(`reports ${label}`, () => {
      expect(diagnostics(src)).toEqual([`E0804 ${at}`]);
    });
  }

  // Both applications put `nonempty` over `Int`: the inner one directly, the
  // outer one through its argument. Each is its own refinement no value of the
  // slot satisfies, so each is reported where it was applied.
  it("reports each application of a nested generic", () => {
    expect(
      diagnostics(`type NonEmpty(T) = T where nonempty\nslot n : NonEmpty(NonEmpty(Int)) = 1`),
    ).toEqual(["E0804 2:10", "E0804 2:19"]);
  });

  // `P2(T, Int)` puts `nonempty` over `Int` whatever `T` is, so the definition
  // of `W` is where it is wrong and where it is reported; applying `W` brings
  // nothing new and reports nothing more.
  it("reports a problem no argument brings once, where it is written", () => {
    expect(
      diagnostics(`type P2(A, B) = B where nonempty\ntype W(T) = P2(T, Int)\nslot w : W(Text) = 1`),
    ).toEqual(["E0804 2:13"]);
  });

  // Two `where`s, each over a base it cannot test: two refinements, two
  // reports, each at its own `where`.
  it("reports every refinement of a chain at its own position", () => {
    expect(diagnostics(`slot s : Text where positive where negative = "a"`)).toEqual([
      "E0804 1:36",
      "E0804 1:21",
    ]);
  });

  // A chain that closes on itself has no base to judge: E0009 names it, and
  // an E0804 on top would describe a type that does not exist.
  it("leaves a cycle to E0009", () => {
    expect(diagnostics(`type A = B where positive\ntype B = A\nslot a : A = 1`)).toEqual([
      "E0009 1:10",
    ]);
    expect(
      diagnostics(`type NonEmpty(T) = T where nonempty\ntype A = NonEmpty(A)\nslot a : A = "x"`),
    ).toEqual(["E0009 2:19"]);
  });

  // An undefined constructor is as opaque as an undefined name: E0117 is the
  // report, and the base it would have named does not exist.
  it("leaves an undefined type application to E0117", () => {
    const codes = check(parse(lex(`slot x : Foo(Int) where nonempty = 1\n${TAIL}`))).map(
      (e) => e.code,
    );
    expect(codes).toContain("E0117");
    expect(codes).not.toContain("E0804");
  });

  it("names what the predicate tests and the base it was written over", () => {
    const messageFor = (src: string): string =>
      check(parse(lex(`${src}\n${TAIL}`)))
        .filter((e) => e.code === "E0804")
        .map((e) => e.message)
        .join("");
    expect(messageFor(`slot s : Text where positive = "a"`)).toBe(
      'Refinement "positive" tests a number but is written over Text, so no value satisfies it',
    );
    expect(messageFor(`slot n : Int where nonempty = 1`)).toBe(
      'Refinement "nonempty" tests text but is written over Int, so no value satisfies it',
    );
    expect(messageFor(`slot b : Bool where one-of("x") = true`)).toBe(
      'Refinement "one-of" tests text or a number but is written over Bool, so no value satisfies it',
    );
    expect(messageFor(`slot s : Text where one-of("a", 1) = "a"`)).toBe(
      'Refinement "one-of" lists 1 (argument 2) but is written over Text, so no value equals it',
    );
    expect(messageFor(`type NonEmpty(T) = T where nonempty\nslot n : NonEmpty(Int) = 1`)).toBe(
      'Refinement "nonempty" tests text but NonEmpty(Int) applies it over Int, so no value satisfies it',
    );
    expect(messageFor(`type Pick(T) = T where one-of("a", "b")\nslot p : Pick(Int) = 1`)).toBe(
      'Refinement "one-of" lists "a" (argument 1) but Pick(Int) applies it over Int, so no value equals it',
    );
  });

  // `len-lt(0)` is well formed — `0` is a count — and still refuses every
  // text, since no length is below zero: the same slot that takes nothing,
  // reached through a legal argument.
  it("reports len-lt(0)", () => {
    const errors = check(parse(lex(`slot s : Text where len-lt(0) = ""\n${TAIL}`)));
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ["E0804", "Refinement len-lt(0) is shorter than every text, so no value satisfies it"],
    ]);
  });

  // Each of these is a valid program, so nothing at all is reported.
  const good = [
    `type Handle = nominal Text\nslot h : Handle where nonempty = "a"`,
    `type Cents = nominal Int\nslot c : Cents where between(0, 9) = 1`,
    `slot t : Time where positive = now`,
    `slot f : Float where negative = -1.0`,
    `slot t : Time where one-of(0, 1000) = now`,
    `slot n : Int where one-of(1, 2) = 1`,
    `slot f : Float where one-of(0.5, 1) = 0.5`,
    `type Size = nominal Text\nslot s : Size where one-of("sm", "md") = "sm"`,
    // A parameter says nothing about the base until the generic is applied.
    `type NonEmpty(T) = T where nonempty\nslot s : NonEmpty(Text) = "a"`,
    `type NonEmpty(T) = T where nonempty\ntype N = NonEmpty(Text)\nslot s : N = "a"`,
    `type NonEmpty(T) = T where nonempty\nslot s : NonEmpty(NonEmpty(Text)) = "a"`,
    `type W(T) = nominal T where positive\nslot w : W(Int) = 1`,
    `type Box(T) = {v: T where positive}\nslot b : Box(Float) = {v: 1.5}`,
    `type Pick(T) = T where one-of(1, 2)\nslot p : Pick(Int) = 1`,
    // …nor inside another generic's body, where the argument is itself a parameter.
    `type NonEmpty(T) = T where nonempty\ntype W(U) = NonEmpty(U)\nslot w : W(Text) = "a"`,
    // A parameter spelled like a top-level type is still the parameter (§1.3.6 inv. 5).
    `type Cents = Int\ntype Wrap(Cents) = Cents where nonempty\nslot s : Wrap(Text) = "a"`,
    `slot s : Text where len-lt(1) = ""`,
  ];

  for (const src of good) {
    it(`accepts ${src.split("\n").slice(-1)[0]}`, () => {
      expect(diagnostics(src)).toEqual([]);
    });
  }
});
