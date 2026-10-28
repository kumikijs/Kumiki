import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

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

describe("W0212 gives the reason that holds when the element fires the event", () => {
  const w0212 = (ev: string, tiles: string) => {
    const src = `
      type Size = S | M
      fn sizes() -> List({label: Text, value: Size})
         = [{label: "Small", value: S}, {label: "Medium", value: M}]
      slot size : Size = S
      slot done : Bool = false
      slot note : Text = ""
      slot hits : Int = 0
      reducer r on=ui.${ev}(D) do= hits := hits + 1
      ${tiles}
      tile App = column(D)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `;
    const found = checkSource(src).filter((e) => e.code === "W0212");
    expect(found).toHaveLength(1);
    return found[0]!.message;
  };

  describe("on a label-wrapped control, says the event does not bubble to the label", () => {
    it("names the <input>, the event and the <label> for ui.focus on a check", () => {
      expect(w0212("focus", "tile D = check(value=done)")).toBe(
        `Reducer "r" subscribes to ui.focus(D) but "focus" never reaches a listener in tile "D": ` +
          `the runtime listens for "focus" on a check's <label>, and the "focus" its <input> fires ` +
          `does not bubble to the <label> ` +
          `(DOM-allowed: input, textarea, button, select, slider, editable, link; observed in body: check). ` +
          `The handler is silently dropped.`,
      );
    });

    const LABEL_WRAPPED = [
      ["check", "check(value=done)"],
      ["radio", 'radio(group="g", selected=done)'],
      ["switch", "switch(value=done)"],
    ] as const;
    it.each(
      LABEL_WRAPPED.flatMap(([kind, tile]) => ["focus", "blur"].map((ev) => ({ kind, tile, ev }))),
    )("gives that reason for ui.$ev on $kind", ({ kind, tile, ev }) => {
      const message = w0212(ev, `tile D = ${tile}`);
      expect(message).toContain(
        `the runtime listens for "${ev}" on a ${kind}'s <label>, and the "${ev}" its <input> fires does not bubble to the <label>`,
      );
      expect(message).not.toContain("has no descendant");
    });

    it("gives it when the control is reached through another tile", () => {
      const message = w0212("focus", "tile Inner = check(value=done)\ntile D = box(Inner)");
      expect(message).toContain(`the runtime listens for "focus" on a check's <label>`);
      expect(message).toContain("observed in body: box, check");
    });

    it("names every label-wrapped kind in the body, beside kinds that fire nothing", () => {
      const message = w0212(
        "blur",
        'tile D = row(check(value=done), switch(value=done), text("x"))',
      );
      expect(message).toContain(
        `the runtime listens for "blur" on a check / switch's <label>, and the "blur" its <input> fires`,
      );
    });

    it.each([
      [
        "a tile with nothing focusable in it",
        "focus",
        'tile D = box(text("hi"))',
        `Reducer "r" subscribes to ui.focus(D) but tile "D" has no descendant that fires "focus" ` +
          `(DOM-allowed: input, textarea, button, select, slider, editable, link; observed in body: box, text). ` +
          `The handler is silently dropped.`,
      ],
      [
        "an event the control does not fire at all",
        "submit",
        "tile D = check(value=done)",
        `Reducer "r" subscribes to ui.submit(D) but tile "D" has no descendant that fires "submit" ` +
          `(DOM-allowed: form; observed in body: check). The handler is silently dropped.`,
      ],
    ])("keeps 'no descendant fires it' for %s", (_, ev, tiles, message) => {
      expect(w0212(ev, tiles)).toBe(message);
    });
  });

  describe("on a kind whose renderer does not pass the event on, says what it does instead", () => {
    it("says a link listens for click only to navigate", () => {
      expect(w0212("click", 'tile D = link(to="/", text="home")')).toBe(
        `Reducer "r" subscribes to ui.click(D) but "click" never reaches a reducer in tile "D": ` +
          `a link fires "click", and its renderer listens for it only to navigate, never calling onClick ` +
          `(DOM-allowed: button, check, switch, radio; observed in body: link). ` +
          `The handler is silently dropped.`,
      );
    });

    it("says a slider listens for input only to write its bind", () => {
      expect(w0212("input", "tile D = slider(bind=hits, min=0, max=10)")).toBe(
        `Reducer "r" subscribes to ui.input(D) but "input" never reaches a reducer in tile "D": ` +
          `a slider fires "input", and its renderer listens for it only to write the bind, ` +
          `never calling onInput ` +
          `(DOM-allowed: input, textarea, editable; observed in body: slider). ` +
          `The handler is silently dropped.`,
      );
    });

    it.each([
      ["check", "check(value=done)"],
      ["radio", 'radio(group="g", selected=done)'],
      ["switch", "switch(value=done)"],
      ["select", "select(bind=size, options=sizes())"],
    ])("says a %s listens for change, not input", (kind, tile) => {
      const message = w0212("input", `tile D = ${tile}`);
      expect(message).toContain(
        `"input" never reaches a reducer in tile "D": a ${kind} fires "input", ` +
          `and its renderer listens for "change" instead, never calling onInput (`,
      );
      expect(message).not.toContain("has no descendant");
    });

    it("names together the kinds that share a reason, and gives each reason once", () => {
      const message = w0212(
        "input",
        'tile D = row(select(bind=size, options=sizes()), slider(bind=hits, min=0, max=10), check(value=done), text("x"))',
      );
      expect(message).toContain(
        `"input" never reaches a reducer in tile "D": ` +
          `a check / select fires "input", and its renderer listens for "change" instead, never calling onInput; ` +
          `a slider fires "input", and its renderer listens for it only to write the bind, never calling onInput (`,
      );
    });

    it("gives it through a container and a referenced tile", () => {
      const message = w0212("click", 'tile Inner = link(to="/", text="home")\ntile D = box(Inner)');
      expect(message).toContain(
        `a link fires "click", and its renderer listens for it only to navigate`,
      );
      expect(message).toContain("observed in body: box, link");
    });

    it.each([
      ["change", "tile D = editable(bind=note)", "editable"],
      ["input", 'tile D = button(text="b")', "button"],
    ])("keeps 'no descendant fires it' for ui.%s on `%s`", (ev, tiles, kind) => {
      const message = w0212(ev, tiles);
      expect(message).toContain(`but tile "D" has no descendant that fires "${ev}" (`);
      expect(message).toContain(`observed in body: ${kind})`);
    });
  });

  // The <span> does fire click; this pins the wording that is still untrue of it, so that the
  // change which gives a text its own reason changes this test on purpose.
  it("still says no descendant fires click for a text, although its <span> fires it", () => {
    const message = w0212("click", 'tile D = text("hi")');
    expect(message).toContain(`but tile "D" has no descendant that fires "click" (`);
    expect(message).toContain("observed in body: text)");
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

    it("matches a container's selector against its descendants, not its own id", () => {
      const src = withApp(`
slot log : Text = ""
reducer hitB on=ui.click(Bar#save) do= log := log + "save;"
reducer hitA on=ui.click(Bar#bar) do= log := log + "bar;"
tile Bar = row(button(text="Save", id="save"), button(text="Other", id="other")) {id: "bar"}
tile Btn2 = button(text="Two", id="two")
reducer hit2 on=ui.click(Btn2#tow) do= log := log + "two;"
tile App = column(Bar, Btn2, text("log=" + log))`);
      expect(flagged(src)).toEqual(["hitA", "hit2"]);
      const bar = checkStrict(src).find((d) => d.message.includes("Bar#bar"));
      expect(bar?.message).toContain('"other" | "save"');
      expect(bar?.message).toContain("can never match");
    });

    it('reads an id written as id="…" as well as {id: "…"}, the block when both are', () => {
      const src = withApp(`
slot log : Text = ""
tile L2 = button(text="l2", id="l2")
tile B7 = button(text="b7", id="arg7") {id: "block7"}
reducer argOk    on=ui.click(L2#l2)     do= log := log + "x"
reducer argBad   on=ui.click(L2#zz)     do= log := log + "x"
reducer blockOk  on=ui.click(B7#block7) do= log := log + "x"
reducer shadowed on=ui.click(B7#arg7)   do= log := log + "x"
tile App = column(L2, B7)`);
      expect(flagged(src)).toEqual(["argBad", "shadowed"]);
    });

    it("follows a descendant written as a tile reference, at the root or nested", () => {
      const src = withApp(`
slot log : Text = ""
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
tile App = column(Nested, Alias, Boxed)`);
      expect(flagged(src)).toEqual(["nestedBad", "aliasBad", "boxedBad"]);
    });

    it("takes only the elements that fire the selector's event", () => {
      const src = withApp(`
slot log : Text = ""
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
tile App = column(S)`);
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
      const src = withApp(`
slot log : Text = ""
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
tile App = column(F, I, M, W)`);
      expect(flagged(src)).toEqual(["forBad", "ifBad", "matchBad", "whenBad"]);
    });

    it("stays silent when a wired element's id is computed or missing", () => {
      const src = withApp(`
slot log : Text = ""
slot n : Int = 0
tile Computed = row(button(text="c", id=n.show), button(text="d", id="d"))
tile Missing  = row(button(text="e"), button(text="f", id="f"))
tile Known    = row(button(text="g", id="g"), button(text="h", id="h"))
reducer computed on=ui.click(Computed#zz) do= log := log + "x"
reducer missing  on=ui.click(Missing#zz)  do= log := log + "x"
reducer known    on=ui.click(Known#zz)    do= log := log + "x"
tile App = column(Computed, Missing, Known)`);
      expect(flagged(src)).toEqual(["known"]);
    });

    it("takes the id a call site writes on a user tile as its root's", () => {
      // `Three`'s call site writes another prop, which leaves the id to the runtime.
      const src = withApp(`
slot log : Text = ""
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
tile App = column(Four(id="five"), Four, Three {variant: "ghost"}, Wrap)`);
      expect(flagged(src)).toEqual(["neither", "wrapOwnId"]);
      const neither = checkStrict(src).find((d) => d.message.includes("Four#six"));
      expect(neither?.message).toContain('"five" | "four"');
    });

    it("takes a nested tile's error-boundary fallback, which renders in its place", () => {
      const src = withApp(`
slot log : Text = ""
tile Fallback in=PanicInfo = button(text="fb", id="fb")
tile Risky error-boundary = Fallback = button(text="r", id="r")
tile Outer = row(Risky)
reducer outerOwn      on=ui.click(Outer#r)  do= log := log + "x"
reducer outerFallback on=ui.click(Outer#fb) do= log := log + "x"
reducer outerBad      on=ui.click(Outer#zz) do= log := log + "x"
reducer riskyFallback on=ui.click(Risky#fb) do= log := log + "x"
tile App = column(Outer)`);
      expect(flagged(src)).toEqual(["outerBad", "riskyFallback"]);
    });

    it("takes the inner elements of a nested tile's fallback", () => {
      const src = withApp(`
slot log : Text = ""
tile Fallback in=PanicInfo = column(button(text="fb", id="fb"))
tile Risky error-boundary = Fallback = button(text="r", id="r")
tile Outer = row(Risky)
reducer outerFallback on=ui.click(Outer#fb) do= log := log + "x"
reducer outerBad      on=ui.click(Outer#zz) do= log := log + "x"
tile App = column(Outer)`);
      expect(flagged(src)).toEqual(["outerBad"]);
      expect(checkStrict(src).find((d) => d.code === "E0212")?.message).toContain('"fb" | "r"');
    });

    it("leaves a tile with no element that fires the event to W0212", () => {
      const src = withApp(`
slot log : Text = ""
tile T = row(text("x")) {id: "t"}
reducer r on=ui.click(T#u) do= log := log + "x"
tile App = column(T)`);
      const codes = checkStrict(src)
        .filter((d) => d.code === "E0212" || d.code === "W0212")
        .map((d) => d.code);
      expect(codes).toEqual(["W0212"]);
    });

    it.each([
      ["a computed id, which leaves it unknown", "Btn(id=name)", []],
      ["another prop, which leaves it unknown", 'Btn {variant: "ghost"}', []],
      ["`key` alone, which leaves it the tile's", "for s in xs Btn {key: s}", ["r"]],
      ["a handler alone, which leaves it the tile's", "Btn(onClick=other)", ["r"]],
    ])("reads a call site that writes %s", (_label, call, expected) => {
      const src = withApp(`
slot log  : Text       = ""
slot name : Text       = "n"
slot xs   : List(Text) = ["a"]
tile Btn = button(text="b", id="own")
tile Go  = button(text="go")
reducer r     on=ui.click(Btn#zz) do= log := log + "x"
reducer other on=ui.click(Go)     do= log := log + "y"
tile App = column(${call}, Go)`);
      expect(flagged(src)).toEqual(expected);
    });

    it("keeps the id a tile is written with only where some use leaves it", () => {
      // `Routed` is also a route target, which renders it with no call site.
      const src = `
slot log : Text = ""
tile Routed = button(text="r", id="own")
tile Called = button(text="c", id="own")
reducer routedOwn on=ui.click(Routed#own) do= log := log + "x"
reducer calledOwn on=ui.click(Called#own) do= log := log + "x"
reducer calledX   on=ui.click(Called#x)   do= log := log + "x"
tile App = column(Routed(id="x"), Called(id="x"))
app A caps=[] routes={"/" -> App, "/r" -> Routed, "/404" -> App} init=[]`;
      expect(flagged(src)).toEqual(["calledOwn"]);
    });

    it("stays silent for a reducer a handler names, wherever the handler is", () => {
      const src = withApp(`
slot log : Text = ""
tile B = button(text="B", id="b")
reducer viaArg   on=ui.click(B#zz) do= log := log + "x"
reducer viaProps on=ui.click(B#yy) do= log := log + "x"
reducer named    on=ui.click(B#xx) do= log := log + "x"
tile App = column(B, row(button(text="o", id="o", onClick=viaArg)), button(text="p") {onClick: viaProps})`);
      expect(flagged(src)).toEqual(["named"]);
    });

    it("reads a route target's tree like any other tile's", () => {
      const src = withApp(`
slot log : Text = ""
tile Bar = row(button(text="Save", id="save"), button(text="Other", id="other")) {id: "bar"}
tile L = button(text="l", id="l")
tile App = column(Bar, L)
reducer routeOk  on=ui.click(App#save) do= log := log + "x"
reducer routeBad on=ui.click(App#zz)   do= log := log + "x"`);
      expect(flagged(src)).toEqual(["routeBad"]);
    });
  });
});
