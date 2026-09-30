// A `bind=` target is the place a control writes to (forms.md §5.1): a path,
// whose steps are a field, an index, or the unwrap `.get` (language.md §1.6.1 /
// §1.6.3), written without parentheses. A step written as a call names the
// value the call answers, not a place, so it is E0602 at the call. On the left
// of `:=` the same path does not parse, because a path step is an identifier.

import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `type D = {title: Text}
slot d : Option(D) = Some({title: "a"})
slot name : Text = "a"
${defs}
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const errsOf = (src: string) => check(parse(lex(src)));

describe("a call in a bind target", () => {
  it.each([
    ["the parenthesised unwrap", "d.get().title", ".get()", '".get"'],
    ["a member call", "name.upper()", ".upper()", "no place"],
  ])("is E0602 at the call: %s", (_label, target, named, hint) => {
    const errs = errsOf(app(`tile App = column(input(bind=${target}))`));
    const e = errs.find((x) => x.code === "E0602");
    expect(e?.kind).toBe("unassignable-member");
    expect(e?.message).toContain(named);
    expect(e?.message).toContain(hint);
    // Line 4 is the tile; the call's receiver starts right after `bind=`.
    expect(e?.pos).toMatchObject({ line: 4, col: 30 });
  });

  it("is reported on every bind control, not only input", () => {
    const codes = errsOf(app("tile App = column(textarea(bind=d.get().title))")).map((e) => e.code);
    expect(codes).toContain("E0602");
  });

  it("is reported on the call, and the paren-free unwrap step is not", () => {
    // The two spellings side by side: only the call is refused.
    expect(errsOf(app("tile App = column(input(bind=d.get().title))")).map((e) => e.code)).toEqual([
      "E0602",
    ]);
    expect(errsOf(app("tile App = column(input(bind=d.get.title))"))).toEqual([]);
  });
});
