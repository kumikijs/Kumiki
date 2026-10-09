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
