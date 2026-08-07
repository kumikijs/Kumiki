import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppDef, ReducerDef, SlotDef, Statement, TileDef, TypeDef } from "@kumikijs/compiler";
import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const COUNTER_PATH = resolve(__dirname, "../../examples/apps/01-counter/app.kumiki");

describe("parser", () => {
  it("parses the counter example end-to-end", () => {
    const source = readFileSync(COUNTER_PATH, "utf8");
    const program = parse(lex(source));

    const byKind = <K extends string>(kind: K) => program.defs.filter((d) => d.kind === kind);

    expect(byKind("TypeDef")).toHaveLength(1);
    expect(byKind("SlotDef")).toHaveLength(1);
    expect(byKind("ReducerDef")).toHaveLength(3);
    expect(byKind("TileDef")).toHaveLength(4);
    expect(byKind("AppDef")).toHaveLength(1);

    const slot = byKind("SlotDef")[0] as SlotDef;
    expect(slot.name).toBe("count");
    expect(slot.init).toMatchObject({ kind: "Num", value: 0 });

    const typeN = byKind("TypeDef")[0] as TypeDef;
    expect(typeN.name).toBe("N");
    expect(typeN.body.kind).toBe("TypeNominal");

    const incReducer = (byKind("ReducerDef") as ReducerDef[]).find((r) => r.name === "inc");
    expect(incReducer).toBeDefined();
    expect(incReducer?.on.kind).toBe("UiEvent");
    expect(incReducer?.on.ev).toBe("click");
    expect(incReducer?.on.selector.tile).toBe("IncBtn");
    // `inc` guards its own ceiling, so the body is one `if` whose consequent is
    // the assignment (the count type is bounded, and a refused write discards
    // the whole batch — spec/runtime.md §10.3.3).
    expect(incReducer?.do).toHaveLength(1);
    const incGuard = incReducer?.do[0] as Extract<Statement, { kind: "IfStmt" }>;
    expect(incGuard).toMatchObject({ kind: "IfStmt", cond: { kind: "BinOp", op: "<" } });
    expect(incGuard.alternate).toEqual([]);
    expect(incGuard.consequent).toHaveLength(1);
    expect(incGuard.consequent[0]).toMatchObject({
      kind: "SlotAssign",
      lvalue: { kind: "LSlot", name: "count" },
      rhs: { kind: "BinOp", op: "+" },
    });

    const app = byKind("AppDef")[0] as AppDef;
    expect(app.name).toBe("Counter");
    expect(app.caps).toEqual([]);
    expect(app.routes.map((r) => r.path)).toEqual(["/", "/404"]);
    expect(app.init).toEqual([]);

    const appTile = (byKind("TileDef") as TileDef[]).find((t) => t.name === "App");
    expect(appTile).toBeDefined();
    expect(appTile?.body.name).toBe("column");
  });

  it("parses an effect definition", () => {
    const program = parse(lex("effect foo cap=http.get in=Unit out=Unit"));
    expect(program.defs).toHaveLength(1);
    expect(program.defs[0]).toMatchObject({ kind: "EffectDef", name: "foo", cap: "http.get" });
  });

  it("parses a small tile with props", () => {
    const src = `tile DecBtn = button(text="-")`;
    const program = parse(lex(src));
    expect(program.defs).toHaveLength(1);
    const tile = program.defs[0] as TileDef;
    expect(tile.name).toBe("DecBtn");
    expect(tile.body.name).toBe("button");
    expect(tile.body.args[0]).toMatchObject({ name: "text" });
  });

  it("parses an expression with binary precedence", () => {
    const program = parse(lex("slot x : Int = 1 + 2 * 3"));
    const slot = program.defs[0] as SlotDef;
    expect(slot.init).toMatchObject({
      kind: "BinOp",
      op: "+",
      rhs: { kind: "BinOp", op: "*" },
    });
  });

  it("parses a selector with id", () => {
    const src = `reducer r on=ui.submit(LoginForm#new) do= x := 1`;
    const program = parse(lex(src));
    const r = program.defs[0] as ReducerDef;
    // `tilePos` points at `LoginForm` itself, not at the `ui.submit(` before
    // it — `rename` rewrites that span verbatim, so an off-by-one here is a
    // corrupted file.
    expect(r.on.selector).toEqual({ tile: "LoginForm", id: "new", tilePos: { line: 1, col: 24 } });
  });

  it("parses a timer event", () => {
    const src = `slot x : Int = 0
reducer tick on=timer(1s) do= x := x + 1`;
    const program = parse(lex(src));
    const r = program.defs[1] as ReducerDef;
    expect(r.on.kind).toBe("TimerEvent");
    if (r.on.kind !== "TimerEvent") throw new Error("expected TimerEvent");
    expect(r.on.intervalMs).toBe(1000);
  });

  it("accepts `&` as an alias for `&&` in bool expressions", () => {
    const src = `slot a : Bool = true
slot b : Bool = false
reducer r on=ui.click(B) do= a := a & b
tile B = button(text="b")`;
    const program = parse(lex(src));
    const r = program.defs.find((d) => d.kind === "ReducerDef") as ReducerDef;
    const stmt = r.do[0] as { rhs: { kind: string; op: string } };
    expect(stmt.rhs.kind).toBe("BinOp");
    expect(stmt.rhs.op).toBe("&");
  });

  it("parses a timer event with ms unit", () => {
    const src = `slot x : Int = 0
reducer tick on=timer(250ms) do= x := x + 1`;
    const program = parse(lex(src));
    const r = program.defs[1] as ReducerDef;
    if (r.on.kind !== "TimerEvent") throw new Error("expected TimerEvent");
    expect(r.on.intervalMs).toBe(250);
  });

  it("parses a named timer event", () => {
    const src = `slot x : Int = 0
reducer tick on=timer(1s, name=countdown) do= x := x + 1`;
    const program = parse(lex(src));
    const r = program.defs[1] as ReducerDef;
    if (r.on.kind !== "TimerEvent") throw new Error("expected TimerEvent");
    expect(r.on.intervalMs).toBe(1000);
    expect(r.on.name).toBe("countdown");
  });

  it("parses a stop-timer statement", () => {
    const src = `slot x : Int = 0
reducer tick on=timer(1s, name=t) do= x := x + 1
reducer stop on=ui.click(B) do= stop-timer(t)`;
    const program = parse(lex(src));
    const r = program.defs[2] as ReducerDef;
    const stmt = r.do[0];
    expect(stmt.kind).toBe("StopTimer");
    if (stmt.kind !== "StopTimer") throw new Error("expected StopTimer");
    expect(stmt.name).toBe("t");
  });

  // Closed-set lifecycle events (docs/spec/language.md §1.6.1, lifecycle.md
  // §7.1). The parser must accept every legal name, encode `tile.mount(X)` /
  // `route.error("/p")` with their argument so the runtime can match by
  // identity, and reject unknown variants.
  it("parses the full app.* lifecycle event set", () => {
    const src = `slot s : Bool = false
reducer aStop    on=app.stop     do= s := true
reducer aShow    on=app.visible  do= s := true
reducer aHide    on=app.hidden   do= s := true
reducer aOn      on=app.online   do= s := true
reducer aOff     on=app.offline  do= s := true
reducer a401     on=app.http-401 do= s := true
reducer a403     on=app.http-403 do= s := true
reducer a5xx     on=app.http-5xx do= s := true`;
    const program = parse(lex(src));
    const names = (program.defs.filter((d) => d.kind === "ReducerDef") as ReducerDef[]).map((r) =>
      r.on.kind === "LifecycleEvent" ? r.on.name : null,
    );
    expect(names).toEqual([
      "app.stop",
      "app.visible",
      "app.hidden",
      "app.online",
      "app.offline",
      "app.http-401",
      "app.http-403",
      "app.http-5xx",
    ]);
  });

  it("encodes tile.mount(X) / tile.unmount(X) with the tile name", () => {
    const src = `slot s : Int = 0
reducer up on=tile.mount(Panel)   do= s := s + 1
reducer dn on=tile.unmount(Panel) do= s := s - 1`;
    const program = parse(lex(src));
    const [up, dn] = (program.defs as ReducerDef[]).slice(1, 3);
    expect(up?.on.kind).toBe("LifecycleEvent");
    if (up?.on.kind !== "LifecycleEvent") throw new Error("expected LifecycleEvent");
    expect(up.on.name).toBe('tile.mount("Panel")');
    if (dn?.on.kind !== "LifecycleEvent") throw new Error("expected LifecycleEvent");
    expect(dn.on.name).toBe('tile.unmount("Panel")');
  });

  it('encodes route.error("/p") with the route pattern', () => {
    const src = `slot s : Bool = false
reducer onErr on=route.error("/p") do= s := true`;
    const program = parse(lex(src));
    const r = program.defs[1] as ReducerDef;
    if (r.on.kind !== "LifecycleEvent") throw new Error("expected LifecycleEvent");
    expect(r.on.name).toBe('route.error("/p")');
  });

  // Issue #85: nested routes — `sub-routes = {...}` on a tile must be parsed
  // into TileDef.subRoutes (previously the parser swallowed and discarded it).
  it("stores tile sub-routes on TileDef.subRoutes", () => {
    const src = `tile Layout
  sub-routes = {
    "/settings/account" -> Account,
    "/settings"         -> Home,
    "/legacy"           ->> "/settings"
  }
  = page(route-outlet())`;
    const program = parse(lex(src));
    const tile = program.defs[0] as TileDef;
    expect(tile.kind).toBe("TileDef");
    expect(tile.subRoutes).toEqual([
      { path: "/settings/account", tile: "Account", tilePos: { line: 3, col: 28 } },
      { path: "/settings", tile: "Home", tilePos: { line: 4, col: 28 } },
      // A `->>` redirect targets a path, not a tile, so there is nothing to
      // point at and nothing for `rename` to rewrite.
      { path: "/legacy", tile: ">>/settings" },
    ]);
  });

  it("parses `@colors.surface` inside a style block as a TokenRef expression (§4.3)", () => {
    const src = `tile Card = box() {style: {background: @colors.surface}}`;
    const program = parse(lex(src));
    const tile = program.defs[0] as TileDef;
    const styleProp = tile.body.props.find((p) => p.name === "style");
    if (!styleProp) throw new Error("expected a style prop");
    if (styleProp.value.kind !== "RecordLit") throw new Error("expected a RecordLit");
    const field = styleProp.value.fields[0];
    expect(field?.name).toBe("background");
    expect(field?.value).toMatchObject({
      kind: "TokenRef",
      group: "colors",
      path: ["surface"],
    });
  });

  it("parses nested token paths like `@typography.size.lg` (§4.3)", () => {
    const src = `tile Card = box() {style: {font-size: @typography.size.lg}}`;
    const program = parse(lex(src));
    const tile = program.defs[0] as TileDef;
    const styleProp = tile.body.props.find((p) => p.name === "style");
    if (styleProp?.value.kind !== "RecordLit") throw new Error("expected style record");
    expect(styleProp.value.fields[0]?.value).toMatchObject({
      kind: "TokenRef",
      group: "typography",
      path: ["size", "lg"],
    });
  });

  it("rejects a bare `@` with no identifier", () => {
    expect(() => parse(lex(`tile Card = box() {style: {bg: @}}`))).toThrow(/token reference|@/i);
  });

  it("rejects an ungrouped `@name` token reference", () => {
    // `@colors` alone is meaningless — a token always lives under a group
    expect(() => parse(lex(`tile Card = box() {style: {bg: @colors}}`))).toThrow(
      /token reference|@/i,
    );
  });

  it("rejects unknown lifecycle event names", () => {
    expect(() =>
      parse(
        lex(`slot s : Int = 0
reducer bad on=app.bogus do= s := 1`),
      ),
    ).toThrow(/Unknown app lifecycle event/);
    expect(() =>
      parse(
        lex(`slot s : Int = 0
reducer bad on=tile.bogus(X) do= s := 1`),
      ),
    ).toThrow(/Unknown tile lifecycle event/);
    expect(() =>
      parse(
        lex(`slot s : Int = 0
reducer bad on=route.bogus("/p") do= s := 1`),
      ),
    ).toThrow(/Unknown route lifecycle event/);
  });

  // issue #91 — language.md §1.6.1 lists eight ui-kinds, but ui.key / ui.hover
  // were never wired into the parser. These two cases lock the parser-side.
  it("parses ui.key(Tile) event pattern (§1.6.1)", () => {
    const src = `slot k : Text = ""
reducer onKey on=ui.key(Box) do= k := "hit"
tile Box = input(bind=k)`;
    const program = parse(lex(src));
    const r = program.defs.find((d) => d.kind === "ReducerDef") as ReducerDef;
    if (r.on.kind !== "UiEvent") throw new Error("expected UiEvent");
    expect(r.on.ev).toBe("key");
    expect(r.on.selector.tile).toBe("Box");
  });

  it("parses ui.hover(Tile) event pattern (§1.6.1)", () => {
    const src = `slot h : Bool = false
reducer onHover on=ui.hover(Card) do= h := true
tile Card = box() {}`;
    const program = parse(lex(src));
    const r = program.defs.find((d) => d.kind === "ReducerDef") as ReducerDef;
    if (r.on.kind !== "UiEvent") throw new Error("expected UiEvent");
    expect(r.on.ev).toBe("hover");
    expect(r.on.selector.tile).toBe("Card");
  });

  // issue #122 — §1.6.1 ui.focus / ui.blur were accepted by the parser
  // alongside ui.key / ui.hover, but never lifted by codegen / runtime.
  // These cases lock the parser-side so a regression on either kind fails fast.
  it("parses ui.focus(Tile) event pattern (§1.6.1)", () => {
    const src = `slot f : Text = ""
reducer onFocus on=ui.focus(InputX) do= f := "focused"
tile InputX = input(bind=f)`;
    const program = parse(lex(src));
    const r = program.defs.find((d) => d.kind === "ReducerDef") as ReducerDef;
    if (r.on.kind !== "UiEvent") throw new Error("expected UiEvent");
    expect(r.on.ev).toBe("focus");
    expect(r.on.selector.tile).toBe("InputX");
  });

  it("parses ui.blur(Tile) event pattern (§1.6.1)", () => {
    const src = `slot b : Int = 0
reducer onBlur on=ui.blur(InputX) do= b := b + 1
tile InputX = input(bind=b)`;
    const program = parse(lex(src));
    const r = program.defs.find((d) => d.kind === "ReducerDef") as ReducerDef;
    if (r.on.kind !== "UiEvent") throw new Error("expected UiEvent");
    expect(r.on.ev).toBe("blur");
    expect(r.on.selector.tile).toBe("InputX");
  });

  // issue #91 — language.md §1.9 lists tuple patterns in the grammar.
  // Tuple values are introduced by `List(T).zip(U)`, so a tuple pattern matches
  // over a `Tuple(T, U)`-typed value (here, a fn parameter).
  it("parses a tuple pattern `(x, y)` in a match arm (§1.9)", () => {
    const src = `type Light = Red | Green
fn f(p: Tuple(Light, Light)) -> Text = match p with
  | (Red, Green) -> "rg"
  | (x, y) -> "other"`;
    const program = parse(lex(src));
    const fn = program.defs.find((d) => d.kind === "FnDef") as { kind: "FnDef"; body: unknown };
    const body = fn.body as { kind: string; arms: { pattern: { kind: string } }[] };
    expect(body.kind).toBe("MatchExpr");
    expect(body.arms[0]?.pattern.kind).toBe("PTuple");
    expect(body.arms[1]?.pattern.kind).toBe("PTuple");
  });

  it("rejects a single-element parenthesized pattern (no grouping in patterns)", () => {
    const src = `type Light = Red | Green
fn f(p: Tuple(Light, Light)) -> Text = match p with
  | (x) -> "n/a"`;
    expect(() => parse(lex(src))).toThrow(/Tuple pattern requires at least 2 items/);
  });

  // issue #102 — http.cancel + EffectId.
  it("parses `let id = emit X(...)` as a LetStmt with an EmitExpr rhs (#102)", () => {
    const src = `slot id : EffectId = EffectId.none
effect fetchQuote cap=http.get in=Unit out=Result(Text, HttpError)
reducer load on=ui.click(Btn) do= let h = emit fetchQuote()
                                  id := h
tile Btn = button(text="go", onClick=load)
tile App = column(Btn)
app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]`;
    const program = parse(lex(src));
    const r = program.defs.find((d) => d.kind === "ReducerDef") as ReducerDef;
    expect(r.do[0]).toMatchObject({
      kind: "LetStmt",
      name: "h",
      rhs: { kind: "EmitExpr", effect: "fetchQuote" },
    });
    expect(r.do[1]).toMatchObject({
      kind: "SlotAssign",
      lvalue: { kind: "LSlot", name: "id" },
      rhs: { kind: "Ref", name: "h" },
    });
  });

  it("parses `EffectId` as a primitive type and `EffectId.none` as a Call (#102)", () => {
    const src = `slot id : EffectId = EffectId.none
tile App = text("x")
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const program = parse(lex(src));
    const slot = program.defs.find((d) => d.kind === "SlotDef") as SlotDef;
    expect(slot.type).toMatchObject({ kind: "TypePrim", name: "EffectId" });
    expect(slot.init).toMatchObject({ kind: "Call", callee: "EffectId.none" });
  });
});
