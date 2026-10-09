import type { AppShape, MountedApp, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";

const spinnerApp = (props: Record<string, unknown> = {}): AppShape =>
  bareApp({ root: () => ({ kind: "spinner", props }) });

function makeOverlayApp(): AppShape {
  const app = bareApp({
    slots: { open: { value: false } },
    reducers: [
      {
        name: "toggle",
        event: { kind: "ui", ev: "click" },
        apply: (live) => ({ slots: { open: !(live.open as boolean) }, emits: [] }),
      },
    ],
  });
  const modal: TileNode = { kind: "card", props: {}, children: [{ kind: "text", text: "Modal" }] };
  app.root = () => ({
    kind: "overlay",
    props: { align: "top" },
    children: [
      {
        kind: "column",
        props: {},
        children: [
          { kind: "heading", text: "Base" },
          {
            kind: "button",
            text: "toggle",
            props: { onClick: () => (app as MountedApp)._dispatch("toggle", {}) },
          },
        ],
      },
      ...(app.live?.open ? [modal] : []),
    ],
  });
  return app;
}

describe("spinner builtin", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
    document.getElementById("kumiki-animations")?.remove();
  });
  afterEach(() => {
    root.remove();
  });

  const spinner = (): HTMLElement | null =>
    root.querySelector<HTMLElement>('[data-kumiki-tile="spinner"]');

  it("renders an accessible ring element, not placeholder text", () => {
    mount(spinnerApp(), root);
    expect(spinner()?.textContent).toBe("");
    expect(spinner()?.getAttribute("role")).toBe("status");
    expect(spinner()?.getAttribute("aria-label")).toBe("Loading");
  });

  it("injects kumiki-spin keyframes, the spinner rule, and reduced-motion handling", () => {
    mount(spinnerApp(), root);
    const css = document.getElementById("kumiki-animations")?.textContent ?? "";
    expect(css).toContain("@keyframes kumiki-spin");
    expect(css).toContain('[data-kumiki-tile="spinner"]');
    expect(css).toMatch(/prefers-reduced-motion[^}]*\{[^}]*spinner/s);
  });

  it.each([
    [{ size: "lg" }, "1.5rem"],
    [{ size: "sm" }, "0.75rem"],
    [{}, ""],
  ])("maps the size prop %j to font-size %j", (props, fontSize) => {
    mount(spinnerApp(props), root);
    expect(spinner()?.style.fontSize).toBe(fontSize);
  });
});

describe("overlay builtin", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = freshRoot();
  });
  afterEach(() => {
    root.remove();
  });

  const toggle = (): void => {
    Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent === "toggle")
      ?.click();
  };
  const overlay = (): HTMLElement | null =>
    root.querySelector<HTMLElement>('[data-kumiki-tile="overlay"]');
  const layer = (): HTMLElement | null =>
    root.querySelector<HTMLElement>('[data-kumiki-tile="overlay-layer"]');

  it("keeps the base in flow and positions the overlay layer by align while it is shown", () => {
    mount(makeOverlayApp(), root);
    expect(overlay()?.style.position).toBe("relative");
    expect(overlay()?.textContent).toContain("Base");
    expect(layer()).toBeNull();

    toggle();
    expect(layer()?.style.position).toBe("absolute");
    expect(layer()?.style.alignItems).toBe("flex-start");
    expect(layer()?.style.justifyContent).toBe("center");
    expect(layer()?.textContent).toContain("Modal");
    expect(overlay()?.textContent).toContain("Base");

    toggle();
    expect(layer()).toBeNull();
    expect(overlay()?.textContent).toContain("Base");
  });
});
