import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { mount, runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot, withRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";
import { withApp } from "./helpers/source.ts";

const blockStyleApp = feature("51-selector-id");
const argStyleApp = feature("52-selector-id-arg");
const descendantsApp = feature("216-selector-id-descendants");

describe("static TileName#id selector matching", () => {
  it("fires id-scoped + unscoped reducers in source order, skips id-mismatched ones", async () => {
    const report = await runScenario(await loadApp(blockStyleApp), freshRoot(), {
      steps: [
        { do: { clickText: "New" }, expect: { noErrors: true, state: { log: "hit;plain;" } } },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it("renders the {id} prop as the element's native DOM id attribute", async () => {
    const root = freshRoot();
    const handle = mount(await loadApp(blockStyleApp), root);
    try {
      expect(root.querySelector("#new")?.tagName.toLowerCase()).toBe("button");
      expect(root.querySelector("#edit")?.tagName.toLowerCase()).toBe("button");
    } finally {
      handle.dispose();
    }
  });

  it('matches arg-style id (input(id="…")) the same as block-style {id: "…"}', async () => {
    const report = await runScenario(await loadApp(argStyleApp), freshRoot(), {
      steps: [
        { do: { fill: "input", value: "hello" }, expect: { noErrors: true, state: { hits: 1 } } },
      ],
    });
    expect(report.ok).toBe(true);
  });
});

describe("E0212 agrees with what a container's selector matches", () => {
  const source = readFileSync(descendantsApp, "utf8");
  const scenario = JSON.parse(
    readFileSync(descendantsApp.replace(/\.kumiki$/, ".scenario.json"), "utf8"),
  ) as Scenario;
  const flagged = (src: string): string[] =>
    check(parse(lex(src)), { strictSelectorId: true })
      .filter((d) => d.code === "E0212")
      .map((d) => /Reducer "([^"]+)"/.exec(d.message)?.[1] ?? d.message);

  it("accepts every selector the example's scenario shows firing", () => {
    expect(flagged(source)).toEqual([]);
  });

  it("reports the selectors no wired element can match, and those never fire", async () => {
    const variant = `${source}
reducer toolbarSelf on=ui.click(Toolbar#toolbar) do= log := log + "toolbar;"
reducer clearTypo   on=ui.click(Clear#clr)       do= log := log + "clr;"
reducer searchGo    on=ui.input(Search#go)       do= log := log + "searchgo;"
`;
    expect(flagged(variant)).toEqual(["toolbarSelf", "clearTypo", "searchGo"]);
    // The scenario asserts the whole log after every event that could reach them, so it
    // passes only if none of the three fired.
    const report = await runScenario(await loadSource(variant), freshRoot(), scenario);
    expect(report.ok, failureDetail(report)).toBe(true);
  });
});

describe("the reducers E0212 accepts are exactly the reducers that fire", () => {
  // Each reducer with a `#id` selector logs its own name, so the log after the steps names the
  // reducers that fired.
  const cases: { name: string; program: string; steps: Scenario["steps"]; fires: string[] }[] = [
    {
      name: "a container's descendants, not its own id",
      program: `
reducer hitB on=ui.click(Bar#save) do= log := log + "hitB;"
reducer hitA on=ui.click(Bar#bar)  do= log := log + "hitA;"
reducer hit2 on=ui.click(Btn2#tow) do= log := log + "hit2;"
tile Bar  = row(button(text="Save", id="save"), button(text="Other", id="other")) {id: "bar"}
tile Btn2 = button(text="Two", id="two")
tile App  = column(Bar, Btn2, text("log=" + log))`,
      steps: [
        { do: { clickText: "Save" } },
        { do: { clickText: "Other" } },
        { do: { clickText: "Two" } },
      ],
      fires: ["hitB"],
    },
    {
      name: "an id written up a chain of tiles that render the element at their root",
      program: `
reducer viaT on=ui.click(T#x) do= log := log + "viaT;"
reducer viaB on=ui.click(T#b) do= log := log + "viaB;"
tile Inner = button(text="Hit", id="b")
tile T     = Inner
tile Outer = T
tile App   = column(Outer(id="x"), text("log=" + log))`,
      steps: [{ do: { clickText: "Hit" } }],
      fires: ["viaT"],
    },
    {
      name: "the outermost of the call sites up that chain",
      program: `
reducer outerId on=ui.click(T#outer) do= log := log + "outerId;"
reducer innerId on=ui.click(T#inner) do= log := log + "innerId;"
tile Inner = button(text="Hit", id="b")
tile T     = Inner
tile Mid   = T(id="inner")
tile App   = column(Mid(id="outer"), text("log=" + log))`,
      steps: [{ do: { clickText: "Hit" } }],
      fires: ["outerId"],
    },
    {
      name: "a fallback rendered at the root of a call site that writes an id",
      program: `
slot secret : Option(Text) = None
slot reveal : Bool         = false
tile Fb in=PanicInfo = button(text="Retry", id="fb")
tile Risky
    error-boundary = Fb
    = column(text("ok"), when(reveal, text("s: " + secret.get)))
tile T         = Risky
tile RevealBtn = button(text="reveal", onClick=doReveal)
tile App       = column(T {id: "c"}, RevealBtn, text("log=" + log))
reducer doReveal on=ui.click(RevealBtn) do= reveal := true
reducer retried  on=ui.click(Fb#c)      do= log := log + "retried;"
reducer fbOwn    on=ui.click(Fb#fb)     do= log := log + "fbOwn;"`,
      steps: [{ do: { clickText: "reveal" } }, { do: { clickText: "Retry" } }],
      fires: ["retried"],
    },
    {
      name: "a reducer a handler names, which fires on the handler's element",
      program: `
reducer hit   on=ui.click(B#other) do= log := log + "hit;"
reducer bOnly on=ui.click(B#x)     do= log := log + "bOnly;"
tile B   = button(text="B", id="b")
tile App = column(B, button(text="Other", id="other", onClick=hit), text("log=" + log))`,
      steps: [{ do: { clickText: "B" } }, { do: { clickText: "Other" } }],
      fires: ["hit"],
    },
    {
      name: "a call-site id on a tile whose firing element is not at its root",
      program: `
reducer barSave on=ui.click(Bar#save) do= log := log + "barSave;"
reducer barX    on=ui.click(Bar#x)    do= log := log + "barX;"
tile Bar = row(button(text="Save", id="save"))
tile App = column(Bar(id="x"), text("log=" + log))`,
      steps: [{ do: { clickText: "Save" } }],
      fires: ["barSave"],
    },
    {
      name: "an id every use of the tile replaces",
      program: `
reducer fiveOwn on=ui.click(Five#b5) do= log := log + "fiveOwn;"
reducer fiveW   on=ui.click(Five#w5) do= log := log + "fiveW;"
tile Five = button(text="Five", id="b5")
tile App  = column(Five {id: "w5"}, text("log=" + log))`,
      steps: [{ do: { clickText: "Five" } }],
      fires: ["fiveW"],
    },
    {
      name: "a tile called with an id in one place and as it is in another",
      program: `
reducer btnGo on=ui.click(Btn#go) do= log := log + "btnGo;"
reducer btnX  on=ui.click(Btn#x)  do= log := log + "btnX;"
reducer btnZ  on=ui.click(Btn#zz) do= log := log + "btnZ;"
tile Btn = button(text="Go", id="go")
tile App = column(Btn(id="x"), row(Btn), text("log=" + log))`,
      steps: [{ do: { click: "#x" } }, { do: { click: "#go" } }],
      fires: ["btnGo", "btnX"],
    },
  ];

  it.each(cases)("$name", async ({ program, steps, fires }) => {
    const source = withApp(`slot log : Text = ""\n${program}`);
    const ast = parse(lex(source));
    const flagged = new Set(
      check(ast, { strictSelectorId: true })
        .filter((d) => d.code === "E0212")
        .map((d) => /Reducer "([^"]+)"/.exec(d.message)?.[1]),
    );
    const accepted = ast.defs
      .filter((d) => d.kind === "ReducerDef" && d.on.kind === "UiEvent" && d.on.selector.id)
      .map((d) => d.name)
      .filter((name) => !flagged.has(name));
    const shape = await loadSource(source);
    const report = await withRoot((root) => runScenario(shape, root, { steps }));
    expect(report.ok, failureDetail(report)).toBe(true);
    const fired = String(shape.live?.log ?? "")
      .split(";")
      .filter(Boolean);
    expect(fired.sort()).toEqual([...fires].sort());
    expect(accepted.sort()).toEqual([...fires].sort());
  });
});
