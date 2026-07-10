import type { AppShape } from "@kumikijs/runtime";
import { defineKumikiElement, mount, resolveApp } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Multi-mount isolation: several Kumiki apps on one page must not cross-wire.
// App resolution is keyed off the mount root (`data-kumiki-root` + WeakMap),
// so DOM-event-driven paths (bind write-back, link nav, icon lookup) land on
// the app that owns the tree the event fired in — not on whichever app
// happened to mount last.

type AppLive = AppShape & {
  _setSlot?: (name: string, value: unknown) => void;
};

// An app whose UI is a bound input plus a mirror of the slot value. Typing
// into the input exercises the tiles-input write-back path — the exact route
// that used to resolve the app through the shared global.
function makeBindApp(): AppShape {
  const app: AppShape = {
    slots: { text: { value: "" } },
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    root: () => ({
      kind: "column",
      children: [
        { kind: "input", bind: "text", value: String(app.live?.text ?? "") },
        { kind: "text", text: `Text: ${app.live?.text ?? ""}` },
      ],
    }),
  };
  return app;
}

// Both icon apps declare the SAME theme name: the theme-reapply cache then
// skips rebinding on re-render, which is exactly the state where the old
// global-based icon lookup read the wrong app.
function makeIconApp(iconPath: string): AppShape {
  const app: AppShape = {
    slots: { n: { value: 0 } },
    caps: [],
    effects: {},
    init: [],
    reducers: [],
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
  };
  return app;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let tagCounter = 0;
const freshTag = (): string => `kumiki-mm-${++tagCounter}`;

describe("multi-mount isolation (WeakMap app registry)", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    host.remove();
  });

  const freshRoot = (): HTMLElement => {
    const el = document.createElement("div");
    host.appendChild(el);
    return el;
  };

  it("registers the mount root and resolves apps from inner elements (T1)", () => {
    const app = makeBindApp();
    const root = freshRoot();
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

  it("routes bind write-back to the app owning the tree, not the last mount (T2)", () => {
    const app1 = makeBindApp();
    const app2 = makeBindApp();
    const root1 = freshRoot();
    const root2 = freshRoot();
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
    const tag = freshTag();
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
    const tag = freshTag();
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

  it("resolves icons per app on re-render, even after another app mounts (T5)", () => {
    const app1 = makeIconApp("M1 1 L2 2");
    const app2 = makeIconApp("M9 9 L8 8");
    const root1 = freshRoot();
    const root2 = freshRoot();
    mount(app1, root1);
    mount(app2, root2);

    // Re-render app1 AFTER app2 mounted — icon lookup must still hit app1.
    (app1 as AppLive)._setSlot?.("n", 1);

    const d1 = root1.querySelector("path")?.getAttribute("d");
    const d2 = root2.querySelector("path")?.getAttribute("d");
    expect(d1).toBe("M1 1 L2 2");
    expect(d2).toBe("M9 9 L8 8");
  });
});
