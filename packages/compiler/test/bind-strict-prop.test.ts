import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const TAIL = `app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
const errorsOf = (tiles: string) => check(parse(lex(`${tiles}\n${TAIL}`)));

describe("strict on a bind control kind is E0219, bound or not", () => {
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
    [
      "on an editable",
      `slot s : Text where nonempty = "a"\ntile App = editable(bind=s, strict=false)`,
    ],
    ["on a check", `slot b : Bool = false\ntile App = check(bind=b, strict=false)`],
    ["on a switch", `slot b : Bool = false\ntile App = switch(bind=b, strict=false)`],
    ["on a radio", `slot s : Text = "a"\ntile App = radio(bind=s, strict=false)`],
    [
      "on a select",
      `slot s : Text = "a"\ntile App = select(bind=s, options=["a", "b"], strict=false)`,
    ],
    ["on an input with no bind", `slot s : Text = "a"\ntile App = input(value=s, strict=false)`],
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
