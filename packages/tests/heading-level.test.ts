// stdlib.md §2.3: `heading(level=n, …)` is an `<h{n}>` on the DOM path and in
// SSR output alike. The corpus example (`156-heading-level`) walks the levels
// and a level change through its scenario; this suite reads the tag names on
// both paths and pins how a level outside 1-6 is drawn.

import { mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
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

// Every mount is torn down here rather than at the end of its test, so a
// failing assertion cannot leave a live app in the document for the next test.
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function mountSource(src: string): Promise<HTMLElement> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  cleanups.push(() => root.remove());
  const handle = mount(await loadSource(src), root);
  cleanups.unshift(() => handle.dispose());
  return root;
}

describe("heading level", () => {
  it("renders h1 … h6 on mount", async () => {
    const root = await mountSource(OUTLINE);
    expect(tags(root)).toEqual(["h1", "h2", "h3", "h6"]);
  });

  it("serves the same tags from renderToString", async () => {
    const out = await renderToString(await loadSource(OUTLINE));
    const host = document.createElement("div");
    host.innerHTML = out.html;
    expect(tags(host)).toEqual(["h1", "h2", "h3", "h6"]);
  });

  it("re-creates the element when a slot-driven level changes", async () => {
    const root = await mountSource(appOf('heading("Moving", level=depth)'));
    expect(tags(root)).toEqual(["h2"]);
    root.querySelector("button")?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(tags(root)).toEqual(["h3"]);
    expect(root.textContent).toContain("Moving");
  });

  it("pulls a level outside 1-6 to the nearer end, and drops a fraction", async () => {
    const src = appOf(
      'heading("a", level=0), heading("b", level=9), heading("c", level=2.7), heading("d", level=-3)',
    );
    const root = await mountSource(src);
    expect(tags(root)).toEqual(["h1", "h6", "h2", "h1"]);
    const host = document.createElement("div");
    host.innerHTML = (await renderToString(await loadSource(src))).html;
    expect(tags(host)).toEqual(["h1", "h6", "h2", "h1"]);
  });

  it("draws Infinity at the nearer end, and NaN as an h1", async () => {
    // A Float slot can reach these: `1.0 / z`, `-1.0 / z` and `z / z` with
    // `z = 0.0` are Infinity, -Infinity and NaN.
    const src = `
slot z : Float = 0.0
tile App = column(heading("a", level=1.0 / z), heading("b", level=-1.0 / z), heading("c", level=z / z))
app P
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const root = await mountSource(src);
    expect(tags(root)).toEqual(["h6", "h1", "h1"]);
    const host = document.createElement("div");
    host.innerHTML = (await renderToString(await loadSource(src))).html;
    expect(tags(host)).toEqual(["h6", "h1", "h1"]);
  });
});
