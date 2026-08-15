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

// language.md §1.7.2 inv. 5: the iteration target of `for` is `Map.keys`,
// `Set.to-list`, or a `List`. A `Map` and a `Set` are both keyed objects at
// runtime, so iterating one compiled and then threw where the loop was used.
describe("for over a Map or a Set is E0218", () => {
  const MAP = "slot names : Map(Text, Text) = {}";
  const SET = "slot tags : Set(Text) = {}";

  it("reports the tile form", () => {
    const src = `${MAP}
tile App = column(for k in names text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual(["E0218"]);
  });

  it("reports the reducer form, which is a different node", () => {
    // Covering only the tile form would leave `do= for k in m …` compiling and
    // throwing `object is not iterable` at the first dispatch.
    const src = `${MAP}
slot n : Int = 0
reducer count on=app.start do=
    for k in names
        n := n + 1
${appTail()}`;
    expect(codes(src)).toEqual(["E0218"]);
  });

  it("reports a Set, which is a keyed object too", () => {
    const src = `${SET}
tile App = column(for t in tags text(t))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const diags = check(parse(lex(src)));
    expect(diags.map((d) => d.code)).toEqual(["E0218"]);
    expect(diags[0]?.message).toContain(".to-list");
  });

  it("accepts the two forms the spec names, and a plain List", () => {
    const src = `${MAP}
${SET}
slot xs : List(Text) = []
tile App = column(
             for k in names.keys text(k),
             for t in tags.to-list text(t),
             for x in xs text(x))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual([]);
  });

  it("stays silent when the type cannot be determined", () => {
    // `null` from the inferencer means "cannot tell", never "not a list". Here
    // the name does not resolve at all: that is one mistake, and it already
    // has a diagnostic — E0218 must not pile a second complaint on top of it.
    const src = `tile App = column(for r in nope text(r))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual(["E0103"]);
  });

  it("accepts a List that comes back from a fn", () => {
    const src = `slot xs : List(Text) = []
fn rows(ys: List(Text)) -> List(Text) = ys
tile App = column(for r in rows(xs) text(r))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual([]);
  });
});

function appTail(): string {
  return `tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}
