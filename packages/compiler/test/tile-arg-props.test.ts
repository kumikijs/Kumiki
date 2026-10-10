import { check, codegen, compile, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { loweredOf } from "./helpers/module.ts";
import { withRoot } from "./helpers/programs.ts";

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
  return checkSource(source)
    .filter((e) => e.severity !== "warning")
    .map((e) => e.code);
}

/** The props object of the first tile node in the emitted route table. */
function propsOf(js: string): string {
  const at = js.indexOf("props: {");
  if (at === -1) throw new Error("no props emitted");
  return js.slice(at, js.indexOf("\n", at));
}

describe("a named argument reaches props", () => {
  it("carries an argument the kind does not lift", () => {
    const js = propsOf(emit('image(src="/a.png", alt="A cat", width=120, loading="lazy")'));
    expect(js).toContain('alt: "A cat"');
    expect(js).toContain("width: 120");
    expect(js).toContain('loading: "lazy"');
  });

  it("puts it in the $el payload too, as the id fold always did", () => {
    const js = propsOf(emit('button(text="go", disabled=true)'));
    expect(js).toContain("el: {");
    expect(js.slice(js.indexOf("el: {"))).toContain(`"disabled": true`);
  });

  it("does not lower a tile-valued argument as if it were prop data", () => {
    // A named argument parses as a value, so only a `when` or a `for` puts a tile there.
    const js = emit('box(header=when(n > 0, text("inner")), text("body"))', "slot n : Int = 1");
    const route = js.slice(js.indexOf('pattern: "/"'), js.indexOf('pattern: "/404"'));
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
    expect(js).toContain('aria: { ...({ "hidden": "true" }), "aria-label": "Main" }');
    expect(js).not.toContain("aria_label");
  });
});

describe("which argument a user tile takes as its input", () => {
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
    expect(inputArg(emit('column(Row(alt="x", "hi"), text(n.show))', HOST), "Row")).toBe('"hi"');
    expect(inputArg(emit('column(Row(bind=draft, "hi"), text(n.show))', HOST), "Row")).toBe('"hi"');
  });

  // A named argument parses as a value, so only a `when` or a `for` puts a tile there.
  it.each([
    'column(Btn(header=when(n > 0, text("inner"))), text(n.show))',
    'column(Btn(header=for x in [1] text("inner")), text(n.show))',
  ])("reports a tile written as a named argument, which nothing renders: %s", (tile) => {
    expect(codesFor(tile, HOST)).toEqual(["E0201"]);
  });

  it("reads the outer call's input when the tile renders another user tile", () => {
    const js = emit('column(Wrap(onClick=bump, "hi"), text(n.show))', HOST);
    expect(inputArg(js, "Wrap")).toBe('"hi"');
    expect(inputArg(js, "Row")).toBe("_d_1");
  });

  it("still reports the arity a tile declares", () => {
    expect(codesFor("column(Row(), text(n.show))", HOST)).toEqual(["E0213"]);
    expect(codesFor('column(Row("a", "b"), text(n.show))', HOST)).toEqual(["E0213"]);
    expect(codesFor('column(Btn("x"), text(n.show))', HOST)).toEqual(["E0213"]);
  });

  it("answers a wrong arity with the diagnostic, not with output", () => {
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

describe("which argument a builtin takes as its content", () => {
  it("shows the positional argument and keeps the named one a prop", () => {
    const js = emit('heading(level=2, "Title")');
    // What is shown, without depending on the order of the node's fields.
    expect(js).toContain('_s.show("Title")');
    expect(js).not.toContain("_s.show(2)");
    expect(propsOf(js)).toContain("level: 2");
  });
});

describe("button(type=…) reaches the tile node", () => {
  it("emits the type when the tile says one", () => {
    const js = loweredOf(withRoot("Send", 'tile Send = button(text="send", type="submit")'));
    expect(js).toContain('type: "submit"');
  });

  it("emits nothing when the tile does not, leaving the HTML default", () => {
    const js = loweredOf(withRoot("Plain", 'tile Plain = button(text="plain")'));
    const node = js.slice(js.indexOf('kind: "button"'));
    expect(node.slice(0, node.indexOf("props:"))).not.toContain("type");
  });

  it("rejects a literal type that is not one of the three", () => {
    const src = withRoot("Bad", 'tile Bad = button(text="x", type="submmit")');
    expect(codesOf(src)).toEqual(["E0201"]);
    for (const ok of ["submit", "button", "reset"]) {
      expect(codesOf(withRoot("Ok", `tile Ok = button(text="x", type="${ok}")`)), ok).toEqual([]);
    }
  });

  it("takes an expression, not only a literal", () => {
    const src = withRoot(
      "Send",
      `slot mode : Text = "button"
tile Send = button(text="send", type=mode)`,
    );
    expect(loweredOf(src)).toContain('type: _live["mode"]');
    expect(codesOf(src)).toEqual([]);
  });
});
