import { feature } from "@kumikijs/examples";
import { hydrate, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { find, freshRoot, served, withMounted } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("258-served-radio-structural-value");

// Each group's radios in order, by the key their `value` carries: one key per radio.
const KEYS: Record<string, string[]> = {
  plan: ['"free"', '"pro"'],
  size: ["S", "M", "L"],
  status: ["None", "Some|Backlog", "Some|InProgress"],
  dims: ['{"h":1,"w":1}', '{"h":3,"w":2}'],
};
const GROUPS = Object.keys(KEYS);

const radios = (root: ParentNode, group: string): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>(`input[type=radio][name=${group}]`));

const values = (root: ParentNode, group: string): (string | null)[] =>
  radios(root, group).map((r) => r.getAttribute("value"));

const labelOf = (r: HTMLInputElement): string => r.parentElement?.textContent ?? "";

describe("a served radio whose value is structural", () => {
  it("carries each radio's key, the same on the served page and the mounted one", async () => {
    const app = await loadApp(EXAMPLE);
    const page = await served(app);
    const keys = (root: ParentNode) =>
      Object.fromEntries(GROUPS.map((group) => [group, values(root, group)]));
    expect(keys(page)).toEqual(KEYS);
    await withMounted(app, async (live) => {
      expect(keys(live)).toEqual(KEYS);
    });
  });

  it("checks the slot's radio in the served markup", async () => {
    const page = await served(await loadApp(EXAMPLE));
    const checked = GROUPS.map((group) =>
      radios(page, group)
        .filter((r) => r.hasAttribute("checked"))
        .map(labelOf),
    );
    expect(checked).toEqual([["Pro"], ["Medium"], ["In progress"], ["2 x 3"]]);
  });

  it("keeps the slot's radio checked through hydration, and choosing another writes its value", async () => {
    const app = await loadApp(EXAMPLE);
    const rendered = await renderToString(app);
    Reflect.deleteProperty(app, "live");
    const target = freshRoot();
    onTestFinished(() => target.remove());
    target.innerHTML = rendered.html;
    const handle = hydrate(app, target, rendered);
    onTestFinished(() => handle.dispose());

    const checked = GROUPS.map((group) =>
      radios(target, group)
        .filter((r) => r.checked)
        .map(labelOf),
    );
    expect(checked).toEqual([["Pro"], ["Medium"], ["In progress"], ["2 x 3"]]);

    find<HTMLInputElement>(target, "#statusBacklog input").click();
    expect(app.live?.status).toEqual({ _tag: "Some", _0: { _tag: "Backlog" } });
  });
});
