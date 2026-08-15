// Compiler-side halves of the divergences between `docs/spec/` and what the
// toolchain actually did. Each block names the spec sentence it enforces; the
// runtime halves live in `packages/runtime/test/spec-divergences.test.ts`.

import { check, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function build(source: string): string {
  return codegen(parse(lex(source)), { runtimeSpecifier: "./runtime.js" }).js;
}

function codes(source: string): string[] {
  return check(parse(lex(source))).map((e) => e.code);
}

/** The tile under test has to be reachable from a route, or codegen drops it. */
function app(tile: string, body: string): string {
  return `${body}
tile App = column(${tile})
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

// forms.md §5.2.2: a form is submitted by clicking `button(type="submit")`.
// The argument was parsed, typechecked, and then dropped — it never reached
// the node, so the renderer had nothing to apply and every button in a form
// submitted it.
describe("button(type=…) reaches the tile node", () => {
  it("emits the type when the tile says one", () => {
    const js = build(app("Send", 'tile Send = button(text="send", type="submit")'));
    expect(js).toContain('type: "submit"');
  });

  it("emits nothing when the tile does not, leaving the HTML default", () => {
    // Not `type: undefined` either: the node is compared field-by-field by the
    // reconciler, and a key that is always present changes what "unchanged"
    // means for every button in every app.
    const js = build(app("Plain", 'tile Plain = button(text="plain")'));
    const node = js.slice(js.indexOf('kind: "button"'));
    expect(node.slice(0, node.indexOf("props:"))).not.toContain("type");
  });

  it("takes an expression, not only a literal", () => {
    const src = app(
      "Send",
      `slot mode : Text = "button"
tile Send = button(text="send", type=mode)`,
    );
    expect(build(src)).toContain('type: _live["mode"]');
    expect(codes(src)).toEqual([]);
  });
});
