import { feature } from "@kumikijs/examples";
import { type AppShape, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { find, mountApp } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const EXAMPLE = feature("259-select-record-field-order");

async function served(app: AppShape): Promise<HTMLElement> {
  const { html } = await renderToString(app);
  const page = document.createElement("div");
  page.innerHTML = html;
  return page;
}

function mounted(app: AppShape): HTMLElement {
  const { root, handle } = mountApp(app);
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  return root;
}

const select = (root: ParentNode, selector: string): HTMLSelectElement =>
  find<HTMLSelectElement>(root, selector);

const labels = (options: HTMLOptionElement[]): string[] => options.map((o) => o.textContent ?? "");

// Read off the attribute rather than `selectedIndex`: happy-dom does not apply the
// HTML selectedness rule to parsed options, while a browser shows the marked one.
const markedOnServer = (sel: HTMLSelectElement): string[] =>
  labels(Array.from(sel.options).filter((o) => o.hasAttribute("selected")));

const heldOnClient = (sel: HTMLSelectElement): string[] =>
  labels(Array.from(sel.options).filter((o) => o.selected));

// The slots are written `{h=3, w=2}` and `Some({h=4, w=4})`, their options `{w=2, h=3}`
// and `Some({w=4, h=4})`: compiled, each record keeps the field order it was written in.
const HELD: Array<[string, string]> = [
  ["#dims", "2 x 3"],
  ["#crop", "Crop 4 x 4"],
];

describe("a select holds a record option whatever order its fields are written in", () => {
  it("on the served page", async () => {
    const page = await served(await loadApp(EXAMPLE));
    for (const [id, label] of HELD) expect(markedOnServer(select(page, id)), id).toEqual([label]);
  });

  it("on the mounted page", async () => {
    const root = mounted(await loadApp(EXAMPLE));
    for (const [id, label] of HELD) expect(heldOnClient(select(root, id)), id).toEqual([label]);
  });
});
