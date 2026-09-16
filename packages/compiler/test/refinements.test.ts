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
    if (!slot || slot.type.kind !== "TypeRefinement") throw new Error("expected a refined slot");
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
    ["one-of with nothing to choose from", `slot s : Text where one-of() = "a"`],
    ["an argument to a predicate that takes none", `slot s : Text where nonempty(1) = "a"`],
  ];

  for (const [label, src] of bad) {
    it(`reports ${label}`, () => {
      expect(codes(src)).toContain("E0804");
    });
  }

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
