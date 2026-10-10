import { compile } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";
import { compileOrFail, loweredOf } from "./helpers/module.ts";
import { withApp, withRoot } from "./helpers/programs.ts";

/** A program whose one reducer `r` subscribes to `ui.<event>(T)` on `tile T = <tile>`. */
const subscribed = (event: string, tile: string): string =>
  withApp(`slot v : Text = ""
reducer r on=ui.${event}(T) do= v := "x"
tile T = ${tile}
tile App = column(T)`);

describe("a ui.* subscription emits the handler its tile fires", () => {
  it.each([
    ["hover", `box(text("hi"))`, "onMouseEnter"],
    ["click", `radio(group="color")`, "onClick"],
    ["change", "check(checked=false)", "onChange"],
    ["change", `radio(group="g")`, "onChange"],
    ["change", "switch(checked=false)", "onChange"],
    ["change", "slider(min=0, max=10)", "onChange"],
  ])("ui.%s on %s emits %s", (event, tile, handler) => {
    expect(compileOrFail(subscribed(event, tile))).toContain(`${handler}: _h("r")`);
  });

  it.each([
    ["focus", "onFocus"],
    ["blur", "onBlur"],
  ])("ui.%s on a box emits no %s and warns W0212", (event, handler) => {
    const result = compile(subscribed(event, `box(text("hi"))`), {
      runtimeSpecifier: "./runtime.js",
    });
    if (result.kind !== "ok") expect.fail(result.errors.map((e) => e.code).join(", "));
    expect(result.js).not.toContain(`${handler}:`);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "W0212", kind: "ui-event-tile-mismatch" }),
    ]);
  });

  it.each([
    ["an argument", "focus", "input(onFocus=r)", "onFocus"],
    ["a props block", "blur", "input() {onBlur: r}", "onBlur"],
  ])("emits a handler written as %s", (_form, event, tile, handler) => {
    const src = withApp(`slot v : Text = ""
reducer r on=ui.${event}(Other) do= v := "x"
tile Other = button(text="noop")
tile Field = ${tile}
tile App = column(Field, Other)`);
    expect(compileOrFail(src)).toContain(`${handler}: _h("r")`);
  });
});

describe("every reducer subscribed to one (tile, event) runs, in source order", () => {
  it.each([
    [
      "ui.click",
      `slot n : Int = 0
reducer logHit on=ui.click(T) do= n := n + 1
reducer save   on=ui.click(T) do= n := n + 2
reducer audit  on=ui.click(T) do= n := n + 3
tile T = button(text="go")`,
      `onClick: _h("logHit", "save", "audit")`,
    ],
    [
      "ui.submit",
      `slot n : Int = 0
reducer save  on=ui.submit(T) do= n := n + 1
reducer audit on=ui.submit(T) do= n := n + 2
tile T = form(text="login")`,
      `onSubmit: _h("save", "audit")`,
    ],
    [
      "ui.hover",
      `slot n : Int = 0
reducer wake on=ui.hover(T) do= n := n + 1
reducer note on=ui.hover(T) do= n := n + 2
tile T = box(text("hi"))`,
      `onMouseEnter: _h("wake", "note")`,
    ],
    [
      "an explicit onClick= beside a ui.click reducer",
      `slot n : Int = 0
reducer onExplicit on=app.start do= n := 0
reducer onImplicit on=ui.click(T) do= n := n + 1
tile T = button(text="go", onClick=onExplicit)`,
      `onClick: _h("onExplicit", "onImplicit")`,
    ],
  ])("%s", (_label, defs, chain) => {
    expect(compileOrFail(withApp(`${defs}\ntile App = column(T)`))).toContain(chain);
  });

  it("wires a reducer named both ways once, not twice", () => {
    const js = compileOrFail(
      withApp(`slot n : Int = 0
reducer inc on=ui.click(T) do= n := n + 1
tile T = button(text="+", onClick=inc)
tile App = column(T)`),
    );
    // One handler per route, `/` and `/404`, each naming `inc` once.
    expect(js.match(/_h\("inc"\)/g)).toHaveLength(2);
    expect(js).toContain(`onClick: _h("inc")`);
    expect(js).not.toContain(`_h("inc", "inc")`);
  });
});

describe("a handler the tile cannot fire is W0213", () => {
  const REDUCER = `slot n : Int = 0
reducer open on=ui.click(InBtn) do= n := n + 1
tile InBtn = button(text="in", onClick=open)`;

  function diags(tile: string): { code: string; severity?: string; message: string }[] {
    return checkSource(withRoot("Card", `${REDUCER}\ntile Card = ${tile}`));
  }

  it("reports onClick on a container, as a warning", () => {
    const [d, ...rest] = diags('row(text("card"), InBtn, onClick=open)');
    expect(rest).toEqual([]);
    expect(d?.code).toBe("W0213");
    expect(d?.severity).toBe("warning");
    expect(d?.message).toContain("button");
  });

  it("reports the props form too, which is the other way to write it", () => {
    expect(diags('row(text("card"), InBtn) {onClick: open}').map((e) => e.code)).toEqual(["W0213"]);
  });

  it("says nothing about the tiles that do fire it", () => {
    expect(diags('column(button(text="a", onClick=open))')).toEqual([]);
    expect(diags('column(check(label="a", onChange=open))')).toEqual([]);
    expect(diags('column(editable(value="a", onInput=open))')).toEqual([]);
    // The overlay row is the one hand-written entry in the table.
    expect(diags('column(modal(text("a"), onClose=open))')).toEqual([]);
    expect(diags('column(drawer(text("a"), onClose=open))')).toEqual([]);
  });

  it("says nothing about the four the runtime attaches to any element", () => {
    expect(diags('row(text("card")) {onKeyDown: open}')).toEqual([]);
    expect(diags('row(text("card")) {onMouseEnter: open}')).toEqual([]);
    expect(diags('row(text("card")) {onFocus: open}')).toEqual([]);
    expect(diags('row(text("card")) {onBlur: open}')).toEqual([]);
  });

  it("says nothing about a user tile whose tree contains a firing kind", () => {
    const src = `${REDUCER}
tile Row = row(text("x"), InBtn)
tile App = column(Row {onClick: open}, text(n.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual([]);
  });

  it("reports a user tile whose tree contains none", () => {
    const src = `${REDUCER}
tile Row = row(text("x"))
tile App = column(Row {onClick: open}, text(n.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codesOf(src)).toEqual(["W0213"]);
  });
});

describe("known gap: W0213 does not see a firing kind that is not the root", () => {
  const REDUCER = `slot n : Int = 0
reducer open on=app.start do= n := n + 1`;

  const src = (tiles: string) => `${REDUCER}
${tiles}
tile App = column(Card {onClick: open}, text(n.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("codegen puts the handler on the root box, not on the button inside", () => {
    const js = loweredOf(src('tile Card = box(button(text="go"))'));
    const onBox =
      js.match(/\{ kind: "box", children: \[[^\]]*\], props: \{ onClick: _h\("open"\) \}/g) ?? [];
    const handlers = js.match(/onClick:/g) ?? [];
    expect(onBox.length).toBeGreaterThan(0);
    expect(handlers).toHaveLength(onBox.length);
  });

  it("and says nothing about it, nested or through another tile", () => {
    expect(codesOf(src('tile Card = box(button(text="go"))'))).toEqual([]);
    expect(codesOf(src('tile Deep = button(text="go")\ntile Card = box(Deep)'))).toEqual([]);
  });

  it("and says nothing about onFocus on a details root that holds a panel", () => {
    const focused = src('tile Card = details(summary="Q", text("a"))').replace(
      "Card {onClick: open}",
      "Card {onFocus: open}",
    );
    expect(focused).toContain("Card {onFocus: open}");
    expect(codesOf(focused)).toEqual([]);
  });
});

describe("a ui.input selector reaches an editable", () => {
  const source = (tile: string) => `slot note : Text = ""
slot edits : Int = 0
reducer edited on=ui.input(Ed) do= edits := edits + 1
tile Ed = ${tile}
tile App = column(Ed, text(edits.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("says nothing about it", () => {
    expect(codesOf(source("editable(bind=note)"))).toEqual([]);
  });

  it("emits the handler the subscription asked for", () => {
    expect(loweredOf(source("editable(bind=note)"))).toContain('onInput: _h("edited")');
  });

  it("still reports a tile that fires no input event", () => {
    expect(codesOf(source("box(text(note))"))).toEqual(["W0212"]);
  });
});

describe("a ui.key / ui.focus / ui.blur selector reaches every kind that receives it", () => {
  const PRELUDE = `type Size = S | M
fn sizes() -> List({label: Text, value: Size})
   = [{label: "Small", value: S}, {label: "Medium", value: M}]
slot note : Text = ""
slot vol  : Int  = 5
slot size : Size = S
slot done : Bool = false
slot hits : Int  = 0`;

  type UiEv = "key" | "focus" | "blur";
  const HANDLER = { key: "onKeyDown", focus: "onFocus", blur: "onBlur" } as const satisfies Record<
    UiEv,
    string
  >;

  const source = (ev: string, tile: string) => `${PRELUDE}
reducer hit on=ui.${ev}(Ed) do= hits := hits + 1
tile Ed = ${tile}
tile App = column(Ed, text(hits.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  const explicit = (ev: UiEv, tile: string) => `${PRELUDE}
reducer hitExplicit on=app.start   do= hits := hits + 1
reducer hitSelector on=ui.${ev}(Ed) do= hits := hits + 2
tile Ed       = ${tile.replace(/\)(?=[^)]*$)/, `, ${HANDLER[ev]}=hitExplicit)`)}
tile App      = column(Ed, text(hits.show))
tile NotFound = text("nope")
app A
    caps   = []
    routes = {"/" -> App, "/404" -> NotFound}
    init   = []
`;

  /** `tile Card = box(Ed)` — the selector names the container, not the leaf. */
  const throughAncestor = (ev: string, tile: string) => `${PRELUDE}
reducer hit on=ui.${ev}(Card) do= hits := hits + 1
tile Ed   = ${tile}
tile Card = box(Ed)
tile App  = column(Card, text(hits.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  const ALL = ["key", "focus", "blur"] as const;
  const kinds: ReadonlyArray<{ kind: string; tile: string; evs: readonly UiEv[] }> = [
    { kind: "input", tile: "input(bind=note)", evs: ALL },
    { kind: "textarea", tile: "textarea(bind=note)", evs: ALL },
    { kind: "button", tile: 'button(text="b")', evs: ALL },
    { kind: "editable", tile: "editable(bind=note)", evs: ALL },
    { kind: "slider", tile: "slider(bind=vol, min=0, max=10)", evs: ALL },
    { kind: "link", tile: 'link(to="/", text="home")', evs: ALL },
    { kind: "select", tile: "select(bind=size, options=sizes())", evs: ALL },
    { kind: "video", tile: 'video(src="/a.mp4", controls=true)', evs: ALL },
    { kind: "check", tile: "check(value=done)", evs: ["key"] },
    { kind: "radio", tile: 'radio(group="g", selected=done)', evs: ["key"] },
    { kind: "switch", tile: "switch(value=done)", evs: ["key"] },
  ];

  for (const { kind, tile, evs } of kinds) {
    for (const ev of evs) {
      const handler = HANDLER[ev];

      it(`says nothing about ui.${ev} on ${kind}`, () => {
        expect(codesOf(source(ev, tile))).toEqual([]);
      });

      it(`emits the ${handler} the ui.${ev} subscription on ${kind} asked for`, () => {
        expect(loweredOf(source(ev, tile))).toContain(`${handler}: _h("hit")`);
      });

      it(`merges a ${handler} written on ${kind} with a ui.${ev} selector on it, once`, () => {
        const js = loweredOf(explicit(ev, tile));
        const merged = `${handler}: _h("hitExplicit", "hitSelector")`;
        expect(js.split(merged)).toHaveLength(2);
        expect(js).not.toMatch(new RegExp(`${handler}: _h\\("hitExplicit"\\)`));
      });

      it(`lifts ui.${ev} through a container whose leaf is ${kind}`, () => {
        expect(codesOf(throughAncestor(ev, tile))).toEqual([]);
        expect(loweredOf(throughAncestor(ev, tile))).toContain(`${handler}: _h("hit")`);
      });
    }
  }

  for (const ev of ALL) {
    const handler = HANDLER[ev];
    it(`still reports a tile that fires no ${ev} event, and still drops it`, () => {
      expect(codesOf(source(ev, "box(text(note))"))).toEqual(["W0212"]);
      expect(loweredOf(source(ev, "box(text(note))"))).not.toContain(`${handler}: _h("hit")`);
    });
  }

  for (const kind of ["check", "radio", "switch"]) {
    for (const ev of ["focus", "blur"] as const) {
      it(`reports ui.${ev} on ${kind}, whose label never receives it`, () => {
        const tile = kind === "radio" ? 'radio(group="g", selected=done)' : `${kind}(value=done)`;
        expect(codesOf(source(ev, tile))).toEqual(["W0212"]);
        expect(loweredOf(source(ev, tile))).not.toContain(`${HANDLER[ev]}: _h("hit")`);
      });
    }
  }

  it.each(
    ALL,
  )("reports ui.%s on details with what keeps it away, and lifts nothing onto it", (ev) => {
    const tile = 'details(summary="Question", text(note))';
    const reported = checkSource(source(ev, tile));
    expect(reported.map((e) => e.code)).toEqual(["W0212"]);
    expect(reported[0]?.message).toContain("around its <summary>");
    expect(loweredOf(source(ev, tile))).not.toContain(`${HANDLER[ev]}: _h("hit")`);
  });

  it("lifts ui.key on a details onto the input in its panel, and onto nothing else", () => {
    // A listener on the <details> as well as the input's own would run the
    // reducer twice per key, since the input's keydown bubbles there.
    const lifted = (tile: string): number =>
      loweredOf(source("key", tile)).split(`onKeyDown: _h("hit")`).length - 1;
    const details = 'details(summary="Question", input(bind=note))';
    expect(codesOf(source("key", details))).toEqual([]);
    expect(lifted(details)).toBeGreaterThan(0);
    expect(lifted(details)).toBe(lifted("box(input(bind=note))"));
    expect(checkSource(source("key", 'details(summary="Q", text(note))'))).toEqual([
      expect.objectContaining({
        code: "W0212",
        message: expect.stringContaining(
          `a details takes no "key" listener on the <details> around its <summary>, ` +
            `since one there would also hear every "key" from the tiles inside it`,
        ),
      }),
    ]);
  });

  it("leaves ui.change on an editable alone, which is the rule rather than the same gap", () => {
    expect(codesOf(source("change", "editable(bind=note)"))).toEqual(["W0212"]);
  });

  it("leaves ui.click on a link alone: the link reserves click for navigation", () => {
    expect(codesOf(source("click", 'link(to="/", text="home")'))).toEqual(["W0212"]);
  });
});
