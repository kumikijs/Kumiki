// Compiler-side halves of the divergences between `docs/spec/` and what the
// toolchain actually did. Each block names the spec sentence it enforces; the
// runtime halves live in `packages/runtime/test/spec-divergences.test.ts`.

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

// forms.md §5.2.2: a form is submitted by clicking `button(type="submit")`.
// The argument was parsed, typechecked, and then dropped — it never reached
// the node, so the renderer had nothing to apply and every button in a form
// submitted it.
describe("button(type=…) reaches the tile node", () => {
  it("emits the type when the tile says one", () => {
    const js = build(app("Send", 'tile Send = button(text="send", type="submit")'));
    expect(js).toContain('type: "submit"');
  });

  it("emits nothing when the tile does not, leaving the HTML default", () => {
    // Not `type: undefined` either: the node is compared field-by-field by the
    // reconciler, and a key that is always present changes what "unchanged"
    // means for every button in every app.
    const js = build(app("Plain", 'tile Plain = button(text="plain")'));
    const node = js.slice(js.indexOf('kind: "button"'));
    expect(node.slice(0, node.indexOf("props:"))).not.toContain("type");
  });

  it("rejects a literal type that is not one of the three", () => {
    // The direction matters: an invalid `type` attribute resolves to `submit`,
    // so a typo on a button written NOT to submit makes it submit.
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

// A method whose lowering reads arguments it was not given crashed codegen
// with a bare `TypeError` and no position — `check` said ok and `build` died.
// The class is older than `format`: 36 other methods dereference their first
// argument the same way.
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
    // `get-or` is one method with two shapes — the lowering branches on how
    // many it was given, so only the floor is a contract.
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

// language.md §1.7.2 inv. 5: the iteration target of `for` is `Map.keys`,
// `Set.to-list`, or a `List`. A `Map` and a `Set` are both keyed objects at
// runtime, so iterating one compiled and then threw where the loop was used.
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
    // Covering only the tile form would leave `do= for k in m …` compiling and
    // throwing `object is not iterable` at the first dispatch.
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
    // The check unaliases before asking what the collection is; without that a
    // `type Names = Map(...)` iterates straight past it.
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
    // `null` from the inferencer means "cannot tell", never "not a list". Here
    // the name does not resolve at all: that is one mistake, and it already
    // has a diagnostic — E0218 must not pile a second complaint on top of it.
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

// stdlib.md §2.2.8/§2.2.9: `format(pattern) : Text`, and a `Time` is a
// millisecond number. Codegen honoured neither — `format` produced the ISO
// date whatever the pattern said, and `Time.parse` wrapped the raw text.
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
    // The instant, and the rule for which clock a zone-less string is on, live
    // in one runtime helper: the generic `T.parse` branch that wrapped the raw
    // text in `Some` satisfies neither assertion below.
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

// A handler prop on a tile whose renderer never reads it. Codegen drops it,
// the reducer never runs, and W0212 cannot see it: that check asks about
// `ui.<ev>(Tile)` selectors, and a container passes as soon as any descendant
// is clickable — which every card-with-a-button layout is.
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
    // The message has to name where the handler does work, or the reader is
    // left with "not here" and nowhere to go.
    expect(d?.message).toContain("button");
  });

  it("reports the props form too, which is the other way to write it", () => {
    expect(diags('row(text("card"), InBtn) {onClick: open}').map((e) => e.code)).toEqual(["W0213"]);
  });

  it("says nothing about the tiles that do fire it", () => {
    expect(diags('column(button(text="a", onClick=open))')).toEqual([]);
    expect(diags('column(check(label="a", onChange=open))')).toEqual([]);
    // `editable` dispatches `onInput` from its own renderer, in both
    // spellings — this one and the `ui.input(Ed)` selector below.
    expect(diags('column(editable(value="a", onInput=open))')).toEqual([]);
    // The overlay row is the one hand-written entry in the table.
    expect(diags('column(modal(text("a"), onClose=open))')).toEqual([]);
    expect(diags('column(drawer(text("a"), onClose=open))')).toEqual([]);
  });

  it("says nothing about the four the runtime attaches to any element", () => {
    // `applyUiEventHandlers` wires keydown / mouseenter / focus / blur on
    // whatever element the tile produced, so a container honours them and a
    // warning would be false.
    expect(diags('row(text("card")) {onKeyDown: open}')).toEqual([]);
    expect(diags('row(text("card")) {onMouseEnter: open}')).toEqual([]);
    expect(diags('row(text("card")) {onFocus: open}')).toEqual([]);
    expect(diags('row(text("card")) {onBlur: open}')).toEqual([]);
  });

  // A user tile is asked the same question now (#329), by walking its render
  // tree — so this one is quiet because `InBtn` puts a `button` in the tree,
  // not because user tiles go unexamined. The distinction is the whole subject
  // of the divergence block below: a firing kind in the tree is not the same
  // fact as a firing kind at the root.
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

// errors.md W0213: "the prop lands on the tile's ROOT node, so
// `tile Card = box(button(...))` drops the handler too and is *not* reported,
// because the walk does not distinguish a root from a descendant."
//
// The spec states the gap; this is the half that keeps it honest. Both
// assertions below are FALSE NEGATIVES — a certain drop the checker stays
// silent about — so a later narrowing of the walk to the root should fail
// here and be read as the fix it is, rather than passing unnoticed in
// `ui-lifts.test.ts` where a bare `toEqual([])` is indistinguishable from
// legitimate suppression.
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

  // The premise, not an assumption: the call site's handler is merged onto the
  // node `Card` renders as its root, which is the `box` — handed down into
  // that node's own props, where it joins whatever else the box dispatches.
  // Nothing puts it on the `button` inside, so the click really is dead — a
  // scenario clicking the button never runs `open`.
  it("codegen puts the handler on the root box, not on the button inside", () => {
    const js = build(src('tile Card = box(button(text="go"))'));
    // Counted rather than matched literally, because the fixture's two routes
    // both name `App` and codegen inlines the tree once per route: what has to
    // hold is that EVERY `onClick` in the output is the box's own, so none of
    // them is on the button.
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

// The selector half of the same wiring. `editable`'s renderer registers an
// `input` listener and calls the tile's `onInput`, so `ui.input(Ed)` is a live
// subscription — but the lift table listed only `input` / `textarea`, so
// codegen emitted no handler and the checker reported a reason that was not
// true: that the tile has no descendant which fires "input".
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
    // The control: without it, dropping the check entirely would pass the two
    // above.
    expect(codes(source("box(text(note))"))).toEqual(["W0212"]);
  });
});

// The gap the `ui.input` row had, in three more rows: the fix directly above
// moved `input` alone and left `key` / `focus` / `blur` listing the same
// `input` / `textarea` / `button` (/ `select`) they always had.
//
// The runtime attaches those three to whatever element a tile produced, and a
// `<div contenteditable="true">` is an editing host — focusable without a
// `tabindex` — so all three reach it, which is why writing the handler on the
// tile already worked. What the rows list is where a *selector* lands, so an
// omission there is a gap in the table, not a fact about the DOM, and W0212
// reported it as the latter.
describe("a ui.key / ui.focus / ui.blur selector reaches an editable", () => {
  const source = (ev: string, tile: string) => `slot note : Text = ""
slot hits : Int = 0
reducer hit on=ui.${ev}(Ed) do= hits := hits + 1
tile Ed = ${tile}
tile App = column(Ed, text(hits.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  /**
   * The same program with the handler written on the tile instead. `/404`
   * gets a tile of its own here, unlike the fixtures above: a tile body is
   * inlined once per route that reaches it, so the two-route shape would make
   * an occurrence count track the route table rather than the emission.
   */
  const explicit = (handler: string) => `slot note : Text = ""
slot hits : Int = 0
reducer hit on=app.start do= hits := hits + 1
tile Ed       = editable(bind=note, ${handler}=hit)
tile App      = column(Ed, text(hits.show))
tile NotFound = text("nope")
app A
    caps   = []
    routes = {"/" -> App, "/404" -> NotFound}
    init   = []
`;

  /** `tile Card = box(Ed)` — the selector names the container, not the leaf. */
  const throughAncestor = (ev: string) => `slot note : Text = ""
slot hits : Int = 0
reducer hit on=ui.${ev}(Card) do= hits := hits + 1
tile Ed   = editable(bind=note)
tile Card = box(Ed)
tile App  = column(Card, text(hits.show))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  const cases: ReadonlyArray<[string, string]> = [
    ["key", "onKeyDown"],
    ["focus", "onFocus"],
    ["blur", "onBlur"],
  ];

  for (const [ev, handler] of cases) {
    it(`says nothing about ui.${ev}`, () => {
      expect(codes(source(ev, "editable(bind=note)"))).toEqual([]);
    });

    it(`emits the ${handler} the ui.${ev} subscription asked for`, () => {
      expect(build(source(ev, "editable(bind=note)"))).toContain(`${handler}: _h("hit")`);
    });

    it(`still reports a tile that fires no ${ev} event, and still drops it`, () => {
      // The control for each row: without it, dropping the check entirely
      // would pass the two above. Both halves, because "silently dropped" is
      // a claim about the warning AND about the handler — a change that kept
      // warning while wiring the listener anyway would pass on the code alone.
      expect(codes(source(ev, "box(text(note))"))).toEqual(["W0212"]);
      expect(build(source(ev, "box(text(note))"))).not.toContain(`${handler}: _h("hit")`);
    });

    it(`keeps emitting a ${handler} written on the tile itself`, () => {
      // The evidence that the event reaches an editable at all is that this
      // spelling already worked — and it was pinned nowhere. It also changed
      // code path here: `propsFor` used to reach it only through the
      // explicit-flush loop, and now the lift loop finds it too. Once,
      // whichever loop produced it — the two emitting it side by side is the
      // failure this count exists for.
      const js = build(explicit(handler));
      expect(js).toContain(`${handler}: _h("hit")`);
      expect(js.match(new RegExp(`${handler}: _h\\("hit"\\)`, "g"))).toHaveLength(1);
    });

    it(`lifts ui.${ev} through a container whose leaf is the editable`, () => {
      // `focus` / `blur` do not bubble, so a handler that landed on the `box`
      // would be a dead listener both `check` and `build` accept. The checker
      // walks into the referenced tile, and codegen lifts through the same
      // edge — newly true for `editable`, and the place those two would come
      // apart again.
      expect(codes(throughAncestor(ev))).toEqual([]);
      expect(build(throughAncestor(ev))).toContain(`${handler}: _h("hit")`);
    });
  }

  it("leaves ui.change alone, which is the rule rather than the same gap", () => {
    // The row a reader expects to move with these three. It must not: a
    // `<div contenteditable>` fires no `change` event at all, so there is
    // nothing for a selector to reach and the warning is true.
    expect(codes(source("change", "editable(bind=note)"))).toEqual(["W0212"]);
  });
});

// language.md §1.6.3: "Going via `.get` is safe: assigning when the Option is
// `None` is a no-op". The lvalue was flattened into a plain field path, so the
// write landed on a sibling field named `get` and never reached the payload.
// The read side lowers `.get` through the polymorphic unwrap, and the write
// side has to make the same call — including for the case that makes it a
// call rather than a keyword: a record whose field is literally `get`.
describe("assignment through .get is an unwrap, not a field named get", () => {
  const source = (decl: string) => `slot draft : ${decl}
reducer edit on=app.start do= draft.get.title := "b"
tile App = column(text("x"))
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

  /**
   * `check` writes the dispatch decision onto the AST, so anything asking
   * which way a segment resolved has to run it. `build` alone reaches codegen
   * with no annotation at all, which is a different question — the last test
   * here is the one that asks it.
   */
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
    // Walking the type through `.get` is what makes the write's right-hand
    // side checkable at all: the target used to resolve to nothing, so
    // `checkAgainst` had no expectation to compare with.
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
    // `rec.get.title := v` on a record with no `get` field used to be accepted
    // and to land on `rec.title` — the same sibling-key defect under another
    // name. The read side has always called it E0108.
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
    expect(errors[0]?.message).toBe('Record type has no field or method ".get"');
  });

  it("keeps the name-based reading when codegen runs without check", () => {
    // The same back-compat the read side documents: absent an annotation,
    // `.get` is the unwrap. Two sides agreeing wrongly still beats them
    // disagreeing, which is what produced the sibling field.
    expect(build(source('{get: {title: Text}} = {get: {title: "a"}}'))).toContain(
      '[{"get":true}, "title"]',
    );
  });
});

// stdlib.md §2.4.5: `fmt(template, ...args)` substitutes `{0}`…`{n}`. The
// lowering was `_s.fmt ? _s.fmt(…) : template`, written for a runtime helper
// that was never added — so every call took the else branch and evaluated to
// its own template. The template is a `Text`, which is what a formatted result
// is too, so nothing downstream could tell the two apart (#340).
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
    // The negative lookbehind is what makes this stand on its own: the old
    // lowering `_s.fmt ? _s.fmt(…) : "…"` *contains* the call, so a plain
    // `toContain` passed before the fix as well as after it and discriminated
    // nothing without the test below.
    expect(build(source)).toMatch(/(?<!\?\s)_s\.fmt\("Hello \{0\}, you have \{1\}", "Ada", 3\)/);
  });

  it("emits no fallback to the template", () => {
    // The guard is what let the gap hide: with it, a build against a runtime
    // missing the helper is not a crash but a program that silently formats
    // nothing. Absent it, the same build fails where it can be seen.
    const js = build(source);
    expect(js).not.toContain("_s.fmt ?");
  });
});
