import type { AppShape, MountedApp } from "@kumikijs/runtime";
import { defineKumikiElement, mount, resolveApp } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareApp } from "./helpers/app.ts";
import { freshRoot, freshTag } from "./helpers/dom.ts";

function makeBindApp(): AppShape {
  const app: AppShape = bareApp({
    slots: { text: { value: "" } },
    root: () => ({
      kind: "column",
      children: [
        { kind: "input", bind: "text", value: String(app.live?.text ?? "") },
        { kind: "text", text: `Text: ${app.live?.text ?? ""}` },
      ],
    }),
  });
  return app;
}

function makeIconApp(iconPath: string): AppShape {
  const app: AppShape = bareApp({
    slots: { n: { value: 0 } },
    icons: { star: iconPath },
    themes: { plain: {} },
    themeName: "plain",
    root: () => ({
      kind: "column",
      children: [
        { kind: "icon", name: "star" },
        { kind: "text", text: `n: ${app.live?.n ?? 0}` },
      ],
    }),
  });
  return app;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("multi-mount isolation (WeakMap app registry)", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = freshRoot();
  });
  afterEach(() => {
    host.remove();
  });

  it("registers the mount root and resolves apps from inner elements", () => {
    const app = makeBindApp();
    const root = freshRoot(host);
    const handle = mount(app, root);

    expect(root.hasAttribute("data-kumiki-root")).toBe(true);
    const input = root.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(resolveApp(input)).toBe(app);
    expect(resolveApp(root)).toBe(app);

    handle.dispose();
    expect(root.hasAttribute("data-kumiki-root")).toBe(false);
    expect(resolveApp(root)).toBeUndefined();
  });

  it("routes bind write-back to the app owning the tree, not the last mount", () => {
    const app1 = makeBindApp();
    const app2 = makeBindApp();
    const root1 = freshRoot(host);
    const root2 = freshRoot(host);
    mount(app1, root1);
    mount(app2, root2); // last mount — must NOT capture app1's events

    typeInto(root1.querySelector("input") as HTMLInputElement, "alpha");
    expect(app1.live?.text).toBe("alpha");
    expect(app2.live?.text).toBe("");

    typeInto(root2.querySelector("input") as HTMLInputElement, "beta");
    expect(app1.live?.text).toBe("alpha");
    expect(app2.live?.text).toBe("beta");
  });

  it("keeps two light-DOM custom elements independent under real input events (T3, shadow:false)", () => {
    const tag = freshTag("kumiki-mm");
    defineKumikiElement(tag, makeBindApp, { shadow: false });
    type SlotEl = HTMLElement & { getSlot(n: string): unknown };
    const el1 = document.createElement(tag) as SlotEl;
    const el2 = document.createElement(tag) as SlotEl;
    host.appendChild(el1);
    host.appendChild(el2);

    typeInto(el1.querySelector("input") as HTMLInputElement, "first");
    expect(el1.getSlot("text")).toBe("first");
    expect(el2.getSlot("text")).toBe("");
    expect(el1.textContent ?? "").toContain("Text: first");
    expect(el2.textContent ?? "").toContain("Text: ");

    typeInto(el2.querySelector("input") as HTMLInputElement, "second");
    expect(el1.getSlot("text")).toBe("first");
    expect(el2.getSlot("text")).toBe("second");
  });

  it("keeps two shadow-DOM custom elements independent under real input events (T4, shadow:true)", () => {
    const tag = freshTag("kumiki-mm");
    defineKumikiElement(tag, makeBindApp, { shadow: true });
    type SlotEl = HTMLElement & { getSlot(n: string): unknown };
    const el1 = document.createElement(tag) as SlotEl;
    const el2 = document.createElement(tag) as SlotEl;
    host.appendChild(el1);
    host.appendChild(el2);

    typeInto(el1.shadowRoot?.querySelector("input") as HTMLInputElement, "first");
    expect(el1.getSlot("text")).toBe("first");
    expect(el2.getSlot("text")).toBe("");

    typeInto(el2.shadowRoot?.querySelector("input") as HTMLInputElement, "second");
    expect(el1.getSlot("text")).toBe("first");
    expect(el2.getSlot("text")).toBe("second");
  });

  it("drops real events on a detached tree after dispose instead of misdelivering", () => {
    const app1 = makeBindApp();
    const app2 = makeBindApp();
    const root1 = freshRoot(host);
    const root2 = freshRoot(host);
    const handle1 = mount(app1, root1);
    mount(app2, root2);

    const input1 = root1.querySelector("input") as HTMLInputElement;
    handle1.dispose(); // detaches root1's tree; input1 keeps its listener

    typeInto(input1, "ghost");
    // Neither the disposed app nor the still-live one may receive the event —
    // a "resolve to the last mount" fallback would revive the cross-wiring.
    expect(app1.live?.text).toBe("");
    expect(app2.live?.text).toBe("");
  });

  it("restores the rendering context across a nested synchronous mount", () => {
    const inner = makeIconApp("M9 9 L8 8");
    const innerHost = freshRoot(host);
    let innerMounted = false;
    const outer: AppShape = bareApp({
      slots: { n: { value: 0 } },
      icons: { star: "M1 1 L2 2" },
      themes: { plain: {} },
      themeName: "plain",
      root: () => {
        if (!innerMounted) {
          innerMounted = true;
          mount(inner, innerHost);
        }
        return {
          kind: "column",
          children: [
            { kind: "icon", name: "star" },
            { kind: "text", text: `n: ${outer.live?.n ?? 0}` },
          ],
        };
      },
    });
    const outerRoot = freshRoot(host);
    mount(outer, outerRoot);

    expect(outerRoot.querySelector("path")?.getAttribute("d")).toBe("M1 1 L2 2");
    expect(innerHost.querySelector("path")?.getAttribute("d")).toBe("M9 9 L8 8");
    const innerEl = innerHost.querySelector('[data-kumiki-tile="icon"]') as Element;
    expect(resolveApp(innerEl)).toBe(inner);
    expect(resolveApp(outerRoot.querySelector('[data-kumiki-tile="icon"]') as Element)).toBe(outer);
  });

  it("resolves icons per app on re-render, even after another app mounts", () => {
    const app1 = makeIconApp("M1 1 L2 2");
    const app2 = makeIconApp("M9 9 L8 8");
    const root1 = freshRoot(host);
    const root2 = freshRoot(host);
    mount(app1, root1);
    mount(app2, root2);

    // Re-render app1 after app2 mounted: icon lookup must still hit app1.
    (app1 as MountedApp)._setSlot("n", 1);

    const d1 = root1.querySelector("path")?.getAttribute("d");
    const d2 = root2.querySelector("path")?.getAttribute("d");
    expect(d1).toBe("M1 1 L2 2");
    expect(d2).toBe("M9 9 L8 8");
  });

  it("resolves both roots of one shape to that shape, and survives one being dropped", () => {
    const app = makeBindApp();
    const root1 = freshRoot(host);
    const root2 = freshRoot(host);
    const first = mount(app, root1);
    mount(app, root2);

    expect(resolveApp(root1.querySelector("input") as Element)).toBe(app);
    expect(resolveApp(root2.querySelector("input") as Element)).toBe(app);

    typeInto(root1.querySelector("input") as HTMLInputElement, "shared");
    expect(app.live?.text).toBe("shared");
    expect(root2.textContent ?? "").toContain("Text: shared");

    first.dispose();
    expect(root1.hasAttribute("data-kumiki-root")).toBe(false);
    expect(resolveApp(root2.querySelector("input") as Element)).toBe(app);
  });
});
