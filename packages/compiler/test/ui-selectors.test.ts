import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

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
          `a check listens on the <label> around its <input>, and the "focus" that <input> fires ` +
          `does not bubble to the <label> ` +
          `(DOM-allowed: input, textarea, button, select, slider, editable, link, video; observed in body: check). ` +
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
        `a ${kind} listens on the <label> around its <input>, and the "${ev}" that <input> fires does not bubble to the <label>`,
      );
      expect(message).not.toContain("has no descendant");
    });

    it("gives it when the control is reached through another tile", () => {
      const message = w0212("focus", "tile Inner = check(value=done)\ntile D = box(Inner)");
      expect(message).toContain(`a check listens on the <label> around its <input>`);
      expect(message).toContain("observed in body: box, check");
    });

    it("names every label-wrapped kind in the body, beside kinds that fire nothing", () => {
      const message = w0212(
        "blur",
        'tile D = row(check(value=done), switch(value=done), text("x"))',
      );
      expect(message).toContain(
        `a check / switch listens on the <label> around its <input>, and the "blur" that <input> fires`,
      );
    });

    it.each([
      [
        "a tile with nothing focusable in it",
        "focus",
        'tile D = box(text("hi"))',
        `Reducer "r" subscribes to ui.focus(D) but tile "D" has no descendant that fires "focus" ` +
          `(DOM-allowed: input, textarea, button, select, slider, editable, link, video; observed in body: box, text). ` +
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

  describe("on a details, says what keeps the event from a listener", () => {
    const FAQ = 'tile D = details(summary="Question", text("answer"))';

    it("names the <summary>, the event and the <details> for ui.focus", () => {
      expect(w0212("focus", FAQ)).toBe(
        `Reducer "r" subscribes to ui.focus(D) but "focus" never reaches a listener in tile "D": ` +
          `a details listens on the <details> around its <summary>, and the "focus" that <summary> fires ` +
          `does not bubble to the <details> ` +
          `(DOM-allowed: input, textarea, button, select, slider, editable, link, video; observed in body: details, text). ` +
          `The handler is silently dropped.`,
      );
    });

    it("gives the same reason for ui.blur", () => {
      const message = w0212("blur", FAQ);
      expect(message).toContain(
        `a details listens on the <details> around its <summary>, and the "blur" that <summary> fires does not bubble to the <details>`,
      );
      expect(message).not.toContain("has no descendant");
    });

    it("says a key listener on the <details> would hear its panel too, for ui.key", () => {
      expect(w0212("key", FAQ)).toBe(
        `Reducer "r" subscribes to ui.key(D) but "key" never reaches a listener in tile "D": ` +
          `a details takes no "key" listener on the <details> around its <summary>, ` +
          `since one there would also hear every "key" from the tiles inside it ` +
          `(DOM-allowed: input, textarea, button, select, slider, editable, link, video, check, radio, switch; ` +
          `observed in body: details, text). ` +
          `The handler is silently dropped.`,
      );
    });

    it("gives it when the details is reached through a container and another tile", () => {
      const message = w0212(
        "focus",
        'tile Inner = details(summary="Question", text("answer"))\ntile D = box(Inner)',
      );
      expect(message).toContain(`a details listens on the <details> around its <summary>`);
      expect(message).toContain("observed in body: box, details, text");
    });

    it("gives the label's reason and the summary's, one clause each, for a body holding both", () => {
      expect(
        w0212("blur", 'tile D = row(check(value=done), details(summary="Q", text("a")))'),
      ).toContain(
        `"blur" never reaches a listener in tile "D": ` +
          `a check listens on the <label> around its <input>, and the "blur" that <input> fires does not bubble to the <label>; ` +
          `a details listens on the <details> around its <summary>, and the "blur" that <summary> fires does not bubble to the <details> (`,
      );
    });
  });

  describe("on a video, reports none of key / focus / blur", () => {
    it.each(
      [
        ["with controls", 'video(src="/a.mp4", controls=true)'],
        ["whose controls a slot decides", 'video(src="/a.mp4", controls=done)'],
      ].flatMap(([what, clip]) => ["key", "focus", "blur"].map((ev) => ({ what, clip, ev }))),
    )("says nothing about ui.$ev on a video $what", ({ clip, ev }) => {
      const src = `
        slot done : Bool = false
        slot hits : Int = 0
        reducer r on=ui.${ev}(V) do= hits := hits + 1
        tile V = ${clip}
        tile App = column(V, text(hits.show))
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      expect(codesOf(src)).toEqual([]);
    });
  });

  describe("on a kind whose renderer does not pass the event on, says what it does instead", () => {
    it("says a link keeps click for navigation", () => {
      expect(w0212("click", 'tile D = link(to="/", text="home")')).toBe(
        `Reducer "r" subscribes to ui.click(D) but "click" never reaches a reducer in tile "D": ` +
          `a link fires "click", and its renderer keeps it for navigation, never calling onClick ` +
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
      expect(message).toContain(`a link fires "click", and its renderer keeps it for navigation`);
      expect(message).toContain("observed in body: box, link");
    });

    it.each([
      ["change", "tile D = editable(bind=note)", "editable"],
      ["input", 'tile D = text("hi")', "text"],
      ["input", 'tile D = button(text="b")', "button"],
    ])("keeps 'no descendant fires it' for ui.%s on `%s`", (ev, tiles, kind) => {
      const message = w0212(ev, tiles);
      expect(message).toContain(`but tile "D" has no descendant that fires "${ev}" (`);
      expect(message).toContain(`observed in body: ${kind})`);
    });
  });

  describe("under click, says the renderer never calls onClick", () => {
    it.each([
      ["a text", 'tile D = text("hi")', "text"],
      ["a box, naming the kinds in its body together", 'tile D = box(text("hi"))', "box, text"],
    ])("says so for %s", (_, tiles, observed) => {
      const named = observed.replace(", ", " / ");
      expect(w0212("click", tiles)).toBe(
        `Reducer "r" subscribes to ui.click(D) but "click" never reaches a reducer in tile "D": ` +
          `a ${named} fires "click", and its renderer never calls onClick ` +
          `(DOM-allowed: button, check, switch, radio; observed in body: ${observed}). ` +
          `The handler is silently dropped.`,
      );
    });

    it.each([
      ["an image", 'image(src="/a.png", alt="a")'],
      ["a heading", 'heading("Title")'],
      ["an input", "input(bind=note)"],
      ["a select", "select(bind=size, options=sizes())"],
      ["a video", 'video(src="/a.mp4", controls=true)'],
    ])("says so for %s", (named, tile) => {
      const message = w0212("click", `tile D = ${tile}`);
      expect(message).toContain(
        `"click" never reaches a reducer in tile "D": ` +
          `${named} fires "click", and its renderer never calls onClick (`,
      );
      expect(message).not.toContain("has no descendant");
    });

    it("takes its article from the first kind it names", () => {
      expect(w0212("click", 'tile D = row(image(src="/a.png", alt="a"), text("x"))')).toContain(
        `an image / row / text fires "click", and its renderer never calls onClick (`,
      );
    });

    it("gives a link its own reason, and the other kinds the default", () => {
      expect(w0212("click", 'tile D = row(link(to="/", text="home"), text("x"))')).toContain(
        `"click" never reaches a reducer in tile "D": ` +
          `a link fires "click", and its renderer keeps it for navigation, never calling onClick; ` +
          `a row / text fires "click", and its renderer never calls onClick (`,
      );
    });
  });

  describe("W0213 gives the reason W0212 gives for the kind", () => {
    const w0213 = (tiles: string) => {
      const src = `
        slot done : Bool = false
        slot note : Text = ""
        slot hits : Int = 0
        reducer r on=app.start do= hits := hits + 1
        ${tiles}
        tile App = column(D)
        app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
      `;
      const found = checkSource(src).filter((e) => e.code === "W0213");
      expect(found).toHaveLength(1);
      return found[0]!.message;
    };
    const reasonOf = (ev: string, tiles: string) => {
      const message = w0212(ev, tiles);
      const start = message.indexOf(`tile "D": `) + `tile "D": `.length;
      return message.slice(start, message.indexOf(" (DOM-allowed"));
    };
    const ONTO = "Put it on button / check / radio / switch";

    it("says a link keeps click for navigation", () => {
      const message = w0213('tile D = link(to="/", text="home", onClick=r)');
      expect(message).toBe(
        `"onClick" on link() is dropped — a link fires "click", and its renderer keeps it for ` +
          `navigation, never calling onClick. ${ONTO}, or subscribe with a reducer's on=ui.<event>(<Tile>)`,
      );
      expect(message).toContain(`— ${reasonOf("click", 'tile D = link(to="/", text="home")')}. `);
    });

    it("says a container's renderer never calls onClick", () => {
      const message = w0213('tile D = row(text("x"), onClick=r)');
      expect(message).toBe(
        `"onClick" on row() is dropped — a row fires "click", and its renderer never calls onClick. ` +
          `${ONTO}, or subscribe with a reducer's on=ui.<event>(<Tile>)`,
      );
      expect(w0213('tile D = text("x") {onClick: r}')).toContain(
        `— ${reasonOf("click", 'tile D = text("x")')}. `,
      );
    });

    it("says a slider listens for input only to write its bind", () => {
      expect(w0213("tile D = slider(bind=hits, min=0, max=10, onInput=r)")).toContain(
        `"onInput" on slider() is dropped — ` +
          `${reasonOf("input", "tile D = slider(bind=hits, min=0, max=10)")}. `,
      );
    });

    it("says it of a user tile's body, and names the body", () => {
      const inner = 'tile Inner = box(text("clickme"))';
      const message = w0213(`${inner}\ntile D = column(Inner(onClick=r))`);
      expect(message).toBe(
        `"onClick" on Inner() is dropped — Inner renders nothing that calls it: ` +
          `a box / text fires "click", and its renderer never calls onClick ` +
          `(observed in body: box, text). ${ONTO}, or subscribe with a reducer's on=ui.<event>(<Tile>)`,
      );
      expect(message).toContain(
        `calls it: ${reasonOf("click", 'tile D = box(text("clickme"))')} (`,
      );
    });

    it("keeps 'does not fire it' where the element fires nothing", () => {
      expect(w0213('tile D = row(text("x")) {onChange: r}')).toBe(
        `"onChange" on row() is dropped — row does not fire it. ` +
          `Put it on check / input / radio / select / slider / switch / textarea, ` +
          `or subscribe with a reducer's on=ui.<event>(<Tile>)`,
      );
      expect(
        w0213('tile Inner = box(text("x"))\ntile D = column(Inner() {onChange: r})'),
      ).toContain(`— Inner renders nothing that fires it (observed in body: box, text). `);
    });

    describe("on a wrapped control, says focus / blur do not bubble to the wrapper", () => {
      const FOCUS_ONTO =
        "Put it on button / editable / input / link / select / slider / textarea / video";
      const SUBSCRIBE = "or subscribe with a reducer's on=ui.<event>(<Tile>)";

      it.each([
        ["onFocus", "check", "focus", "tile D = check(value=done, onFocus=r)", "check(value=done)"],
        [
          "onBlur",
          "radio",
          "blur",
          'tile D = radio(group="g", selected=done, onBlur=r)',
          'radio(group="g", selected=done)',
        ],
        [
          "onFocus",
          "switch",
          "focus",
          "tile D = switch(value=done) {onFocus: r}",
          "switch(value=done)",
        ],
      ])("says so of %s on a %s", (handler, kind, ev, tiles, bare) => {
        const message = w0213(tiles);
        expect(message).toBe(
          `"${handler}" on ${kind}() is dropped — a ${kind} listens on the <label> around its <input>, ` +
            `and the "${ev}" that <input> fires does not bubble to the <label>. ` +
            `${FOCUS_ONTO}, ${SUBSCRIBE}`,
        );
        expect(message).toContain(`— ${reasonOf(ev, `tile D = ${bare}`)}. `);
      });

      it.each([
        ["onFocus", "focus"],
        ["onBlur", "blur"],
      ])("says so of %s on a details", (handler, ev) => {
        expect(w0213(`tile D = details(summary="Q", text("a"), ${handler}=r)`)).toBe(
          `"${handler}" on details() is dropped — ` +
            `${reasonOf(ev, 'tile D = details(summary="Q", text("a"))')}. ` +
            `${FOCUS_ONTO}, ${SUBSCRIBE}`,
        );
      });

      it("says so of a user tile whose body renders only such controls", () => {
        expect(w0213("tile Inner = check(value=done)\ntile D = column(Inner(onFocus=r))")).toBe(
          `"onFocus" on Inner() is dropped — Inner renders nothing where "focus" reaches it: ` +
            `a check listens on the <label> around its <input>, and the "focus" that <input> fires ` +
            `does not bubble to the <label> (observed in body: check). ` +
            `${FOCUS_ONTO}, ${SUBSCRIBE}`,
        );
        expect(
          w0213(
            "tile Inner = if done then check(value=done) else switch(value=done)\n" +
              "tile D = column(Inner() {onBlur: r})",
          ),
        ).toContain(
          `— Inner renders nothing where "blur" reaches it: a check / switch listens on the <label> ` +
            `around its <input>, and the "blur" that <input> fires does not bubble to the <label> ` +
            `(observed in body: check, switch). `,
        );
      });

      it.each([
        ["onFocus on an input", "input(bind=note, onFocus=r)"],
        ["onClick on a check", "check(value=done, onClick=r)"],
        ["onChange on a check", "check(value=done, onChange=r)"],
        ["onKeyDown on a check", "check(value=done, onKeyDown=r)"],
        ["onKeyDown on a details", 'details(summary="Q", text("a"), onKeyDown=r)'],
        ["onMouseEnter on a radio", 'radio(group="g", selected=done, onMouseEnter=r)'],
        [
          "onFocus on a user tile that may render an input",
          "Inner(onFocus=r)\ntile Inner = if done then check(value=done) else input(bind=note)",
        ],
      ])("says nothing of %s", (_, tile) => {
        const src = `
          slot done : Bool = false
          slot note : Text = ""
          slot hits : Int = 0
          reducer r on=app.start do= hits := hits + 1
          tile D = ${tile}
          tile App = column(D)
          app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
        `;
        expect(codesOf(src)).toEqual([]);
      });
    });
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
