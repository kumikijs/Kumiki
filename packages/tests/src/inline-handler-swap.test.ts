import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { button, click, mountApp } from "./helpers/dom.ts";
import { loadApp, loadFactory } from "./helpers/load.ts";

const example = feature("62-conditional-inline-tile-handlers");
const counter = feature("01-slot-and-reducer");

describe("conditional inline tiles that differ only in their handler", () => {
  it("dispatches to the branch that is live, not the one it was created with", async () => {
    const app = await loadApp(example);
    const { root } = mountApp(app);

    click(root, "act");
    expect(app.live?.log).toBe("A");

    click(root, "flip");
    expect(app.live?.mode).toBe(false);

    click(root, "act");
    expect(app.live?.log).toBe("AB");

    click(root, "flip");
    click(root, "act");
    expect(app.live?.log).toBe("ABA");
  });

  it("still reuses the element rather than rebuilding it", async () => {
    const { root } = mountApp(await loadApp(example));

    const before = button(root, "act");
    click(root, "flip");
    // A rebuild here would discard focus and caret on every conditional swap.
    expect(button(root, "act")).toBe(before);

    click(root, "act");
    expect(button(root, "act")).toBe(before);
  });
});

describe("the handler memo is per app instance", () => {
  it("dispatches a click to the instance that owns the clicked tree", async () => {
    const createApp = await loadFactory(counter);
    const a = createApp();
    const b = createApp();
    const rootA = mountApp(a).root;
    const rootB = mountApp(b).root;

    click(rootA, "+1");

    expect(a.live?.count).toBe(1);
    expect(b.live?.count).toBe(0);

    click(rootB, "+1");
    click(rootB, "+1");

    expect(a.live?.count).toBe(1);
    expect(b.live?.count).toBe(2);
  });
});
