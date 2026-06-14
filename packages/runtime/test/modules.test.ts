// Issue #71: per-app DCE — the runtime is split into feature modules so
// `kumiki build` can ship only what an app uses. These tests pin the granular
// module API (mountCore + explicit registries) and the back-compat contract of
// the assembled `index.ts` entry (full mount / merged _stdlib / builtinEffects).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppShape, mountCore } from "../src/core.ts";
import { httpFetch } from "../src/effects-http.ts";
import { sessionRead, sessionWrite, storageRead, storageWrite } from "../src/effects-storage.ts";
import { installToast } from "../src/effects-toast.ts";
import { _stdlib, builtinEffects, mount } from "../src/index.ts";
import { routing } from "../src/router.ts";
import { _stdlibCore } from "../src/stdlib.ts";
import { _stdlibTest } from "../src/testkit.ts";
import { collectionTiles } from "../src/tiles-collection.ts";
import { inputTiles } from "../src/tiles-input.ts";
import { layoutTiles } from "../src/tiles-layout.ts";
import { textTiles } from "../src/tiles-text.ts";

function appOf(partial: Partial<AppShape>): AppShape {
  return {
    slots: {},
    caps: [],
    reducers: [],
    effects: {},
    init: [],
    routes: [],
    themes: {},
    themeName: null,
    motions: {},
    ...partial,
  };
}

let target: HTMLElement;
beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
});
afterEach(() => {
  target.remove();
});

describe("mountCore with explicit tile registries", () => {
  it("renders an app using only the registered tile modules", () => {
    const app = appOf({
      root: () => ({
        kind: "column",
        children: [{ kind: "text", text: "Count: 0" }],
      }),
    });
    const handle = mountCore(app, target, { tiles: { ...layoutTiles, ...textTiles } });
    expect(target.textContent).toContain("Count: 0");
    expect(target.querySelector('[data-kumiki-tile="column"]')).not.toBeNull();
    handle.dispose();
  });

  it("dispatches reducers through registered input tiles", () => {
    const app = appOf({
      slots: { n: { value: 0 } },
      reducers: [
        {
          name: "inc",
          selector: { tile: "button" },
          event: { kind: "ui", ev: "click" },
          apply: (slots) => ({ slots: { n: (slots.n as number) + 1 }, emits: [] }),
        },
      ],
    });
    app.root = () => ({
      kind: "column",
      children: [
        { kind: "text", text: `n=${(app.live?.n as number) ?? 0}` },
        {
          kind: "button",
          text: "inc",
          props: {
            onClick: () => {
              (
                app as AppShape & { _dispatch?: (n: string, el: Record<string, unknown>) => void }
              )._dispatch?.("inc", {});
            },
          },
        },
      ],
    });
    const handle = mountCore(app, target, {
      tiles: { ...layoutTiles, ...textTiles, ...inputTiles },
    });
    expect(target.textContent).toContain("n=0");
    (target.querySelector("button") as HTMLButtonElement).click();
    expect(target.textContent).toContain("n=1");
    handle.dispose();
  });

  it("renders a visible fallback (and reports) for an unregistered tile kind", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appOf({
      root: () => ({ kind: "column", children: [{ kind: "text", text: "hello" }] }),
    });
    // text tiles deliberately NOT registered
    const handle = mountCore(app, target, { tiles: { ...layoutTiles } });
    expect(target.textContent).toContain("hello"); // graceful: text content still shows
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("no renderer registered"));
    errors.mockRestore();
    handle.dispose();
  });
});

describe("mountCore routing seam", () => {
  it("works without the router module for a routeless app (no nav effects registered)", () => {
    const app = appOf({
      root: () => ({ kind: "column", children: [{ kind: "text", text: "no routes" }] }),
    });
    const handle = mountCore(app, target, { tiles: { ...layoutTiles, ...textTiles } });
    expect(target.textContent).toContain("no routes");
    expect(app.effects.navigate).toBeUndefined();
    expect(app.effects["navigate-back"]).toBeUndefined();
    handle.dispose();
  });

  it("routes + navigate effect work when the routing module is passed", () => {
    const app = appOf({
      caps: ["nav.push"],
      routes: [
        { pattern: "/", tile: () => ({ kind: "text", text: "home" }) },
        { pattern: "/about", tile: () => ({ kind: "text", text: "about" }) },
      ],
      reducers: [
        {
          name: "go",
          event: { kind: "ui", ev: "click" },
          apply: (slots) => ({
            slots,
            emits: [{ effect: "navigate", args: [{ path: "/about" }] }],
          }),
        },
      ],
    });
    const handle = mountCore(app, target, {
      tiles: { ...layoutTiles, ...textTiles },
      routing,
      router: "memory",
    });
    expect(app.effects.navigate).toBeDefined();
    expect(target.textContent).toContain("home");
    (app as AppShape & { _navigate?: (p: string) => void })._navigate?.("/about");
    expect(target.textContent).toContain("about");
    handle.dispose();
  });
});

describe("builtin effect modules", () => {
  it("installToast registers the toast effect behind notification.show", async () => {
    const app = appOf({ caps: ["notification.show"] });
    const handle = mountCore(app, target, {
      tiles: { ...layoutTiles, ...textTiles },
      builtins: [installToast],
    });
    expect(app.effects.toast).toBeDefined();
    const res = await app.effects.toast?.invoke(
      { text: "hi" },
      { has: () => true, provider: () => undefined },
    );
    expect(res?.kind).toBe("ok");
    handle.dispose();
  });

  it("storage effects round-trip through localStorage as Option values", async () => {
    const w = await storageWrite({ key: "k71", value: { a: 1 } });
    expect(w.kind).toBe("ok");
    const r = await storageRead({ key: "k71" });
    expect(r).toEqual({ kind: "ok", value: { _tag: "Some", _0: { a: 1 } } });
    const miss = await storageRead({ key: "k71-missing" });
    expect(miss).toEqual({ kind: "ok", value: { _tag: "None" } });
  });

  it("session effects round-trip through sessionStorage as Option values (#84)", async () => {
    const w = await sessionWrite({ key: "k84", value: { b: 2 } });
    expect(w.kind).toBe("ok");
    const r = await sessionRead({ key: "k84" });
    expect(r).toEqual({ kind: "ok", value: { _tag: "Some", _0: { b: 2 } } });
    const miss = await sessionRead({ key: "k84-missing" });
    expect(miss).toEqual({ kind: "ok", value: { _tag: "None" } });
  });

  it("session effects are isolated from localStorage (different backing stores)", async () => {
    await storageWrite({ key: "iso", value: "from-local" });
    await sessionWrite({ key: "iso", value: "from-session" });
    expect(await storageRead({ key: "iso" })).toEqual({
      kind: "ok",
      value: { _tag: "Some", _0: "from-local" },
    });
    expect(await sessionRead({ key: "iso" })).toEqual({
      kind: "ok",
      value: { _tag: "Some", _0: "from-session" },
    });
  });

  it("builtinEffects (index) aliases the granular effect exports", () => {
    expect(builtinEffects.storageRead).toBe(storageRead);
    expect(builtinEffects.storageWrite).toBe(storageWrite);
    expect(builtinEffects.sessionRead).toBe(sessionRead);
    expect(builtinEffects.sessionWrite).toBe(sessionWrite);
    expect(builtinEffects.httpFetch).toBe(httpFetch);
  });
});

describe("index.ts back-compat assembly", () => {
  it("full mount renders tiles from every family without explicit registries", () => {
    const app = appOf({
      root: () => ({
        kind: "column",
        children: [
          { kind: "text", text: "full" },
          {
            kind: "table",
            children: [
              {
                kind: "table-body",
                children: [
                  {
                    kind: "table-row",
                    children: [{ kind: "table-cell", children: [{ kind: "text", text: "cell" }] }],
                  },
                ],
              },
            ],
          },
          { kind: "modal", open: true, children: [{ kind: "text", text: "in-modal" }] },
        ],
      }),
    });
    const handle = mount(app, target);
    expect(target.querySelector("table")).not.toBeNull();
    expect(target.textContent).toContain("cell");
    expect(target.textContent).toContain("in-modal");
    expect(app.effects.navigate).toBeDefined(); // full mount wires routing by default
    expect(app.effects.toast).toBeDefined();
    handle.dispose();
  });

  it("merged _stdlib carries both prod and test-harness helpers", () => {
    expect(_stdlib.listHead).toBe(_stdlibCore.listHead);
    expect(_stdlib.runReducerTest).toBe(_stdlibTest.runReducerTest);
    expect(typeof _stdlib.runReducerTestFlow).toBe("function");
    expect(typeof _stdlib.wild).toBe("function");
    // prod stdlib stays free of the test harness
    expect((_stdlibCore as Record<string, unknown>).runReducerTest).toBeUndefined();
  });

  it("collectionTiles cover the table family; layout stays table-free", () => {
    expect(Object.keys(collectionTiles)).toEqual(
      expect.arrayContaining(["list", "list-item", "table", "table-row", "table-cell"]),
    );
    expect(layoutTiles).not.toHaveProperty("table");
    expect(layoutTiles).not.toHaveProperty("modal");
  });
});
