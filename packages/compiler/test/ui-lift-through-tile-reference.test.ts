// #333 — a `ui.<ev>(Container)` subscription must reach a descendant that
// fires `<ev>` whether the container's body names that descendant inline or
// through a tile reference.
//
// The two halves of the compiler used to disagree about the same program
// written two ways. `W0212` resolves a named tile when it looks for a
// descendant that can fire the event (`collectTileBuiltinKinds` walks through
// the reference) and stays silent; codegen reset the enclosing-tile name at
// every user-tile boundary, so the handler was never lifted onto the
// descendant. `kumiki check` said ok, `kumiki build` emitted no listener, and
// nothing anywhere said why.
//
// What decides the answer is the inline form: `box(input(...))` wires the
// handler, so `box(Inner)` with `tile Inner = input(...)` has to wire the same
// one. Codegen therefore carries the whole chain of enclosing user tiles
// across reference boundaries, and every row of the lift table is checked
// here rather than `key` alone — the lift path is shared, so a fix for one
// event is a fix for all of them or it is a special case waiting to rot.

import { describe, expect, it } from "vitest";
import type { UiEventKind } from "../src/ast.ts";
import { compile } from "../src/compile.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { check } from "../src/typecheck.ts";
import { UI_LIFTS } from "../src/ui-lifts.ts";

/**
 * One builtin per ui-event that actually fires it, written as the leaf of the
 * container. `hover` lifts onto any tile, so it takes the same `input` as the
 * rest — what matters for it is that the referenced and inline forms produce
 * the same set of listeners, not which tile they land on.
 */
const LEAF: Record<UiEventKind, string> = {
  click: 'button(text="go")',
  submit: 'form(button(text="go", type="submit"))',
  change: 'input(placeholder="p") {id: "leaf"}',
  input: 'input(placeholder="p") {id: "leaf"}',
  key: 'input(placeholder="p") {id: "leaf"}',
  focus: 'input(placeholder="p") {id: "leaf"}',
  blur: 'input(placeholder="p") {id: "leaf"}',
  hover: 'input(placeholder="p") {id: "leaf"}',
};

/** `tile Outer = box(Leaf)` — the container's body is a tile reference. */
const referenced = (ev: UiEventKind): string => `slot n : Int = 0
reducer bump on=ui.${ev}(Outer) do= n := n + 1
tile Leaf  = ${LEAF[ev]}
tile Outer = box(Leaf) {id: "outer"}
tile App   = column(Outer, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

/** The same tree written inline — the form that has always worked. */
const inlined = (ev: UiEventKind): string => `slot n : Int = 0
reducer bump on=ui.${ev}(Outer) do= n := n + 1
tile Outer = box(${LEAF[ev]}) {id: "outer"}
tile App   = column(Outer, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

function jsOf(src: string): string {
  const result = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (result.kind !== "ok") {
    throw new Error(`compile failed: ${result.errors.map((e) => e.code).join(", ")}`);
  }
  return result.js;
}

/** How many listeners the program wires for `bump` under `handler`. */
function wirings(src: string, handler: string): number {
  return jsOf(src).split(`${handler}: _h("bump")`).length - 1;
}

describe("ui.<ev>(Container) whose body is a tile reference (#333)", () => {
  for (const lift of UI_LIFTS) {
    const ev = lift.ev;

    it(`wires ${lift.handler} through the reference, as the inline form does`, () => {
      const inline = wirings(inlined(ev), lift.handler);
      // A form that wires nothing would make the comparison below vacuous.
      expect(inline).toBeGreaterThan(0);
      expect(wirings(referenced(ev), lift.handler)).toBe(inline);
    });

    it(`reports nothing for either form of ui.${ev}(Outer)`, () => {
      // The bug was one half of the compiler being satisfied while the other
      // dropped the handler, so silence has to mean wired — asserted above —
      // rather than merely silent.
      expect(check(parse(lex(referenced(ev)))).map((e) => e.code)).toEqual([]);
      expect(check(parse(lex(inlined(ev)))).map((e) => e.code)).toEqual([]);
    });
  }

  it("reaches through more than one level of reference", () => {
    const src = `slot n : Int = 0
reducer bump on=ui.key(Outer) do= n := n + 1
tile Leaf   = input(placeholder="p") {id: "leaf"}
tile Middle = box(Leaf) {id: "middle"}
tile Outer  = box(Middle) {id: "outer"}
tile App    = column(Outer, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
    expect(src.length > 0 && jsOf(src)).toContain(`onKeyDown: _h("bump")`);
  });

  it("keeps a selector on the inner tile working alongside the outer one", () => {
    // Both selectors name a tile the leaf renders under, so both fire, in
    // definition order (§1.6.4) — the same rule that governs two reducers
    // naming one tile.
    const src = `slot n : Int = 0
reducer outer on=ui.key(Outer) do= n := n + 1
reducer inner on=ui.key(Leaf)  do= n := n + 10
tile Leaf  = input(placeholder="p") {id: "leaf"}
tile Outer = box(Leaf) {id: "outer"}
tile App   = column(Outer, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
    expect(jsOf(src)).toContain(`onKeyDown: _h("outer", "inner")`);
  });

  it("wires only the call sites under the container, not every use of the tile", () => {
    // The chain is a property of the path a tile was reached by, not of the
    // tile: the `Leaf` beside `Outer` is not inside it, and a listener there
    // would fire the reducer for a keypress the selector never named.
    const src = `slot n : Int = 0
reducer bump on=ui.key(Outer) do= n := n + 1
tile Leaf  = input(placeholder="p") {id: "leaf"}
tile Outer = box(Leaf) {id: "outer"}
tile App   = column(Outer, Leaf, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    const js = jsOf(src);
    // Two routes render `App`, each with one wired `Leaf` and one bare one.
    expect(js.split(`onKeyDown: _h("bump")`).length - 1).toBe(2);
    expect(js.split(`kind: "input"`).length - 1).toBe(4);
  });

  it("still reports W0212 when nothing behind the reference fires the event", () => {
    // The warning is not collateral damage of the fix: a container of boxes
    // fires no `key` however many references it is written through, and that
    // is the case W0212 exists for.
    const src = `slot n : Int = 0
reducer bump on=ui.key(Outer) do= n := n + 1
tile Leaf  = box(text("x")) {id: "leaf"}
tile Outer = box(Leaf) {id: "outer"}
tile App   = column(Outer, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual(["W0212"]);
    expect(jsOf(src)).not.toContain("onKeyDown");
  });
});
