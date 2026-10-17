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

  it("walks a nested tile's error-boundary fallback, which renders in its place", () => {
    // `Risky`'s own fallback replaces `Risky`'s tree, so `ui.click(Risky)` has nothing to land on.
    const src = `
      slot s : Text = ""
      reducer outer on=ui.click(Outer) do= s := "x"
      reducer risky on=ui.click(Risky) do= s := "y"
      tile Fallback in=PanicInfo = button(text="retry")
      tile Risky error-boundary = Fallback = text("risky")
      tile Outer = row(Risky)
      tile App = column(Outer)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const warned = checkSource(src)
      .filter((e) => e.code === "W0212")
      .map((e) => /Reducer "([^"]+)"/.exec(e.message)?.[1]);
    expect(warned).toEqual(["risky"]);
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

  describe("reads the ids of the elements the subscription is wired onto", () => {
    const flagged = (src: string): string[] =>
      checkStrict(src)
        .filter((d) => d.code === "E0212")
        .map((d) => /Reducer "([^"]+)"/.exec(d.message)?.[1] ?? d.message);
    const program = (body: string, routes = "P"): string =>
      [
        'slot log : Text = ""',
        body,
        `app A caps=[] routes={"/" -> ${routes}, "/404" -> ${routes}} init=[]`,
      ].join("\n");

    it("matches a container's selector against its descendants, not its own id", () => {
      const src = program(`
reducer hitB on=ui.click(Bar#save) do= log := log + "save;"
reducer hitA on=ui.click(Bar#bar) do= log := log + "bar;"
tile Bar = row(button(text="Save", id="save"), button(text="Other", id="other")) {id: "bar"}
tile Btn2 = button(text="Two", id="two")
reducer hit2 on=ui.click(Btn2#tow) do= log := log + "two;"
tile P = column(Bar, Btn2, text("log=" + log))`);
      expect(flagged(src)).toEqual(["hitA", "hit2"]);
      const bar = checkStrict(src).find((d) => d.message.includes("Bar#bar"));
      expect(bar?.message).toContain('"other" | "save"');
      expect(bar?.message).toContain("can never match");
    });

    it('reads an id written as id="…" as well as {id: "…"}, the block when both are', () => {
      const src = program(`
tile L2 = button(text="l2", id="l2")
tile B7 = button(text="b7", id="arg7") {id: "block7"}
reducer argOk    on=ui.click(L2#l2)     do= log := log + "x"
reducer argBad   on=ui.click(L2#zz)     do= log := log + "x"
reducer blockOk  on=ui.click(B7#block7) do= log := log + "x"
reducer shadowed on=ui.click(B7#arg7)   do= log := log + "x"
tile P = column(L2, B7)`);
      expect(flagged(src)).toEqual(["argBad", "shadowed"]);
    });

    it("follows a descendant written as a tile reference, at the root or nested", () => {
      const src = program(`
tile Inner  = button(text="i", id="inner")
tile Nested = box(Inner)
tile Alias  = Inner
tile Boxed  = box(Inner) {id: "boxed"}
reducer nestedOk  on=ui.click(Nested#inner) do= log := log + "x"
reducer nestedBad on=ui.click(Nested#zz)    do= log := log + "x"
reducer aliasOk   on=ui.click(Alias#inner)  do= log := log + "x"
reducer aliasBad  on=ui.click(Alias#zz)     do= log := log + "x"
reducer boxedOk   on=ui.click(Boxed#inner)  do= log := log + "x"
reducer boxedBad  on=ui.click(Boxed#boxed)  do= log := log + "x"
tile P = column(Nested, Alias, Boxed)`);
      expect(flagged(src)).toEqual(["nestedBad", "aliasBad", "boxedBad"]);
    });

    it("takes only the elements that fire the selector's event", () => {
      const src = program(`
slot q : Text = ""
tile S = form(input(bind=q, id="q"), button(text="go", type="submit", id="g")) {id: "f"}
reducer submitOk  on=ui.submit(S#f) do= log := log + "x"
reducer submitBad on=ui.submit(S#q) do= log := log + "x"
reducer inputOk   on=ui.input(S#q)  do= log := log + "x"
reducer inputBad  on=ui.input(S#g)  do= log := log + "x"
reducer inputForm on=ui.input(S#f)  do= log := log + "x"
reducer changeOk  on=ui.change(S#q) do= log := log + "x"
reducer clickOk   on=ui.click(S#g)  do= log := log + "x"
reducer clickBad  on=ui.click(S#q)  do= log := log + "x"
reducer keyOk     on=ui.key(S#q)    do= log := log + "x"
reducer focusForm on=ui.focus(S#f)  do= log := log + "x"
reducer hoverForm on=ui.hover(S#f)  do= log := log + "x"
reducer hoverBtn  on=ui.hover(S#g)  do= log := log + "x"
reducer hoverBad  on=ui.hover(S#zz) do= log := log + "x"
tile P = column(S)`);
      expect(flagged(src)).toEqual([
        "submitBad",
        "inputBad",
        "inputForm",
        "clickBad",
        "focusForm",
        "hoverBad",
      ]);
    });

    it("descends through for / if / match / when children of a container", () => {
      const src = program(`
type Mode = Ma | Mb
slot flag : Bool = true
slot m : Mode = Ma
slot xs : List(Text) = ["p"]
tile F = column(for s in xs button(text=s, id="f"))
tile I = row(if flag then button(text="i1", id="i1") else button(text="i2") {id: "i2"})
tile M = row(match m with
               | Ma -> button(text="ma", id="ma")
               | Mb -> button(text="mb", id="mb"))
tile W = row(when(flag, button(text="w", id="w")))
reducer forOk    on=ui.click(F#f)  do= log := log + "x"
reducer forBad   on=ui.click(F#zz) do= log := log + "x"
reducer ifOk     on=ui.click(I#i2) do= log := log + "x"
reducer ifBad    on=ui.click(I#zz) do= log := log + "x"
reducer matchOk  on=ui.click(M#mb) do= log := log + "x"
reducer matchBad on=ui.click(M#zz) do= log := log + "x"
reducer whenOk   on=ui.click(W#w)  do= log := log + "x"
reducer whenBad  on=ui.click(W#zz) do= log := log + "x"
tile P = column(F, I, M, W)`);
      expect(flagged(src)).toEqual(["forBad", "ifBad", "matchBad", "whenBad"]);
    });

    it("stays silent when a wired element's id is computed or missing", () => {
      const src = program(`
slot n : Int = 0
tile Computed = row(button(text="c", id=n.show), button(text="d", id="d"))
tile Missing  = row(button(text="e"), button(text="f", id="f"))
tile Known    = row(button(text="g", id="g"), button(text="h", id="h"))
reducer computed on=ui.click(Computed#zz) do= log := log + "x"
reducer missing  on=ui.click(Missing#zz)  do= log := log + "x"
reducer known    on=ui.click(Known#zz)    do= log := log + "x"
tile P = column(Computed, Missing, Known)`);
      expect(flagged(src)).toEqual(["known"]);
    });

    it("takes the id a call site writes on a user tile as its root's", () => {
      // `Three`'s call site writes another prop, which leaves the id to the runtime.
      const src = program(`
tile Four  = button(text="four") {id: "four"}
tile Three = button(text="three", id="three")
tile Five  = button(text="five", id="b5")
tile Wrap  = row(Five {id: "w5"})
reducer callSiteId  on=ui.click(Four#five) do= log := log + "x"
reducer ownId       on=ui.click(Four#four) do= log := log + "x"
reducer neither     on=ui.click(Four#six)  do= log := log + "x"
reducer otherProp   on=ui.click(Three#zz)  do= log := log + "x"
reducer wrapCallSite on=ui.click(Wrap#w5)  do= log := log + "x"
reducer wrapOwnId   on=ui.click(Wrap#b5)   do= log := log + "x"
tile P = column(Four(id="five"), Four, Three {variant: "ghost"}, Wrap)`);
      expect(flagged(src)).toEqual(["neither", "wrapOwnId"]);
      const neither = checkStrict(src).find((d) => d.message.includes("Four#six"));
      expect(neither?.message).toContain('"five" | "four"');
    });

    it("takes a nested tile's error-boundary fallback, which renders in its place", () => {
      const src = program(`
tile Fallback in=PanicInfo = button(text="fb", id="fb")
tile Risky error-boundary = Fallback = button(text="r", id="r")
tile Outer = row(Risky)
reducer outerOwn      on=ui.click(Outer#r)  do= log := log + "x"
reducer outerFallback on=ui.click(Outer#fb) do= log := log + "x"
reducer outerBad      on=ui.click(Outer#zz) do= log := log + "x"
reducer riskyFallback on=ui.click(Risky#fb) do= log := log + "x"
tile P = column(Outer)`);
      expect(flagged(src)).toEqual(["outerBad", "riskyFallback"]);
    });

    it("reads a route target's tree like any other tile's", () => {
      const src = program(`
tile Bar = row(button(text="Save", id="save"), button(text="Other", id="other")) {id: "bar"}
tile L = button(text="l", id="l")
tile P = column(Bar, L)
reducer routeOk  on=ui.click(P#save) do= log := log + "x"
reducer routeBad on=ui.click(P#zz)   do= log := log + "x"`);
      expect(flagged(src)).toEqual(["routeBad"]);
    });
  });
});
