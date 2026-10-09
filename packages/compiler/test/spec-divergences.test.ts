import { check, codegen, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function build(source: string): string {
  return codegen(parse(lex(source)), { runtimeSpecifier: "./runtime.js" }).js;
}

function codes(source: string): string[] {
  return check(parse(lex(source))).map((e) => e.code);
}

/** The tile under test has to be reachable from a route, or codegen drops it. */
function app(tile: string, body: string): string {
  return `${body}
tile App = column(${tile})
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

describe("button(type=…) reaches the tile node", () => {
  it("emits the type when the tile says one", () => {
    const js = build(app("Send", 'tile Send = button(text="send", type="submit")'));
    expect(js).toContain('type: "submit"');
  });

  it("emits nothing when the tile does not, leaving the HTML default", () => {
    const js = build(app("Plain", 'tile Plain = button(text="plain")'));
    const node = js.slice(js.indexOf('kind: "button"'));
    expect(node.slice(0, node.indexOf("props:"))).not.toContain("type");
  });

  it("rejects a literal type that is not one of the three", () => {
    const src = app("Bad", 'tile Bad = button(text="x", type="submmit")');
    expect(codes(src)).toEqual(["E0201"]);
    for (const ok of ["submit", "button", "reset"]) {
      expect(codes(app("Ok", `tile Ok = button(text="x", type="${ok}")`)), ok).toEqual([]);
    }
  });

  it("takes an expression, not only a literal", () => {
    const src = app(
      "Send",
      `slot mode : Text = "button"
tile Send = button(text="send", type=mode)`,
    );
    expect(build(src)).toContain('type: _live["mode"]');
    expect(codes(src)).toEqual([]);
  });
});

describe("a method called with too few arguments is E0213", () => {
  it("reports the zero-arg call `check` used to pass", () => {
    const src = app("text(stamp(Time.now))", "fn stamp(t: Time) -> Text = t.format()");
    expect(codes(src)).toEqual(["E0213"]);
  });

  it("covers the methods that were already like this, not only the new one", () => {
    const joinSrc = app(
      "text(j(xs))",
      `slot xs : List(Text) = []
fn j(l: List(Text)) -> Text = l.join()`,
    );
    expect(codes(joinSrc)).toEqual(["E0213"]);
  });

  it("enforces the minimum, not an exact count", () => {
    const one = app(
      "text(v(m))",
      `slot m : Map(Text, Text) = {}
fn v(x: Map(Text, Text)) -> Text = x.get-or("k", "fallback")`,
    );
    expect(codes(one)).toEqual([]);
    const opt = app(
      "text(v(m))",
      `slot m : Map(Text, Text) = {}
fn v(x: Map(Text, Text)) -> Text = x.get("k").get-or("fallback")`,
    );
    expect(codes(opt)).toEqual([]);
  });

  it("says nothing about a method that takes none", () => {
    const src = app("text(n.show)", "slot n : Int = 0");
    expect(codes(src)).toEqual([]);
  });
});

describe("for over a Map or a Set is E0218", () => {
  const MAP = "slot names : Map(Text, Text) = {}";
  const SET = "slot tags : Set(Text) = {}";

  it("reports the tile form", () => {
    const src = `${MAP}
tile App = column(for k in names text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual(["E0218"]);
  });

  it("reports the reducer form, which is a different node", () => {
    const src = `${MAP}
slot n : Int = 0
reducer count on=app.start do=
    for k in names
        n := n + 1
${appTail()}`;
    expect(codes(src)).toEqual(["E0218"]);
  });

  it("reports a Set, which is a keyed object too", () => {
    const src = `${SET}
tile App = column(for t in tags text(t))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const diags = check(parse(lex(src)));
    expect(diags.map((d) => d.code)).toEqual(["E0218"]);
    expect(diags[0]?.message).toContain(".to-list");
  });

  it("sees through a type alias", () => {
    const src = `type Names = Map(Text, Text)
slot names : Names = {}
tile App = column(for k in names text(k))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual(["E0218"]);
  });

  it("accepts the two forms the spec names, and a plain List", () => {
    const src = `${MAP}
${SET}
slot xs : List(Text) = []
tile App = column(
             for k in names.keys text(k),
             for t in tags.to-list text(t),
             for x in xs text(x))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual([]);
  });

  it("stays silent when the type cannot be determined", () => {
    const src = `tile App = column(for r in nope text(r))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual(["E0103"]);
  });

  it("accepts a List that comes back from a fn", () => {
    const src = `slot xs : List(Text) = []
fn rows(ys: List(Text)) -> List(Text) = ys
tile App = column(for r in rows(xs) text(r))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    expect(codes(src)).toEqual([]);
  });
});

function appTail(): string {
  return `tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

describe("Time lowers to the representation the spec gives it", () => {
  it("passes the pattern to the formatter instead of discarding it", () => {
    const src = app(
      "text(stamp(Time.now))",
      `fn stamp(t: Time) -> Text = t.format("yyyy-MM-dd HH:mm")`,
    );
    const js = build(src);
    expect(js).toContain('_s.formatTime(t, "yyyy-MM-dd HH:mm")');
    expect(js).not.toContain("toISOString");
  });

  it("parses a Time into milliseconds, not into the text it was given", () => {
    const src = app(
      "text(shown(iso))",
      `slot iso : Text = ""
fn shown(s: Text) -> Text = match Time.parse(s) with | Some(t) -> t.format("yyyy") | None -> "?"`,
    );
    const js = build(src);
    expect(js).toContain("_s.parseTime(");
    expect(js).not.toMatch(/_s\.Some\(String\(/);
    expect(js).toContain("_s.formatTime");
  });
});

describe("a handler the tile cannot fire is W0213", () => {
  const REDUCER = `slot n : Int = 0
reducer open on=ui.click(InBtn) do= n := n + 1
tile InBtn = button(text="in", onClick=open)`;

  function diags(tile: string): { code: string; severity?: string; message: string }[] {
    return check(parse(lex(app("Card", `${REDUCER}\ntile Card = ${tile}`))));
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
    expect(codes(src)).toEqual([]);
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
    expect(codes(src)).toEqual(["W0213"]);
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
    const js = build(src('tile Card = box(button(text="go"))'));
    const onBox =
      js.match(/\{ kind: "box", children: \[[^\]]*\], props: \{ onClick: _h\("open"\) \}/g) ?? [];
    const handlers = js.match(/onClick:/g) ?? [];
    expect(onBox.length).toBeGreaterThan(0);
    expect(handlers).toHaveLength(onBox.length);
  });

  it("and says nothing about it, nested or through another tile", () => {
    expect(codes(src('tile Card = box(button(text="go"))'))).toEqual([]);
    expect(codes(src('tile Deep = button(text="go")\ntile Card = box(Deep)'))).toEqual([]);
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
    expect(codes(source("editable(bind=note)"))).toEqual([]);
  });

  it("emits the handler the subscription asked for", () => {
    expect(build(source("editable(bind=note)"))).toContain('onInput: _h("edited")');
  });

  it("still reports a tile that fires no input event", () => {
    expect(codes(source("box(text(note))"))).toEqual(["W0212"]);
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
    { kind: "check", tile: "check(value=done)", evs: ["key"] },
    { kind: "radio", tile: 'radio(group="g", selected=done)', evs: ["key"] },
    { kind: "switch", tile: "switch(value=done)", evs: ["key"] },
  ];

  for (const { kind, tile, evs } of kinds) {
    for (const ev of evs) {
      const handler = HANDLER[ev];

      it(`says nothing about ui.${ev} on ${kind}`, () => {
        expect(codes(source(ev, tile))).toEqual([]);
      });

      it(`emits the ${handler} the ui.${ev} subscription on ${kind} asked for`, () => {
        expect(build(source(ev, tile))).toContain(`${handler}: _h("hit")`);
      });

      it(`merges a ${handler} written on ${kind} with a ui.${ev} selector on it, once`, () => {
        const js = build(explicit(ev, tile));
        const merged = `${handler}: _h("hitExplicit", "hitSelector")`;
        expect(js.split(merged)).toHaveLength(2);
        expect(js).not.toMatch(new RegExp(`${handler}: _h\\("hitExplicit"\\)`));
      });

      it(`lifts ui.${ev} through a container whose leaf is ${kind}`, () => {
        expect(codes(throughAncestor(ev, tile))).toEqual([]);
        expect(build(throughAncestor(ev, tile))).toContain(`${handler}: _h("hit")`);
      });
    }
  }

  for (const ev of ALL) {
    const handler = HANDLER[ev];
    it(`still reports a tile that fires no ${ev} event, and still drops it`, () => {
      expect(codes(source(ev, "box(text(note))"))).toEqual(["W0212"]);
      expect(build(source(ev, "box(text(note))"))).not.toContain(`${handler}: _h("hit")`);
    });
  }

  for (const kind of ["check", "radio", "switch"]) {
    for (const ev of ["focus", "blur"] as const) {
      it(`reports ui.${ev} on ${kind}, whose label never receives it`, () => {
        const tile = kind === "radio" ? 'radio(group="g", selected=done)' : `${kind}(value=done)`;
        expect(codes(source(ev, tile))).toEqual(["W0212"]);
        expect(build(source(ev, tile))).not.toContain(`${HANDLER[ev]}: _h("hit")`);
      });
    }
  }

  it("leaves ui.change on an editable alone, which is the rule rather than the same gap", () => {
    expect(codes(source("change", "editable(bind=note)"))).toEqual(["W0212"]);
  });

  it("leaves ui.click on a link alone: the link reserves click for navigation", () => {
    expect(codes(source("click", 'link(to="/", text="home")'))).toEqual(["W0212"]);
  });
});

describe("assignment through .get is an unwrap, not a field named get", () => {
  const source = (decl: string) => `slot draft : ${decl}
reducer edit on=app.start do= draft.get.title := "b"
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  function buildChecked(src: string): string {
    const program = parse(lex(src));
    check(program);
    return codegen(program, { runtimeSpecifier: "./runtime.js" }).js;
  }

  it("lowers the segment as an unwrap when the receiver is an Option", () => {
    expect(buildChecked(source("Option({title: Text}) = None"))).toContain(
      '[{"get":true}, "title"]',
    );
  });

  it("lowers it as a field when the receiver is a record that has one", () => {
    expect(buildChecked(source('{get: {title: Text}} = {get: {title: "a"}}'))).toContain(
      '["get", "title"]',
    );
  });

  it("checks the value being written against the payload's field type", () => {
    const src = `slot draft : Option({title: Text}) = None
reducer bad on=app.start do= draft.get.title := 3
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const errors = check(parse(lex(src)));
    expect(errors.map((e) => e.code)).toEqual(["E0201"]);
    expect(errors[0]?.message).toBe("Expected Text but got Int");
  });

  it("reports a member the record does not have, as the read side does", () => {
    const src = `slot rec : {title: Text} = {title: "a"}
reducer bad on=app.start do= rec.get.title := "x"
tile App = column(text(rec.title))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const errors = check(parse(lex(src)));
    expect(errors.map((e) => e.code)).toEqual(["E0108"]);
    expect(errors[0]?.message).toBe(
      'Record type has no field or method ".get" — it is a member of Map / List / Option / Result',
    );
  });

  it("keeps the name-based reading when codegen runs without check", () => {
    expect(build(source('{get: {title: Text}} = {get: {title: "a"}}'))).toContain(
      '[{"get":true}, "title"]',
    );
  });
});

describe("fmt lowers to the runtime helper, unguarded", () => {
  const source = `slot greeting : Text = ""
reducer greet on=app.start do= greeting := fmt("Hello {0}, you have {1}", "Ada", 3)
tile App = column(text(greeting))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  it("calls `_s.fmt` with the template and every argument after it", () => {
    expect(build(source)).toMatch(/(?<!\?\s)_s\.fmt\("Hello \{0\}, you have \{1\}", "Ada", 3\)/);
  });

  it("emits no fallback to the template", () => {
    const js = build(source);
    expect(js).not.toContain("_s.fmt ?");
  });
});
