// A `ui.<ev>(Container)` subscription must reach a descendant that
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

describe("ui.<ev>(Container) whose body is a tile reference", () => {
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
    expect(jsOf(src)).toContain(`onKeyDown: _h("bump")`);
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
  it("reaches an error-boundary fallback rendered where the panicking tile was", () => {
    // The fallback renders in the panicking tile's place — inside `Outer` —
    // so a selector on `Outer` reaches it, by the same "decided by the render
    // path" rule. `Risky` is the one name that does not carry over: its tree,
    // and its `_named` marker, is what the boundary discarded.
    const src = `slot n : Int = 0
reducer bump on=ui.key(Outer) do= n := n + 1
tile Oops
    in=PanicInfo
    = input(placeholder=$1.message) {id: "oops"}
tile Risky
    error-boundary = Oops
    = box(input(placeholder="risky") {id: "risky-in"}) {id: "risky"}
tile Outer = box(Risky) {id: "outer"}
tile App   = column(Outer, text(n.show))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
    const js = jsOf(src);
    // The `catch` half of the first route's boundary — everything the fallback
    // lowered to. Sliced rather than counted so the assertion names the half it
    // is about; a count alone would pass on two wirings in the `try` half.
    const fallback = js.slice(js.indexOf("boundaryPanic"));
    expect(fallback).toContain(`onKeyDown: _h("bump")`);
    // Two routes, each wiring the risky input AND its fallback.
    expect(js.split(`onKeyDown: _h("bump")`).length - 1).toBe(4);
  });
});

// A handler written on a user-tile CALL SITE belongs to the node that tile
// renders, and joins what is already wired there: the lifted subscriptions of
// every enclosing tile and a handler written on the builtin itself. Every
// reducer on one handler runs once, in definition order (language.md §1.6.4
// Invariant 3), wherever it was wired.
describe("a call-site handler joins the lifted ones", () => {
  const app = (defs: string) => `slot n : Int = 0
${defs}
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
`;

  /** Every `<handler>` the module emits, as its reducer list, in output order. */
  const wired = (js: string, handler = "onClick"): string[] =>
    [...js.matchAll(new RegExp(`${handler}: _h\\(([^)]*)\\)`, "g"))].map((m) => m[1] ?? "");
  const onClicks = (js: string): string[] => wired(js, "onClick");

  it("fires the enclosing tile's subscription beside the call site's own", () => {
    const src = app(`reducer rowClick on=ui.click(Row) do= n := n + 1
reducer btnOwn   on=ui.click(Btn) do= n := n + 100
tile Btn = button(text="x")
tile Row = row(Btn {onClick: btnOwn})
tile App = column(Row, text(n.show))`);
    expect(check(parse(lex(src))).map((e) => e.code)).toEqual([]);
    // One wiring per route, each the union — and no second, narrower wiring
    // left over for a spread to put on top of it.
    expect(onClicks(jsOf(src))).toEqual(['"rowClick", "btnOwn"', '"rowClick", "btnOwn"']);
  });

  it("joins a reducer that only the call site names", () => {
    // `extra` subscribes to a tile the button is not inside, so no lift puts
    // it there: the call site is the only thing that does.
    const src = app(`reducer rowClick on=ui.click(Row)   do= n := n + 1
reducer extra    on=ui.click(Other) do= n := n + 7
tile Btn   = button(text="x")
tile Row   = row(Btn {onClick: extra})
tile Other = button(text="other")
tile App   = column(Row, Other, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual([
      '"rowClick", "extra"',
      '"extra"',
      '"rowClick", "extra"',
      '"extra"',
    ]);
  });

  it("joins a handler written on the builtin the tile renders", () => {
    const src = app(`reducer own   on=app.start do= n := n + 1
reducer outer on=app.start do= n := n + 2
tile Btn = button(text="x", onClick=own)
tile App = column(Btn {onClick: outer}, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual(['"own", "outer"', '"own", "outer"']);
  });

  // Two rules could order an explicit handler against a lifted one by where it
  // was written: explicit first (what `propsFor` used to do) or lifted first.
  // Each case below is one that rule gets wrong, so the pair pins definition
  // order. `btnOwn` subscribes to a tile the button is not inside, so it is
  // purely the call site's and nothing lifts it.
  const ordered = (reducers: string) =>
    app(`${reducers}
tile Btn   = button(text="x")
tile Row   = row(Btn {onClick: btnOwn})
tile Other = button(text="other")
tile App   = column(Row, Other, text(n.show))`);
  const ROW = "reducer rowClick on=ui.click(Row)   do= n := n + 1";
  const OWN = "reducer btnOwn   on=ui.click(Other) do= n := n + 100";

  it("runs the call site's reducer last when it is defined last", () => {
    // Explicit-first would run `btnOwn` first.
    expect(onClicks(jsOf(ordered(`${ROW}\n${OWN}`)))[0]).toBe('"rowClick", "btnOwn"');
  });

  it("runs the call site's reducer first when it is defined first", () => {
    // Lifted-first would run `rowClick` first.
    expect(onClicks(jsOf(ordered(`${OWN}\n${ROW}`)))[0]).toBe('"btnOwn", "rowClick"');
  });

  it("orders an explicit handler on a builtin by definition too", () => {
    // The rule `propsFor` used to apply was explicit-first, which would put
    // `own` first. One rule now, in both places: this is the builtin half.
    const src = app(`reducer lifted on=ui.click(Row) do= n := n + 1
reducer own    on=app.start      do= n := n + 2
tile Row = row(button(text="x", onClick=own))
tile App = column(Row, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual(['"lifted", "own"', '"lifted", "own"']);
  });

  it("carries a handler through every call site the node is the root of", () => {
    const src = app(`reducer a on=app.start do= n := n + 1
reducer b on=app.start do= n := n + 2
tile Btn   = button(text="x")
tile Inner = Btn {onClick: a}
tile App   = column(Inner {onClick: b}, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual(['"a", "b"', '"a", "b"']);
  });

  it("carries it into a tile that takes a positional input", () => {
    const src = app(`reducer rowClick on=ui.click(Row) do= n := n + 1
reducer btnOwn   on=app.start      do= n := n + 100
tile Btn in=Text = button(text=$1)
tile Row = row(Btn("x") {onClick: btnOwn})
tile App = column(Row, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual(['"rowClick", "btnOwn"', '"rowClick", "btnOwn"']);
  });

  it("reaches the root of each branch an if can take", () => {
    const src = app(`slot lit : Bool = true
reducer rowClick on=ui.click(Row) do= n := n + 1
reducer btnOwn   on=app.start      do= n := n + 100
tile Btn = if lit then button(text="on") else button(text="off")
tile Row = row(Btn {onClick: btnOwn})
tile App = column(Row, text(n.show))`);
    // Two branches in each of two routes, every one the union.
    expect(onClicks(jsOf(src))).toEqual(Array(4).fill('"rowClick", "btnOwn"'));
  });

  it("reaches the root of each arm a match can take", () => {
    const src = app(`type Mode = On | Off | Dim(Int)
slot mode : Mode = On
reducer rowClick on=ui.click(Row) do= n := n + 1
reducer btnOwn   on=app.start      do= n := n + 100
tile Btn = match mode with
  | On     -> button(text="on")
  | Dim(k) -> button(text=k.show)
  | _      -> button(text="off")
tile Row = row(Btn {onClick: btnOwn})
tile App = column(Row, text(n.show))`);
    // A tag arm, a tag arm that binds and a wildcard, in each of two routes.
    expect(onClicks(jsOf(src))).toEqual(Array(6).fill('"rowClick", "btnOwn"'));
  });

  it("reaches the body of a when", () => {
    const src = app(`slot lit : Bool = true
reducer rowClick on=ui.click(Row) do= n := n + 1
reducer btnOwn   on=app.start      do= n := n + 100
tile Btn = when(lit, button(text="on"))
tile Row = row(Btn {onClick: btnOwn})
tile App = column(Row, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual(Array(2).fill('"rowClick", "btnOwn"'));
  });

  it("reaches every node a for renders, and the root of a branch that is one", () => {
    const src = app(`slot lit : Bool = true
slot xs : List(Text) = ["a", "b"]
reducer rowClick on=ui.click(Row) do= n := n + 1
reducer btnOwn   on=app.start      do= n := n + 100
tile Btn = if lit then button(text="one") else for x in xs button(text=x)
tile Row = row(Btn {onClick: btnOwn})
tile App = column(Row, text(n.show))`);
    const js = jsOf(src);
    // The single button and the one the loop builds per item, in each route.
    expect(onClicks(js)).toEqual(Array(4).fill('"rowClick", "btnOwn"'));
    // And no other `onClick` anywhere, such as one merged over the finished
    // nodes, to replace it.
    expect(js.match(/onClick:/g)).toHaveLength(4);
  });

  it("joins onSubmit and onChange the same way", () => {
    const src = app(`reducer sent    on=ui.submit(Outer) do= n := n + 1
reducer changed on=ui.change(Outer) do= n := n + 2
reducer ownSub  on=app.start         do= n := n + 3
reducer ownChg  on=app.start         do= n := n + 4
tile Form  = form(button(text="go", type="submit"))
tile Field = input(placeholder="p")
tile Outer = column(Form {onSubmit: ownSub}, Field {onChange: ownChg})
tile App   = column(Outer, text(n.show))`);
    const js = jsOf(src);
    expect(wired(js, "onSubmit")).toEqual(Array(2).fill('"sent", "ownSub"'));
    expect(wired(js, "onChange")).toEqual(Array(2).fill('"changed", "ownChg"'));
  });

  it("joins a handler no ui event lifts, such as onClose", () => {
    // `onClose` has no `ui.<ev>` row, so it is emitted by the pass that flushes
    // the explicit handlers left over; that pass orders by definition too.
    const src = app(`slot open : Bool = true
reducer outer on=app.start do= open := false
reducer own   on=app.start do= n := n + 1
tile Dlg = modal(text("hi"), open=open, title="t", onClose=own)
tile App = column(Dlg {onClose: outer}, text(n.show))`);
    expect(wired(jsOf(src), "onClose")).toEqual(Array(2).fill('"outer", "own"'));
  });

  it("wires a reducer once, on one node, when the call site and the body both name it", () => {
    const src = app(`reducer hit on=ui.click(Btn) do= n := n + 1
tile Btn = button(text="x", onClick=hit)
tile App = column(Btn {onClick: hit}, text(n.show))`);
    expect(onClicks(jsOf(src))).toEqual(['"hit"', '"hit"']);
  });
});
