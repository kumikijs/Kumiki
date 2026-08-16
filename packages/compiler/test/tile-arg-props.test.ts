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

import { check, codegen, lex, parse } from "@kumikijs/compiler";
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
