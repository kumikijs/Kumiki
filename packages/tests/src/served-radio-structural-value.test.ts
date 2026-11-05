import { feature } from "@kumikijs/examples";
import { type AppShape, hydrate, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { freshRoot, mountApp } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("258-served-radio-structural-value");
const GROUPS = ["plan", "size", "status", "dims"];

function page(html: string): HTMLElement {
  const root = freshRoot();
  onTestFinished(() => root.remove());
  root.innerHTML = html;
  return root;
}

function mounted(app: AppShape): HTMLElement {
  const { root, handle } = mountApp(app);
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  return root;
}

const radios = (root: ParentNode, group: string): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>(`input[type=radio][name=${group}]`));

const values = (root: ParentNode, group: string): (string | null)[] =>
  radios(root, group).map((r) => r.getAttribute("value"));

const labelOf = (r: HTMLInputElement): string => r.parentElement?.textContent ?? "";

describe("a served radio whose value is structural", () => {
  it("carries the value the mounted radio carries, one per radio of its group", async () => {
    const app = await loadApp(EXAMPLE);
    const served = page((await renderToString(app)).html);
    const live = mounted(app);
    for (const group of GROUPS) {
      const own = values(served, group);
      expect(new Set(own).size, group).toBe(own.length);
      expect(own, group).toEqual(values(live, group));
    }
  });

  it("checks the slot's radio in the served markup", async () => {
    const served = page((await renderToString(await loadApp(EXAMPLE))).html);
    const checked = GROUPS.map((group) =>
      radios(served, group)
        .filter((r) => r.hasAttribute("checked"))
        .map(labelOf),
    );
    expect(checked).toEqual([["Pro"], ["Medium"], ["In progress"], ["2 x 3"]]);
  });

  it("keeps the slot's radio checked through hydration, and choosing another writes its value", async () => {
    const app = await loadApp(EXAMPLE);
    const rendered = await renderToString(app);
    Reflect.deleteProperty(app, "live");
    const target = page(rendered.html);
    const handle = hydrate(app, target, rendered);
    onTestFinished(() => handle.dispose());

    const checked = GROUPS.map((group) =>
      radios(target, group)
        .filter((r) => r.checked)
        .map(labelOf),
    );
    expect(checked).toEqual([["Pro"], ["Medium"], ["In progress"], ["2 x 3"]]);

    const backlog = radios(target, "status").find((r) => labelOf(r) === "Backlog");
    backlog?.click();
    expect(app.live?.status).toEqual({ _tag: "Some", _0: { _tag: "Backlog" } });
  });
});
