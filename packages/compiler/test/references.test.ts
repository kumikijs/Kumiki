import { buildDefIndex, lex, parse, type Reference, referencesIn } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

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
});
