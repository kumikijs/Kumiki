import { readFileSync } from "node:fs";
import { app } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

const COUNTER_PATH = app("01-counter");

describe("typecheck", () => {
  it("accepts the counter example", () => {
    const src = readFileSync(COUNTER_PATH, "utf8");
    const errors = checkSource(src);
    expect(errors).toEqual([]);
  });

  it("reports an unimplemented method (E0801)", () => {
    const src = `
      slot raw : Text = ""
      slot n : Result(Int, Text) = Ok(0)
      reducer e on=ui.input(In) do= n := Int.parse(raw).to-result("nope")
      tile In = input(bind=raw)
      tile App = column(In)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0801" && e.message.includes("to-result"))).toBe(true);
  });

  it("does not flag implemented methods", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      fn s(ys: List(Int)) -> Int = ys.fold(0, $1 + $2)
      reducer r on=ui.click(B) do= xs := xs.filter($1 > 1)
      tile B = button(text="b")
      tile App = column(B, text(s(xs).show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src).some((e) => e.code === "E0801")).toBe(false);
  });

  it("accepts a named timer with a matching stop-timer", () => {
    const src = `
      slot x : Int = 0
      reducer tick on=timer(1s, name=t) do= x := x + 1
      reducer stop on=ui.click(B) do= stop-timer(t)
      tile B = button(text="stop", onClick=stop)
      tile App = column(B, text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });

  it("reports stop-timer to an undefined timer name (E0106)", () => {
    const src = `
      slot x : Int = 0
      reducer tick on=timer(1s, name=t) do= x := x + 1
      reducer stop on=ui.click(B) do= stop-timer(nope)
      tile B = button(text="stop", onClick=stop)
      tile App = column(B, text(x.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0106" && e.message.includes("nope"))).toBe(true);
  });

  it("reports duplicate timer names (E0002)", () => {
    const src = `
      slot x : Int = 0
      slot y : Int = 0
      reducer a on=timer(1s, name=dup) do= x := x + 1
      reducer b on=timer(2s, name=dup) do= y := y + 1
      tile App = column(text(x.show), text(y.show))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0002" && e.message.includes("dup"))).toBe(true);
  });

  it("accepts a `@token` reference under a known group", () => {
    const src = `
      tile Card = box() {style: {background: @colors.surface, padding: @spacing.md, radius: @radius.md, shadow: @shadow.sm}}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });

  it("reports an unknown token group as E0110", () => {
    const src = `
      tile Card = box() {style: {background: @nope.foo}}
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0110" && e.message.includes("nope"))).toBe(true);
  });

  it("accepts the overlay builtin", () => {
    const src = `
      slot open : Bool = false
      reducer show on=ui.click(B) do= open := true
      tile B = button(text="open", onClick=show)
      tile M = card(text("modal"))
      tile App = overlay(B, when(open, M())) {align: "top"}
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkSource(src)).toEqual([]);
  });

  it("reports undefined slot reference (E0103)", () => {
    const src = `
      slot count : Int = 0
      reducer r on=ui.click(B) do= count := usres
      tile B = button(text="b")
      app A caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0103" && e.message.includes("usres"))).toBe(true);
  });

  it("reports undefined tile in body (E0105)", () => {
    const src = `
      tile A = column(MissingThing)
      app App caps=[] routes={"/" -> A, "/404" -> A} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0105" && e.message.includes("MissingThing"))).toBe(true);
  });

  it("reports undefined route target (E0105)", () => {
    const src = `
      tile A = column()
      app App caps=[] routes={"/" -> A, "/x" -> Ghost, "/404" -> A} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0105" && e.message.includes("Ghost"))).toBe(true);
  });

  it("reports an error-boundary that names no tile (E0105)", () => {
    const src = `
      tile Fallback in=PanicInfo = column(text($1.message))
      tile A error-boundary=Nope = column()
      app App caps=[] routes={"/" -> A, "/404" -> A} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.map((e) => e.code)).toEqual(["E0105"]);
    const found = errors.filter((e) => e.code === "E0105");
    expect(found[0]?.message).toBe('Tile "A" declares error-boundary "Nope", which is not a tile');
    expect(found[0]?.pos.line).toBe(3);
    expect(checkSource(src.replace("Nope", "Fallback"))).toEqual([]);
  });

  it("reports duplicate slot writes in one reducer (E0601)", () => {
    const src = `
      slot count : Int = 0
      tile B = button(text="b")
      reducer r on=ui.click(B) do= count := count + 1; count := 0
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(true);
  });

  it("reports undefined reducer in event handler (E0102)", () => {
    const src = `
      tile B = button(text="b") {onClick: nope}
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0102" && e.message.includes("nope"))).toBe(true);
  });

  it("requires /404 route entry", () => {
    const src = `
      tile A = column()
      app App caps=[] routes={"/" -> A} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0001")).toBe(true);
  });

  it("allows the same slot to be written in both if/else branches", () => {
    const src = `
      slot x : Int = 0
      slot y : Bool = true
      reducer r on=ui.click(B) do=
        if y
          then x := 1
          else x := 2
      tile B = button(text="b")
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(false);
  });

  it("still flags duplicate writes on the same sequential path", () => {
    const src = `
      slot x : Int = 0
      reducer r on=ui.click(B) do=
        x := 1
        x := 2
      tile B = button(text="b")
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(true);
  });

  it("flags writing the same slot after an if/else that already wrote it", () => {
    const src = `
      slot x : Int = 0
      slot y : Bool = true
      reducer r on=ui.click(B) do=
        if y then x := 1 else x := 2
        x := 3
      tile B = button(text="b")
      app App caps=[] routes={"/" -> B, "/404" -> B} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0601")).toBe(true);
  });

  it("does not flag the stdlib list, map, set and text methods (no E0801)", () => {
    const decls = [
      `fn f(xs: List(Int), ys: List(Int)) -> List(Int) = xs.concat(ys)`,
      `fn f(xs: List(Int)) -> List(Int) = xs.prepend(0)`,
      `fn f(xs: List(Int)) -> List(List(Int)) = xs.chunk(2)`,
      `fn f(xs: List(Int), ys: List(Int)) -> List(Tuple(Int, Int)) = xs.zip(ys)`,
      `fn f(a: Map(Text, Int), b: Map(Text, Int)) -> Map(Text, Int) = a.merge(b)`,
      `fn f(a: Map(Text, Int)) -> Map(Text, Int) = a.update("k", $1 + 1)`,
      `fn f(s: Set(Text)) -> Set(Text) = s.add("x")`,
      `fn f(a: Set(Text), b: Set(Text)) -> Set(Text) = a.union(b)`,
      `fn f(a: Set(Text), b: Set(Text)) -> Set(Text) = a.intersect(b)`,
      `fn f(o: Option(Int), p: Option(Int)) -> Option(Int) = o.or(p)`,
      `fn f(r: Result(Int, Text)) -> Result(Int, Text) = r.map-err($1)`,
      `fn f(t: Text) -> Text = t.replace("a", "b")`,
      `fn f(a: Int, b: Int) -> Int = a.min(b)`,
      `fn f(a: Int, b: Int) -> Int = a.max(b)`,
      `fn f(a: Int) -> Int = a.clamp(0, 10)`,
    ];
    const wrap = (decl: string) =>
      `${decl}\n      tile App = column(text("x"))\n      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    const failing = decls.filter((decl) => checkSource(wrap(decl)).some((e) => e.code === "E0801"));
    expect(failing).toEqual([]);
  });

  it("still flags genuinely unknown methods (E0801)", () => {
    const src = `
      slot xs : List(Int) = [1, 2, 3]
      fn f(ys: List(Int)) -> List(Int) = ys.frobnicate(1)
      tile App = column(text("x"))
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(
      checkSource(src).some((e) => e.code === "E0801" && e.message.includes("frobnicate")),
    ).toBe(true);
  });
});
