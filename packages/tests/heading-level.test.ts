// stdlib.md §2.3: `heading(level=n, …)` is an `<h{n}>` on the DOM path and in
// SSR output alike. The corpus example (`156-heading-level`) walks the levels
// and a level change through its scenario; this suite reads the tag names on
// both paths and pins how a level outside 1-6 is drawn.

import { mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

function appOf(body: string): string {
  return `
slot depth : Int = 2
reducer deeper on=ui.click(DeeperBtn) do= depth := depth + 1
tile DeeperBtn = button(text="Deeper", onClick=deeper)
tile App = column(${body}, DeeperBtn)
app P
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
}

const OUTLINE = appOf(
  'heading("One"), heading(level=2, "Two"), heading("Three", level=3), heading("Six", level=6)',
);

function tags(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("[data-kumiki-tile='heading']")).map((h) =>
    h.tagName.toLowerCase(),
  );
}

describe("heading level", () => {
  it("renders h1 … h6 on mount", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mount(await loadSource(OUTLINE), root);
    expect(tags(root)).toEqual(["h1", "h2", "h3", "h6"]);
    handle.dispose();
    root.remove();
  });

  it("serves the same tags from renderToString", async () => {
    const out = await renderToString(await loadSource(OUTLINE));
    const host = document.createElement("div");
    host.innerHTML = out.html;
    expect(tags(host)).toEqual(["h1", "h2", "h3", "h6"]);
  });

  it("re-creates the element when a slot-driven level changes", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mount(await loadSource(appOf('heading("Moving", level=depth)')), root);
    expect(tags(root)).toEqual(["h2"]);
    root.querySelector("button")?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tags(root)).toEqual(["h3"]);
    expect(root.textContent).toContain("Moving");
    handle.dispose();
    root.remove();
  });

  it("pulls a level outside 1-6 to the nearer end, and drops a fraction", async () => {
    const src = appOf(
      'heading("a", level=0), heading("b", level=9), heading("c", level=2.7), heading("d", level=-3)',
    );
    const root = document.createElement("div");
    document.body.appendChild(root);
    const handle = mount(await loadSource(src), root);
    expect(tags(root)).toEqual(["h1", "h6", "h2", "h1"]);
    handle.dispose();
    root.remove();
    const host = document.createElement("div");
    host.innerHTML = (await renderToString(await loadSource(src))).html;
    expect(tags(host)).toEqual(["h1", "h6", "h2", "h1"]);
  });
});
