// A route entry's factory takes the runtime's outlet fill, so a parent that
// declares `sub-routes` can build its child inside its own `error-boundary`
// (lifecycle.md §7.3, #363). Every test in packages/tests compiles a `.kumiki`,
// so only the codegen-shaped factory is ever exercised there. This file hands
// `mount` route entries built by hand — the shape a host, or a runtime bundle
// from before the fill existed, would produce — and pins what the contract
// promises them: a factory that calls the fill gets its child inside; one that
// ignores it still gets its child, filled after the fact; a panic raised while
// building a named entry is attributed to that name; and a panic the runtime
// did not build cannot turn the attribution into a second throw.
//
// The fill is never invoked by hand: `mount` picks the tree through
// `pickRootTile`, which is the one caller, so this drives the real path.

import type { AppShape, OutletFill, RouteEntry, TileNode } from "@kumikijs/runtime";
import { KumikiPanic, mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const text = (t: string): TileNode => ({ kind: "text", text: t, props: {} });
const outlet = (): TileNode => ({ kind: "route-outlet", children: [], props: {} });

/** An app whose only route is a `/shell/*` parent with one `/shell/a` child. */
function shellApp(parent: RouteEntry["tile"], child: RouteEntry): AppShape {
  return {
    slots: {},
    caps: [],
    effects: {},
    init: [],
    reducers: [],
    routes: [
      { pattern: "/shell/*", name: "Shell", tile: parent, subRoutes: [child] },
      { pattern: "/404", name: "NotFound", tile: () => text("nf") },
    ],
    root: () => text(""),
  };
}

describe("a hand-built route entry and the outlet fill", () => {
  let host: HTMLElement | undefined;
  let disposeFn: (() => void) | undefined;
  afterEach(() => {
    disposeFn?.();
    disposeFn = undefined;
    host?.remove();
    host = undefined;
    vi.restoreAllMocks();
  });

  const mountAt = (app: AppShape, path: string): HTMLElement => {
    host = document.createElement("div");
    document.body.appendChild(host);
    disposeFn = mount(app, host, { router: "memory", initialPath: path }).dispose;
    return host;
  };

  it("builds the child inside a parent that calls the fill around its tree", () => {
    // The parent's own try / catch is what makes the fill worth calling: a
    // child that panics is caught there and the parent decides what shows.
    const parent = (fill?: OutletFill): TileNode => {
      try {
        return (fill as OutletFill)({
          kind: "column",
          children: [text("frame"), outlet()],
          props: {},
        });
      } catch (e) {
        return text(`shell caught ${(e as Error).message}`);
      }
    };
    const child: RouteEntry = {
      pattern: "/shell/a",
      name: "Boom",
      tile: () => {
        throw new KumikiPanic("boom");
      },
    };
    const root = mountAt(shellApp(parent, child), "/shell/a");
    expect(root.textContent).toBe("shell caught boom");
  });

  it("fills the outlet of a parent that declares no parameter, after it returns", () => {
    // The pre-fill factory shape. Its child is built outside whatever the
    // parent does around its own tree — exactly the behaviour it was written
    // for — and the outlet is not left empty.
    const parent = (): TileNode => ({
      kind: "column",
      children: [text("frame "), outlet()],
      props: {},
    });
    const child: RouteEntry = { pattern: "/shell/a", tile: () => text("child") };
    const root = mountAt(shellApp(parent, child), "/shell/a");
    expect(root.textContent).toBe("frame child");
    expect(root.querySelector('[data-kumiki-tile="route-outlet"]')?.textContent).toBe("child");
  });

  it("builds no child for a parent that takes the fill but never reached it", () => {
    // The parent's own body panicked and its boundary answered with a fallback
    // that stands in for the whole section, child included. Reaching for the
    // child after the fact would build it outside that boundary — and here
    // the child is a defect, so building it at all would be visible.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const parent = (fill?: OutletFill): TileNode => {
      try {
        throw new KumikiPanic("shell body");
      } catch (e) {
        return text(`caught ${(e as Error).message}${fill === undefined ? " (no fill)" : ""}`);
      }
    };
    const child: RouteEntry = {
      pattern: "/shell/a",
      name: "Child",
      tile: () => {
        throw new Error("built the child after its section was replaced");
      },
    };
    const root = mountAt(shellApp(parent, child), "/shell/a");
    expect(root.textContent).toBe("caught shell body");
    expect(err).not.toHaveBeenCalled();
  });

  it("attributes a child's panic to the child's name, and leaves a named one alone", () => {
    const seen: (string | undefined)[] = [];
    const parent = (fill?: OutletFill): TileNode => {
      try {
        return (fill as OutletFill)(outlet());
      } catch (e) {
        seen.push((e as KumikiPanic).location);
        return text("caught");
      }
    };
    const unnamed: RouteEntry = {
      pattern: "/shell/a",
      name: "Boom",
      tile: () => {
        throw new KumikiPanic("boom");
      },
    };
    mountAt(shellApp(parent, unnamed), "/shell/a");
    disposeFn?.();
    host?.remove();

    const named: RouteEntry = {
      pattern: "/shell/a",
      name: "Boom",
      tile: () => {
        throw new KumikiPanic("boom", 'reducer "risky"');
      },
    };
    mountAt(shellApp(parent, named), "/shell/a");
    expect(seen).toEqual(["Boom", 'reducer "risky"']);
  });

  it("keeps a panic it cannot write to as the panic, not a TypeError", () => {
    // `isPanic` duck-types so a panic from another realm is recognised; that
    // object may be frozen. The attribution is dropped, the panic is not.
    const frozen = Object.freeze({ isKumikiPanic: true, message: "boom", location: undefined });
    let caught: unknown;
    const parent = (fill?: OutletFill): TileNode => {
      try {
        return (fill as OutletFill)(outlet());
      } catch (e) {
        caught = e;
        return text("caught");
      }
    };
    const child: RouteEntry = {
      pattern: "/shell/a",
      name: "Boom",
      tile: () => {
        throw frozen;
      },
    };
    const root = mountAt(shellApp(parent, child), "/shell/a");
    expect(caught).toBe(frozen);
    expect(root.textContent).toBe("caught");
  });

  it("reports a parent whose tree has no outlet for the matched child", () => {
    // `when(cond, route-outlet())` passes E0113 and can be absent at runtime.
    // The child was built for nothing; say so where smoke and scenario listen.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const parent = (fill?: OutletFill): TileNode => (fill as OutletFill)(text("frame"));
    const child: RouteEntry = { pattern: "/shell/a", name: "Child", tile: () => text("child") };
    const root = mountAt(shellApp(parent, child), "/shell/a");
    expect(root.textContent).toBe("frame");
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain(
      'route "/shell/*" matched sub-route "/shell/a" but tile "Shell" rendered no route-outlet',
    );
  });
});
