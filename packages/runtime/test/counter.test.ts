import type { AppShape, MountedApp, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

function makeCounterApp(): AppShape {
  const click = (name: string, apply: ReducerSpec["apply"]): ReducerSpec => ({
    name,
    event: { kind: "ui", ev: "click" },
    apply,
  });
  const app = bareApp({
    slots: {
      count: { value: 0, refine: (v: unknown) => typeof v === "number" && v >= 0 && v <= 999 },
    },
    reducers: [
      click("inc", (live) => ({ slots: { count: (live.count as number) + 1 }, emits: [] })),
      click("dec", (live) => ({ slots: { count: (live.count as number) - 1 }, emits: [] })),
      click("reset", () => ({ slots: { count: 0 }, emits: [] })),
    ],
  });
  const button = (text: string, reducer: string): TileNode => ({
    kind: "button",
    text,
    props: { onClick: () => (app as MountedApp)._dispatch(reducer, {}) },
  });
  app.root = () => ({
    kind: "column",
    children: [
      { kind: "heading", text: `Count: ${app.live?.count ?? 0}` },
      {
        kind: "row",
        children: [button("-", "dec"), button("reset", "reset"), button("+", "inc")],
        props: { gap: "sm" },
      },
    ],
  });
  return app;
}

describe("a mounted counter", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
  });

  const heading = (): string | null | undefined => root.querySelector("h1")?.textContent;
  const press = (text: string, times = 1): void => {
    const button = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text);
    for (let i = 0; i < times; i++) button?.click();
  };

  it("renders the initial state and its three buttons", () => {
    mount(makeCounterApp(), root);
    expect(heading()).toBe("Count: 0");
    expect(Array.from(root.querySelectorAll("button"), (b) => b.textContent)).toEqual([
      "-",
      "reset",
      "+",
    ]);
  });

  it("re-renders after each click, and resets to 0", () => {
    mount(makeCounterApp(), root);
    press("+");
    expect(heading()).toBe("Count: 1");
    press("+", 2);
    expect(heading()).toBe("Count: 3");
    press("reset");
    expect(heading()).toBe("Count: 0");
  });

  it.each([
    ["below the floor", "-", 1, 0],
    ["past the ceiling of 999", "+", 1001, 999],
  ])("refuses a write %s", (_, button, clicks, held) => {
    const app = makeCounterApp();
    mount(app, root);
    press(button, clicks);
    expect((app as MountedApp).live.count).toBe(held);
    expect(heading()).toBe(`Count: ${held}`);
  });
});
