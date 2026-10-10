import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";

describe("undefined tile in ui.* selector (E0211)", () => {
  it("reports a reducer that targets an undeclared tile", () => {
    const src = `
      slot x : Int = 0
      reducer r on=ui.click(NonExistent) do= x := x + 1
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0211" && e.message.includes("NonExistent"))).toBe(true);
  });

  it("accepts a reducer that targets a declared tile (with or without #id)", () => {
    const src = `
      slot x : Int = 0
      reducer rA on=ui.click(B)      do= x := x + 1
      reducer rB on=ui.click(B#main) do= x := x + 1
      tile B = button(text="b") {id: "main"}
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0211")).toBe(false);
  });

  it("accepts the _ wildcard selector for indirectly-dispatched reducers", () => {
    const src = `
      slot x : Int = 0
      reducer cb on=ui.click(_) do= x := x + 1
      tile App = column()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0211")).toBe(false);
  });
});

describe("W0212 ui-event-tile-mismatch", () => {
  it("flags a direct builtin mismatch (ui.focus on a box)", () => {
    const src = `
      slot f : Text = ""
      reducer rf on=ui.focus(Card) do= f := "x"
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const w = errors.find((e) => e.code === "W0212");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("warning");
    expect(w?.message).toContain("observed in body");
    expect(w?.message).toContain("box");
  });

  it("suppresses the warning when a focusable descendant is in the cascade body", () => {
    const src = `
      slot x : Int = 0
      reducer rc on=ui.click(Outer) do= x := x + 1
      tile Outer = row(text("hi"), check(checked=false))
      tile App = column(Outer)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("accepts a direct builtin match (ui.focus on an input)", () => {
    const src = `
      slot f : Text = ""
      reducer rf on=ui.focus(In) do= f := "x"
      tile In = input(bind=f)
      tile App = column(In)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("walks an alias chain to find the builtin root (accepts Outer = Inner = input)", () => {
    const src = `
      slot f : Text = ""
      reducer rf on=ui.focus(Outer) do= f := "x"
      tile Inner = input(bind=f)
      tile Outer = Inner
      tile App = column(Outer)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("walks an alias chain to flag a mismatch (ui.click on Wrap → Box2 → box)", () => {
    const src = `
      slot x : Int = 0
      reducer rc on=ui.click(Wrap) do= x := x + 1
      tile Box2 = box(text("hi"))
      tile Wrap = Box2
      tile App = column(Wrap)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const w = errors.find((e) => e.code === "W0212");
    expect(w).toBeDefined();
    expect(w?.message).toContain("box");
  });

  it("never warns for ui.hover (any tile is allowed)", () => {
    const src = `
      slot x : Int = 0
      reducer rh on=ui.hover(Card) do= x := x + 1
      tile Card = box(text("hi"))
      tile App = column(Card)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("never warns for the wildcard selector ui.click(_)", () => {
    const src = `
      slot x : Int = 0
      reducer rc on=ui.click(_) do= x := x + 1
      tile App = column()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("emits only E0211 (no W0212) when the selector tile is undeclared", () => {
    const src = `
      slot x : Int = 0
      reducer rc on=ui.click(Missing) do= x := x + 1
      tile App = column()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "E0211")).toBe(true);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("descends into a TileFor body — `for ... box(...)` warns because box never fires click", () => {
    const src = `
      slot xs : List(Int) = [1, 2]
      slot s : Text = ""
      reducer rc on=ui.click(Dyn) do= s := "x"
      tile Dyn = for n in xs box(text("n"))
      tile App = column(Dyn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const w = errors.find((e) => e.code === "W0212");
    expect(w).toBeDefined();
    expect(w?.message).toContain("box");
  });

  it("suppresses the warning when a TileFor body resolves to an allowed root", () => {
    const src = `
      slot xs : List(Int) = [1, 2]
      slot s : Text = ""
      reducer rc on=ui.click(Dyn) do= s := "x"
      tile Dyn = for n in xs button(text="n")
      tile App = column(Dyn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("descends into a TileWhen body — `when(...) box(...)` warns for ui.click", () => {
    const src = `
      slot c : Bool = true
      slot s : Text = ""
      reducer rc on=ui.click(Dyn) do= s := "x"
      tile Dyn = when(c, box(text("hi")))
      tile App = column(Dyn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(true);
  });

  it("descends into BOTH branches of a TileIf — accepts when either branch is allowed", () => {
    const src = `
      slot c : Bool = true
      slot v : Text = ""
      reducer rf on=ui.focus(T) do= v := "x"
      tile T = if c then input(bind=v) else button(text="b")
      tile App = column(T)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("warns when BOTH branches of a TileIf are disallowed", () => {
    const src = `
      slot c : Bool = true
      slot s : Text = ""
      reducer rc on=ui.click(T) do= s := "x"
      tile T = if c then box(text("a")) else row(text("b"))
      tile App = column(T)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const w = errors.find((e) => e.code === "W0212");
    expect(w).toBeDefined();
    expect(w?.message).toContain("box");
    expect(w?.message).toContain("row");
  });

  it("descends into all arms of a TileMatch — accepts when any arm is allowed", () => {
    const src = `
      type Mode = A | B
      slot m : Mode = A
      slot s : Text = ""
      reducer rc on=ui.click(T) do= s := "x"
      tile T = match m with
                 | A -> button(text="ok")
                 | B -> box(text("x"))
      tile App = column(T)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((e) => e.code === "W0212")).toBe(false);
  });

  it("warns when EVERY arm of a TileMatch is disallowed", () => {
    const src = `
      type Mode = A | B
      slot m : Mode = A
      slot s : Text = ""
      reducer rc on=ui.click(T) do= s := "x"
      tile T = match m with
                 | A -> box(text("a"))
                 | B -> row(text("b"))
      tile App = column(T)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const w = errors.find((e) => e.code === "W0212");
    expect(w).toBeDefined();
  });

  it("warns on ui.click(<link tile>) — runtime reserves link click for nav", () => {
    const src = `
      slot s : Text = ""
      reducer rc on=ui.click(L) do= s := "x"
      tile L = link(to="/x", text="x")
      tile App = column(L)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    const w = errors.find((e) => e.code === "W0212");
    expect(w).toBeDefined();
    expect(w?.message).toContain("link");
  });
});

describe("selector id mismatch (E0212, strictSelectorId)", () => {
  const checkStrict = (src: string) => checkSource(src, { strictSelectorId: true });

  it("flags a literal id mismatch under strictSelectorId", () => {
    const src = `
      slot x : Int = 0
      reducer add on=ui.submit(NewForm#nw) do= x := x + 1
      tile NewForm = form(text="a") {id: "new"}
      tile App = column(NewForm)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkStrict(src);
    const e = errors.find((d) => d.code === "E0212");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("selector-id-mismatch");
    expect(e?.message).toContain("NewForm#nw");
    expect(e?.message).toContain('"new"');
    expect(e?.message).toContain("can never match");
  });

  it("does NOT emit E0212 by default (default-off)", () => {
    const src = `
      slot x : Int = 0
      reducer add on=ui.submit(NewForm#nw) do= x := x + 1
      tile NewForm = form(text="a") {id: "new"}
      tile App = column(NewForm)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkSource(src);
    expect(errors.some((d) => d.code === "E0212")).toBe(false);
  });

  it("accepts a literal id that matches", () => {
    const src = `
      slot x : Int = 0
      reducer add on=ui.submit(NewForm#new) do= x := x + 1
      tile NewForm = form(text="a") {id: "new"}
      tile App = column(NewForm)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("silently passes when the tile has no {id} prop (runtime filter is authoritative)", () => {
    const src = `
      slot x : Int = 0
      reducer add on=ui.submit(NewForm#any) do= x := x + 1
      tile NewForm = form(text="a")
      tile App = column(NewForm)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("silently passes when the tile's {id} value is a non-Str expression", () => {
    const src = `
      slot x : Int = 0
      slot dynId : Text = "new"
      reducer add on=ui.submit(NewForm#anything) do= x := x + 1
      tile NewForm = form(text="a") {id: dynId}
      tile App = column(NewForm)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("silently passes when the selector has no #id", () => {
    const src = `
      slot x : Int = 0
      reducer add on=ui.click(NewBtn) do= x := x + 1
      tile NewBtn = button(text="a") {id: "new"}
      tile App = column(NewBtn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("silently passes for the _ wildcard selector", () => {
    const src = `
      slot x : Int = 0
      reducer cb on=ui.click(_) do= x := x + 1
      tile App = column()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("prefers E0211 over E0212 when the tile itself is undeclared", () => {
    const src = `
      slot x : Int = 0
      reducer add on=ui.submit(Missing#nw) do= x := x + 1
      tile App = column()
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkStrict(src);
    expect(errors.some((d) => d.code === "E0211")).toBe(true);
    expect(errors.some((d) => d.code === "E0212")).toBe(false);
  });

  it("accepts a match with any literal id present in a TileIf branch", () => {
    const src = `
      slot mode : Bool = true
      slot x : Int = 0
      reducer add on=ui.click(NewBtn#alt) do= x := x + 1
      tile NewBtn = if mode then button(text="a") {id: "main"} else button(text="b") {id: "alt"}
      tile App = column(NewBtn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("flags a TileIf where NEITHER branch's literal id matches", () => {
    const src = `
      slot mode : Bool = true
      slot x : Int = 0
      reducer add on=ui.click(NewBtn#nope) do= x := x + 1
      tile NewBtn = if mode then button(text="a") {id: "main"} else button(text="b") {id: "alt"}
      tile App = column(NewBtn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkStrict(src);
    const e = errors.find((d) => d.code === "E0212");
    expect(e).toBeDefined();
    expect(e?.message).toContain("main");
    expect(e?.message).toContain("alt");
  });

  it("stays silent when a TileIf branch has a computed {id} (dynamic-anywhere → skip)", () => {
    const src = `
      slot mode : Bool = true
      slot dynId : Text = "x"
      slot x : Int = 0
      reducer add on=ui.click(NewBtn#nope) do= x := x + 1
      tile NewBtn = if mode then button(text="a") {id: "main"} else button(text="b") {id: dynId}
      tile App = column(NewBtn)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("flags a TileMatch where every arm's literal id mismatches", () => {
    const src = `
      type Mode = A | B
      slot m : Mode = A
      slot x : Int = 0
      reducer add on=ui.click(T#nope) do= x := x + 1
      tile T = match m with
                 | A -> button(text="a") {id: "one"}
                 | B -> button(text="b") {id: "two"}
      tile App = column(T)
      app App caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkStrict(src);
    const e = errors.find((d) => d.code === "E0212");
    expect(e).toBeDefined();
    expect(e?.message).toContain("one");
    expect(e?.message).toContain("two");
  });

  it("accepts a TileMatch where any arm's literal id matches", () => {
    const src = `
      type Mode = A | B
      slot m : Mode = A
      slot x : Int = 0
      reducer add on=ui.click(T#two) do= x := x + 1
      tile T = match m with
                 | A -> button(text="a") {id: "one"}
                 | B -> button(text="b") {id: "two"}
      tile App = column(T)
      app App caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("stays silent when any TileMatch arm has no {id} prop", () => {
    const src = `
      type Mode = A | B
      slot m : Mode = A
      slot x : Int = 0
      reducer add on=ui.click(T#nope) do= x := x + 1
      tile T = match m with
                 | A -> button(text="a") {id: "one"}
                 | B -> button(text="b")
      tile App = column(T)
      app App caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    expect(checkStrict(src).some((d) => d.code === "E0212")).toBe(false);
  });

  it("descends into TileFor body — a literal id mismatch under `for` still fires E0212", () => {
    const src = `
      slot xs : List(Int) = [1, 2]
      slot x : Int = 0
      reducer add on=ui.click(T#nope) do= x := x + 1
      tile T = for n in xs
                 button(text=n.show) {id: "row"}
      tile App = column(T)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkStrict(src);
    const e = errors.find((d) => d.code === "E0212");
    expect(e).toBeDefined();
    expect(e?.message).toContain("row");
  });

  it("descends into TileWhen body — a literal id mismatch under `when` still fires E0212", () => {
    const src = `
      slot visible : Bool = true
      slot x : Int = 0
      reducer add on=ui.click(T#nope) do= x := x + 1
      tile T = when(visible, button(text="hi") {id: "gate"})
      tile App = column(T)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const errors = checkStrict(src);
    const e = errors.find((d) => d.code === "E0212");
    expect(e).toBeDefined();
    expect(e?.message).toContain("gate");
  });
});
