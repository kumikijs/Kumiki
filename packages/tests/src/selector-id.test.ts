import { readFileSync } from "node:fs";
import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { mount, runScenario, type Scenario } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { freshRoot } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { failureDetail } from "./helpers/scenario.ts";

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
