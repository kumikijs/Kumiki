// A named argument and the props block of the same name are the same prop.
//
// The spec writes them interchangeably — `button(text="Log in",
// loading=loginPending)` sits a few lines from `{variant: "ghost"}` in
// forms.md — but lowering lifted only the arguments each kind names and threw
// the rest away. `image(alt="A cat")` satisfied the a11y check and rendered no
// `alt`; `button(disabled=true)` rendered an enabled button.
//
// The DOM half of these claims lives in `packages/tests/tile-props.test.ts`,
// which compiles and mounts. Here we hold the compiler to the shape it emits,
// because that is where the prop went missing.

import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function emit(tile: string, extra = ""): string {
  const source = `${extra}
tile Probe = ${tile}

app P
    caps   = []
    routes = {"/" -> Probe, "/404" -> Probe}
    init   = []
`;
  const program = parse(lex(source));
  const errors = check(program).filter((e) => e.severity !== "warning");
  if (errors.length > 0) throw new Error(errors.map((e) => `${e.code} ${e.message}`).join(", "));
  return codegen(program, { runtimeSpecifier: "@kumikijs/runtime" }).js;
}

/** A host program the user-tile cases are written against. */
const HOST = `slot n : Int = 0
slot draft : Text = ""
reducer bump on=app.start do= n := n + 1
tile Btn = button(text="go")
tile Row in=Text = button(text=$1)
tile Wrap in=Text = column(Row($1))`;

/** The diagnostics of a program `emit` would refuse to compile. */
function codesFor(tile: string, extra = ""): string[] {
  const source = `${extra}
tile Probe = ${tile}

app P
    caps   = []
    routes = {"/" -> Probe, "/404" -> Probe}
    init   = []
`;
  return check(parse(lex(source)))
    .filter((e) => e.severity !== "warning")
    .map((e) => e.code);
}

/** The props object of the first tile node in the emitted route table. */
function propsOf(js: string): string {
  const at = js.indexOf("props: {");
  if (at === -1) throw new Error("no props emitted");
  return js.slice(at, js.indexOf("\n", at));
}

describe("a named argument reaches props (#251)", () => {
  it("carries an argument the kind does not lift", () => {
    const js = propsOf(emit('image(src="/a.png", alt="A cat", width=120, loading="lazy")'));
    expect(js).toContain('alt: "A cat"');
    expect(js).toContain("width: 120");
    expect(js).toContain('loading: "lazy"');
  });

  it("puts it in the $el payload too, as the id fold always did", () => {
    const js = propsOf(emit('button(text="go", disabled=true)'));
    expect(js).toContain("el: {");
    expect(js.slice(js.indexOf("el: {"))).toContain("disabled: true");
  });

  it("does not lower a tile-valued argument as if it were prop data", () => {
    // One route's worth of output: the tile is inlined once per route, and
    // `/404` is mandatory, so counting over the whole module counts twice.
    const js = emit('card(header=text("inner"), text("body"))');
    const route = js.slice(js.indexOf('pattern: "/"'), js.indexOf('pattern: "/404"'));
    // Only the positional child is a node. A tile under a name no kind lifts
    // is dropped, as it was before — but it must not reappear inside `props`,
    // where a second copy of its node would be built on every render.
    expect(route.split('kind: "text"').length - 1).toBe(1);
    expect(propsOf(js)).not.toContain("header:");
  });

  it("leaves an lvalue bind out of the props", () => {
    const js = propsOf(emit("input(bind=draft)", 'slot draft : Text = ""'));
    expect(js).not.toContain("bind:");
  });

  it("lets the props block win over an argument of the same name", () => {
    const js = propsOf(emit('button(text="go", disabled=false) {disabled: true}'));
    expect(js).toContain("disabled: true");
    expect(js).not.toContain("disabled: false");
  });

  it("folds a bare aria-* into the aria map rather than a prop of its own", () => {
    const js = propsOf(emit('region(text("x")) {aria: {hidden: "true"}, aria-label: "Main"}'));
    // One `aria` value holding both, because the runtime reads only that key:
    // finding `aria-*` among the props would mean enumerating a props bag that
    // a host tile may refuse to enumerate.
    expect(js).toContain('aria: { ...({ "hidden": "true" }), "aria-label": "Main" }');
    expect(js).not.toContain("aria_label");
  });
});

describe("which argument a user tile takes as its input", () => {
  // `checkTileInput` counts the positional arguments and codegen took
  // `args[0]`, so a named argument written first was consumed as the tile's
  // `$1`. The checker saw a call with no positional argument to a tile that
  // wants none and said ok; codegen bound `$1` to the handler's *name*, and
  // the emitted module read a bare `bump` that nothing declares — the mount
  // died in render with `bump is not defined`.
  //
  // The two halves count the same arguments now. What a named argument means
  // is unchanged: it is a prop, and it reaches the tile's root node.

  /**
   * What one user tile's call site passes as its input, or `""` when it is
   * rendered without one.
   *
   * Found by the name the call site closes with rather than by the first IIFE
   * in the route: a tile whose body renders another user tile emits that one's
   * IIFE first, so scanning forward from the header reads the inner call's
   * argument and answers the same thing before and after this fix.
   */
  const inputArg = (js: string, tile: string): string => {
    const route = js.slice(js.indexOf('pattern: "/"'), js.indexOf('pattern: "/404"'));
    const applied = `, ${JSON.stringify(tile)}); })(`;
    const at = route.indexOf(applied);
    if (at === -1) {
      if (!route.includes(`, ${JSON.stringify(tile)})`)) {
        throw new Error(`tile "${tile}" is not rendered in the route`);
      }
      return "";
    }
    const from = at + applied.length;
    return route.slice(from, route.indexOf(", {", from));
  };

  it("takes no input from a handler argument on a tile that declares none", () => {
    const js = emit("column(Btn(onClick=bump), text(n.show))", HOST);
    // No input to pass means no IIFE to pass it to.
    expect(inputArg(js, "Btn")).toBe("");
    expect(js).not.toContain("})(bump,");
  });

  it("still delivers that handler to the tile's root", () => {
    const js = emit("column(Btn(onClick=bump), text(n.show))", HOST);
    expect(js).toContain('_attachProps(({ kind: "button"');
    expect(js).toContain('onClick: _h("bump")');
  });

  it("takes the positional argument even when a named one is written first", () => {
    const js = emit('column(Row(onClick=bump, "hi"), text(n.show))', HOST);
    expect(inputArg(js, "Row")).toBe('"hi"');
    expect(js).toContain('onClick: _h("bump")');
  });

  it("takes the positional argument over a named one that is not a handler", () => {
    // The quieter half of the same defect: a handler value is a `Ref`, so the
    // old lowering emitted a bare reducer name and the mount died. A literal
    // or a slot read was consumed as `$1` in silence — `bind` worse than the
    // rest, since it is dropped from props as well, so the written argument
    // vanished and `$1` became a slot read.
    expect(inputArg(emit('column(Row(alt="x", "hi"), text(n.show))', HOST), "Row")).toBe('"hi"');
    expect(inputArg(emit('column(Row(bind=draft, "hi"), text(n.show))', HOST), "Row")).toBe('"hi"');
  });

  it("reports a tile written as a named argument, which nothing renders", () => {
    // It used to be inlined in place of the tile's body, which was wrong and
    // visible. Taking the positional argument makes it invisible instead: a
    // builtin container skips named arguments, the builtins that read one by
    // name all want a value, and `propsFor` drops a tile-valued one — so the
    // checker reports the shape rather than letting it disappear.
    expect(codesFor('column(Btn(header=text("inner")), text(n.show))', HOST)).toEqual(["E0201"]);
  });

  it("reads the outer call's input when the tile renders another user tile", () => {
    // `Wrap`'s body emits `Row`'s IIFE, so the inner application site comes
    // first in the text. What is asserted here is the outer one — without
    // that, a reading of these tests would answer `_d_1` and say the same
    // thing before and after the fix.
    const js = emit('column(Wrap(onClick=bump, "hi"), text(n.show))', HOST);
    expect(inputArg(js, "Wrap")).toBe('"hi"');
    expect(inputArg(js, "Row")).toBe("_d_1");
  });

  it("still reports the arity a tile declares", () => {
    // Unchanged in both directions: the positional arguments are what is
    // counted, and a named one is not one of them.
    expect(codesFor("column(Row(), text(n.show))", HOST)).toEqual(["E0213"]);
    expect(codesFor('column(Row("a", "b"), text(n.show))', HOST)).toEqual(["E0213"]);
    expect(codesFor('column(Btn("x"), text(n.show))', HOST)).toEqual(["E0213"]);
  });

  it("answers a wrong arity with the diagnostic, not with output", () => {
    // Codegen is never reached for a call the checker rejected, and this is
    // the lock on that: `compile` returns the diagnostics rather than an
    // emitted module for a call whose second positional argument is past what
    // the tile declares.
    const result = compile(
      `${HOST}
tile Probe = column(Row("a", "b"), text(n.show))

app P
    caps   = []
    routes = {"/" -> Probe, "/404" -> Probe}
    init   = []
`,
      { runtimeSpecifier: "@kumikijs/runtime" },
    );
    expect(result.kind === "fail" && result.errors.map((e) => e.code)).toEqual(["E0213"]);
  });
});
