import { mount, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { click, freshRoot, tick } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

function appOf(body: string): string {
  return withApp(`slot depth : Int = 2
reducer deeper on=ui.click(DeeperBtn) do= depth := depth + 1
tile DeeperBtn = button(text="Deeper", onClick=deeper)
tile App = column(${body}, DeeperBtn)`);
}

function tags(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("[data-kumiki-tile='heading']")).map((h) =>
    h.tagName.toLowerCase(),
  );
}

async function mountSource(src: string): Promise<HTMLElement> {
  const root = freshRoot();
  const handle = mount(await loadSource(src), root);
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  return root;
}

async function servedTags(src: string): Promise<string[]> {
  const host = document.createElement("div");
  host.innerHTML = (await renderToString(await loadSource(src))).html;
  return tags(host);
}

describe("heading level", () => {
  it.each([
    [
      "renders h1 … h6",
      appOf(
        'heading("One"), heading(level=2, "Two"), heading("Three", level=3), heading("Six", level=6)',
      ),
      ["h1", "h2", "h3", "h6"],
    ],
    [
      "pulls a level outside 1-6 to the nearer end, and drops a fraction",
      appOf(
        'heading("a", level=0), heading("b", level=9), heading("c", level=2.7), heading("d", level=-3)',
      ),
      ["h1", "h6", "h2", "h1"],
    ],
    [
      // `1.0 / z`, `-1.0 / z` and `z / z` with `z = 0.0` are Infinity, -Infinity and NaN.
      "draws Infinity at the nearer end, and NaN as an h1",
      withApp(`slot z : Float = 0.0
tile App = column(heading("a", level=1.0 / z), heading("b", level=-1.0 / z), heading("c", level=z / z))`),
      ["h6", "h1", "h1"],
    ],
  ])("%s, on mount and from renderToString alike", async (_what, src, expected) => {
    expect(tags(await mountSource(src))).toEqual(expected);
    expect(await servedTags(src)).toEqual(expected);
  });

  it("re-creates the element when a slot-driven level changes", async () => {
    const root = await mountSource(appOf('heading("Moving", level=depth)'));
    expect(tags(root)).toEqual(["h2"]);
    click(root, "Deeper");
    await tick(0);
    expect(tags(root)).toEqual(["h3"]);
    expect(root.textContent).toContain("Moving");
  });
});
