// forms.md §5.1.2 used to specify `strict=false` on a bound control: take a
// value the refinement refuses and turn a form-level `valid` flag false. No
// part of the toolchain ever implemented it, and the flag has no reader
// anywhere in the language, so `input(bind=contact, strict=false)` passed
// `check` and did nothing (#443). The spec now has one mode — a bind its
// refinement refuses is refused, and `error(field=…)` shows why — so the prop
// an author reaches for from the old text is reported where it is written.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
const errorsOf = (tiles: string) => check(parse(lex(`${tiles}\n${TAIL}`)));

describe("strict on a bound control is E0219", () => {
  const bad: [string, string][] = [
    [
      "as an argument of input",
      `slot s : Text where nonempty = "a"\ntile App = input(bind=s, strict=false)`,
    ],
    [
      "in the props block of textarea",
      `slot s : Text where nonempty = "a"\ntile App = textarea(bind=s) {strict: false}`,
    ],
    ["on a slider", `slot n : Int where between(0, 9) = 1\ntile App = slider(bind=n, strict=true)`],
  ];
  for (const [label, src] of bad) {
    it(`reports it ${label}`, () => {
      const e0219 = errorsOf(src).filter((e) => e.code === "E0219");
      expect(e0219.map((e) => e.kind)).toEqual(["bind-strict-prop"]);
    });
  }

  it("says what a refused bind does instead", () => {
    const [e] = errorsOf(
      `slot s : Text where nonempty = "a"\ntile App = input(bind=s, strict=false)`,
    ).filter((x) => x.code === "E0219");
    expect(e?.message).toBe(
      `"strict" is not a prop of input: a value its refinement refuses is always refused, and error(field=…) shows why (see docs/spec/forms.md §5.1.2)`,
    );
  });
});
