import { buildDefIndex, lex, parse, type Reference, referencesIn } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { codesOf } from "./helpers/diagnostics.ts";

/** Every reference the definition named `qname` makes, as `layer.name@line:col`. */
function refsOf(src: string, qname: string): string[] {
  const program = parse(lex(src));
  const index = buildDefIndex(program);
  const [layer, name] = [qname.slice(0, qname.indexOf(".")), qname.slice(qname.indexOf(".") + 1)];
  const def = program.defs.find(
    (d) => "name" in d && d.name === name && d.kind.toLowerCase().startsWith(layer),
  );
  if (!def) throw new Error(`no ${qname} in fixture`);
  return referencesIn(def, index).map(fmt);
}

function fmt(r: Reference): string {
  return r.pos ? `${r.layer}.${r.name}@${r.pos.line}:${r.pos.col}` : `${r.layer}.${r.name}@-`;
}

describe("reference walker", () => {
  it("reports each reference with the position of its own identifier", () => {
    const src = `slot count : Int = 0
tile Btn = button(text="count", onClick=bump)
reducer bump on=ui.click(Btn) do= count := count + 1
`;
    // The string "count" is not a reference; the two `count`s in the body are.
    expect(refsOf(src, "reducer.bump")).toEqual([
      "tile.Btn@3:26",
      "slot.count@3:35",
      "slot.count@3:44",
    ]);
    // `onClick=bump` names a reducer, not a slot — and `text="count"` names
    // nothing at all.
    expect(refsOf(src, "tile.Btn")).toEqual(["reducer.bump@2:41"]);
  });

  it("does not treat a record field name as a reference", () => {
    const src = `type ItemId = nominal Text where len-eq(3)
type Item = {id: ItemId, label: Text}
slot label : Text = ""
`;
    expect(refsOf(src, "type.Item")).toEqual(["type.ItemId@2:18"]);
  });

  describe("a local binding shadows a definition of the same name", () => {
    const decl = `slot label : Text = ""
slot items : List(Text) = []
fn shout(label: Text) -> Text = label
`;

    it("for a `for` statement's bind", () => {
      const src = `${decl}reducer r on=ui.click(B) do= for label in items { items := [label] }
tile B = button(text="b")
`;
      expect(refsOf(src, "reducer.r")).toEqual([
        "tile.B@4:23",
        "slot.items@4:43",
        "slot.items@4:51",
      ]);
    });

    it("for a tile `for` bind", () => {
      const src = `${decl}tile L = column(for label in items text(label))
`;
      expect(refsOf(src, "tile.L")).toEqual(["slot.items@4:30"]);
    });

    it("for a `let`", () => {
      const src = `${decl}reducer r on=ui.click(B) do= let label = "x"
                             items := [label]
tile B = button(text="b")
`;
      expect(refsOf(src, "reducer.r")).toEqual(["tile.B@4:23", "slot.items@5:30"]);
    });

    it("for an fn parameter", () => {
      expect(refsOf(decl, "fn.shout")).toEqual([]);
    });

    it("but not for a record key, which is never a binding either way", () => {
      const src = `${decl}fn wrap(x: Text) -> Text = {label: label}.label
`;
      // The key `label` is a field name; the VALUE `label` is the slot.
      expect(refsOf(src, "fn.wrap")).toEqual(["slot.label@4:36"]);
    });
  });

  describe("names that live outside an ordinary expression position", () => {
    it("resolves a link's prefetch prop to a reducer", () => {
      const src = `slot n : Int = 0
reducer load on=route.enter("/x") do= n := 1
tile Home = link(to="/x") {text: "go", prefetch: load}
`;
      expect(refsOf(src, "tile.Home")).toEqual(["reducer.load@3:50"]);
    });

    it("resolves confirm's onYes / onNo to reducers", () => {
      const src = `slot n : Int = 0
reducer yes on=ui.click(B) do= n := 1
reducer ask on=ui.click(B) do= emit confirm({title: "t", message: "m", onYes: yes})
tile B = button(text="b")
`;
      expect(refsOf(src, "reducer.ask")).toEqual(["tile.B@3:25", "reducer.yes@3:79"]);
    });

    it("resolves a motion prop, which is a string literal", () => {
      const src = `motion Spin = {from: {rotate: "0deg"}, to: {rotate: "360deg"}, duration: "1s"}
tile S = box() {motion: "Spin"}
`;
      expect(refsOf(src, "tile.S")).toEqual(["motion.Spin@2:25"]);
    });

    it("resolves a tile.mount lifecycle event at the tile name, not the pattern", () => {
      const src = `slot n : Int = 0
tile Panel = card(text("p"))
reducer on-panel on=tile.mount(Panel) do= n := 1
`;
      expect(refsOf(src, "reducer.on-panel")).toEqual(["tile.Panel@3:32", "slot.n@3:43"]);
    });

    it("resolves an app.init callee as an effect and never as a fn", () => {
      const src = `slot n : Int = 0
effect load cap=storage.read in=Unit out=Result(Text, Text)
fn load(x: Int) -> Int = x + 1
reducer got on=load.ok($v, _) do= n := 1
tile App = column(text(load(n).show))
app A
    caps   = [storage.read]
    routes = {"/" -> App, "/404" -> App}
    init   = [load()]
`;
      expect(refsOf(src, "app.A")).toEqual(["tile.App@8:22", "tile.App@8:37", "effect.load@9:15"]);
    });

    it("resolves run-reducer's argument inside a property-test invariant", () => {
      const src = `slot count : Int = 0
reducer inc on=ui.click(B) do= count := count + 1
tile B = button(text="b")
test round-trips =
    property-test
        for-all   = {count: Int}
        given     = {slots: {count: count}, event: {type: ui.click, target: B}}
        invariant = run-reducer(inc).slots.count == count
`;
      expect(refsOf(src, "test.round-trips")).toContain("reducer.inc@8:33");
    });
  });

  describe("the app definition", () => {
    const app = (theme: string, extra: string) => `${extra}tile App = column(text("hi"))
reducer onUnauth on=app.start do= n := 1
slot n : Int = 0
app A
    caps   = [http.get]
    routes = {"/" -> App, "/404" -> App}
    init   = []
    theme  = ${theme}
    http   = {base-url: "/api", on-401: onUnauth}
`;

    it("names a theme definition the theme clause selects", () => {
      const src = app(
        "Light",
        `theme Light = {colors: {bg: "#fff"}}
`,
      );
      expect(refsOf(src, "app.A")).toContain("theme.Light@9:14");
    });

    it("names the slot the theme clause reads the name from", () => {
      const src = app(
        "themeName",
        `slot themeName : Text = "Light"
`,
      );
      expect(refsOf(src, "app.A")).toContain("slot.themeName@9:14");
    });

    it("names an app.http handler at the handler, not at the app", () => {
      const src = app(
        "Light",
        `theme Light = {colors: {bg: "#fff"}}
`,
      );
      expect(refsOf(src, "app.A")).toContain("reducer.onUnauth@10:41");
    });
  });

  describe("the test layer", () => {
    const src = `slot count : Int = 0
reducer inc on=ui.click(IncBtn) do= count := count + 1
tile IncBtn = button(text="+", onClick=inc)
test inc-increments =
    reducer-test inc
        given  = {slots: {count: 1}, event: {type: ui.click, target: IncBtn}}
        expect = {slots: {count: 2}, effects: []}
`;

    it("names the reducer it drives, at a rewritable position", () => {
      expect(refsOf(src, "test.inc-increments")).toContain("reducer.inc@5:18");
    });

    it("names the tile its event targets", () => {
      expect(refsOf(src, "test.inc-increments").filter((r) => r.startsWith("tile."))).toEqual([
        "tile.IncBtn@6:70",
      ]);
    });

    it("names the slots its given/expect blocks key on, without a position", () => {
      expect(refsOf(src, "test.inc-increments")).toContain("slot.count@-");
    });
  });

  // Where a fn and an effect share a name, a position read in the wrong namespace shows up as the
  // wrong layer rather than as nothing.
  describe("the names inside a test body", () => {
    const decls = `slot draft : Text = ""
slot items : List(Text) = []
effect persist cap=storage.write in=List(Text) out=Result(Int, Text)
effect shout cap=storage.write in=Text out=Result(Int, Text)
fn persist(x: List(Text)) -> List(Text) = x
fn shout(t: Text) -> Text = t + "!"
reducer add on=ui.submit(F) do= items := items.push(shout(draft))
tile F = form(input(bind=draft))
`;
    const src = `${decls}test t =
    reducer-test add
        given  = {slots: {draft: shout("x")}, event: {type: ui.submit, target: F}}
        expect = {effects: [persist(<slots.items>), persist]}
`;
    const named = (name: string, from = src) =>
      refsOf(from, "test.t").filter((r) => r.slice(r.indexOf(".") + 1).startsWith(`${name}@`));

    it("names an expect.effects entry as the effect, at its callee", () => {
      // A call and a bare name alike. Neither is the fn of the same name.
      expect(named("persist")).toEqual(["effect.persist@12:29", "effect.persist@12:53"]);
    });

    it("resolves a call in a given value as the fn it calls, at its callee", () => {
      expect(named("shout")).toEqual(["fn.shout@11:34"]);
    });

    it("names the slot a <slots.X> wildcard reads, at X", () => {
      expect(named("items")).toEqual(["slot.items@12:44"]);
    });

    it("names no slot for a wildcard outside a test, which reads nothing", () => {
      // E0109 there, and a sentinel once lowered. An edge would be a read, and
      // a slot initializer's slot edges are what E0304 reports.
      const src = `slot b : Int = 0
slot a : Int = <slots.b>
`;
      expect(refsOf(src, "slot.a")).toEqual([]);
      // E0003 aside, which only says the fixture has no app.
      expect(codesOf(src).filter((c) => c !== "E0003")).toEqual(["E0109"]);
    });

    it("reads only the expect's own `effects` section as a list of effects", () => {
      // `effects` here is a slot the expect asserts, and its value a call.
      const slotNamedEffects = `slot effects : List(Text) = []
${decls}test t =
    reducer-test add
        given  = {event: {type: ui.submit, target: F}}
        expect = {slots: {effects: [shout("x")]}}
`;
      expect(named("shout", slotNamedEffects)).toEqual(["fn.shout@13:37"]);
    });

    it("reads an `effects` key as a list of effects only in a kind whose expect has it", () => {
      // An episode-test's expect has no `effects` section, so the key is E0714
      // and nothing in it is read: not `persist` as the effect, not as the fn,
      // and not the slot in its argument. Its `slots-equal` is read.
      const episode = `${decls}test t =
    episode-test
        load   = "log.jsonl"
        mocks  = {}
        expect = {slots-equal: {items: []}, effects: [persist(items)]}
`;
      expect(refsOf(episode, "test.t")).toEqual(["slot.items@-"]);
      expect(codesOf(episode)).toContain("E0714");
    });

    // `delay` / `ok` / `err` / `ignore` are the mock's own vocabulary, even
    // with a fn or a slot of that name in scope; only the delay and the
    // payloads are expressions.
    describe("a mock", () => {
      const mockDecls = `slot n : Int = 0
slot ignore : Int = 0
effect persist cap=storage.write in=Int out=Result(Int, Text)
effect load cap=storage.read in=Unit out=Result(Int, Text)
fn ok(x: Int) -> Int = x
fn err(x: Int) -> Int = x
fn delay(x: Int) -> Int = x
fn twice(x: Int) -> Int = x * 2
reducer inc on=ui.click(B) do= emit persist(n)
tile B = button(text="b", onClick=inc)
`;
      /** What the mock contributes: everything but the test's target and its event's. */
      const mockRefs = (from: string) =>
        refsOf(from, "test.t").filter((r) => !r.startsWith("reducer.") && !r.startsWith("tile."));

      it("in a reducer-test's given names its effect by key, and fns only in its values", () => {
        const src = `${mockDecls}test t =
    reducer-test inc
        given  = {mocks: {persist: delay(twice(5), ok(twice(1)))}, event: {type: ui.click, target: B}}
        expect = {effects: []}
`;
        expect(mockRefs(src)).toEqual(["effect.persist@-", "fn.twice@13:42", "fn.twice@13:55"]);
      });

      it("in an episode-test names its effect by key, and fns only in its values", () => {
        const src = `${mockDecls}test t =
    episode-test
        load   = "log.jsonl"
        mocks  = {persist: err(twice(1)), load: ignore}
        expect = {no-errors: true}
`;
        expect(mockRefs(src)).toEqual(["effect.persist@-", "fn.twice@14:32", "effect.load@-"]);
      });
    });

    // A section name is a section only where the test's kind has it, at the
    // top of the `given` or `expect` it belongs to: one level down it is a
    // slot, or a field of a slot's value, like any other key.
    describe("section by section", () => {
      it("reads a slot named `mocks` as a slot, and the call in its value as a fn", () => {
        const src = `effect save cap=storage.write in=Int out=Result(Int, Text)
slot mocks : {save: Int} = {save: 0}
fn ok(x: Int) -> Int = x
reducer r on=ui.click(B) do= mocks := {save: mocks.save + 1}
tile B = button(text="b", onClick=r)
test t =
    reducer-test r
        given  = {slots: {mocks: {save: ok(1)}}, event: {type: ui.click, target: B}}
        expect = {slots: {mocks: {save: 2}}, effects: []}
`;
        expect(refsOf(src, "test.t")).toEqual([
          "reducer.r@7:18",
          "slot.mocks@-",
          "fn.ok@8:41",
          "tile.B@8:82",
          "slot.mocks@-",
        ]);
      });

      it("reads nothing under a key that names no section of the test's kind", () => {
        // `mocks` is a section of a reducer-test's given only. In its expect,
        // and in a property-test's given, it is E0714, and neither its key nor
        // its value is read.
        const decls = `effect save cap=storage.write in=Int out=Result(Int, Text)
slot n : Int = 0
fn twice(x: Int) -> Int = x * 2
reducer r on=ui.click(B) do= n := n + 1
tile B = button(text="b", onClick=r)
`;
        const inExpect = `${decls}test t =
    reducer-test r
        given  = {event: {type: ui.click, target: B}}
        expect = {slots: {n: 1}, mocks: {save: ok(twice(1))}}
`;
        expect(refsOf(inExpect, "test.t")).toEqual(["reducer.r@7:18", "tile.B@8:51", "slot.n@-"]);
        const inPropertyGiven = `${decls}test t =
    property-test
        for-all   = {k: Int}
        given     = {slots: {n: k}, mocks: {save: ok(twice(1))}}
        invariant = run-reducer(r).slots.n == k + 1
`;
        expect(refsOf(inPropertyGiven, "test.t")).toEqual(["slot.n@-", "reducer.r@10:33"]);
        for (const src of [inExpect, inPropertyGiven]) expect(codesOf(src)).toContain("E0714");
      });

      it("reads an episode-test's `slots-equal` keys as slots", () => {
        const src = `slot seen : Text = ""
fn root() -> Text = "/"
test replay =
    episode-test
        load   = "log.jsonl"
        mocks  = {}
        expect = {slots-equal: {seen: root()}, no-panics: true}
`;
        expect(refsOf(src, "test.replay")).toEqual(["slot.seen@-", "fn.root@7:39"]);
      });

      it("binds the `for-all` names in the given, as it does in the invariant", () => {
        // `size` is a fn and `total` a slot, and in this test both are the
        // generated values: neither is a reference where the test reads it.
        const src = `slot total : Int = 0
fn size(x: Int) -> Int = x
reducer r on=ui.click(B) do= total := total + 1
tile B = button(text="b", onClick=r)
test p =
    property-test
        for-all   = {size: Int where between(0, 5), total: Int}
        given     = {slots: {total: size + total}, event: {type: ui.click, target: B}}
        invariant = run-reducer(r).slots.total == size + total + 1
`;
        expect(refsOf(src, "test.p")).toEqual(["slot.total@-", "tile.B@8:84", "reducer.r@9:33"]);
      });

      it("reads an event's `type` as no name, and its `target` as a tile only for a ui event", () => {
        // `ui` is a slot, and `ui.click` still names the event. A timer's
        // event is aimed at no tile, whatever its `target` says.
        const src = `slot ui : Int = 0
reducer r on=ui.click(B) do= ui := ui + 1
reducer tick on=timer(1s) do= ui := ui + 1
tile B = button(text="b", onClick=r)
test t =
    reducer-test r
        given  = {event: {type: ui.click, target: B}}
        expect = {slots: {ui: 1}}
test timed =
    reducer-test tick
        given  = {event: {type: timer, target: B}}
        expect = {slots: {ui: 1}}
`;
        expect(refsOf(src, "test.t")).toEqual(["reducer.r@6:18", "tile.B@7:51", "slot.ui@-"]);
        expect(refsOf(src, "test.timed")).toEqual(["reducer.tick@10:18", "slot.ui@-"]);
      });

      it("reads a `target` field inside a slot's value as the value it is", () => {
        // `Home` is a variant of `Screen` here, and a tile as well.
        const src = `type Screen = Home | Settings
slot nav : {target: Screen} = {target: Settings}
tile Home = text("home")
reducer go on=ui.click(B) do= nav := {target: Home}
tile B = button(text="b", onClick=go)
test t =
    reducer-test go
        given  = {event: {type: ui.click, target: B}}
        expect = {slots: {nav: {target: Home}}}
`;
        expect(refsOf(src, "test.t")).toEqual(["reducer.go@7:18", "tile.B@8:51", "slot.nav@-"]);
      });
    });
  });
});
