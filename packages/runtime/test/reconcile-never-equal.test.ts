import type { RuntimeDiagnostic, TileNode, TilePatchers, TileRenderers } from "@kumikijs/runtime";
import { describeDiagnostic, mount, mountCore } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appOf } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { freshRoot } from "./helpers/dom.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
});

/** A host renderer that ignores its node: these cases are about the verdict, not paint. */
const hostCard = (): HTMLElement => document.createElement("div");

const hostTiles = { card: hostCard } as TileRenderers;

/** Registered so an unequal decision is patched rather than rebuilt. */
const inPlaceCardPatch = { card: () => undefined } as TilePatchers;

const card = (fields: Record<string, unknown>): TileNode =>
  ({ kind: "card", ...fields }) as unknown as TileNode;

const neverEqual = (seen: RuntimeDiagnostic[]) => seen.filter((d) => d.kind === "never-equal-prop");

const fallbackReasons = (seen: RuntimeDiagnostic[]) =>
  seen.filter((d) => d.kind === "reconcile-fallback").map((d) => d.reason);

/** Mounts `tree` through `mount`, re-renders once, and returns the diagnostics. */
function mountedRun(tree: () => TileNode): RuntimeDiagnostic[] {
  const seen: RuntimeDiagnostic[] = [];
  const app = appOf(tree);
  const { dispose } = mount(app, root, { tiles: hostTiles, onDiagnostic: (d) => seen.push(d) });
  app._rerender?.();
  dispose();
  return seen;
}

/** Mounts `tree` with `card` as the only host kind, re-renders once, and returns the diagnostics. */
function hostCardRun(tree: () => TileNode, patchers: TilePatchers): RuntimeDiagnostic[] {
  const seen: RuntimeDiagnostic[] = [];
  const app = appOf(tree);
  const { dispose } = mountCore(app, root, {
    tiles: hostTiles,
    tilePatchers: patchers,
    hostTileKinds: ["card"],
    onDiagnostic: (d) => seen.push(d),
  });
  // A missing seam would re-render nothing and turn every case green.
  const rerender = app._rerender;
  if (!rerender) throw new Error("mount did not attach `_rerender` — the harness cannot re-render");
  rerender();
  dispose();
  return seen;
}

describe("a handler rebuilt on every render", () => {
  it("is reported on a host tile, with the field and the cause", () => {
    let generation = 0;
    const seen = mountedRun(() => {
      generation++;
      return card({ props: { onClick: () => generation } });
    });

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({
        tileKind: "card",
        id: "card",
        field: "props.onClick",
        cause: "function-identity",
      }),
    ]);
  });

  it("is caught on the node itself, not only under props", () => {
    const seen = mountedRun(() => card({ onSelect: () => undefined }));

    expect(seen).toContainEqual(
      expect.objectContaining({
        kind: "never-equal-prop",
        field: "onSelect",
        cause: "function-identity",
      }),
    );
  });

  it.each<[string, () => TileNode]>([
    ["nested deeper than props", () => card({ props: { handlers: { onClick: () => undefined } } })],
    [
      "on a built-in tile",
      () => ({
        kind: "column",
        children: [{ kind: "button", text: "go", props: { onClick: () => undefined } }],
      }),
    ],
    [
      "on a built-in tile beside a host tile",
      () => ({
        kind: "column",
        children: [
          { kind: "button", text: "go", props: { onClick: () => undefined } },
          card({ children: [] }),
        ],
      }),
    ],
  ])("is not chased %s", (_label, tree) => {
    expect(neverEqual(mountedRun(tree))).toEqual([]);
  });

  it("is spelled out as the churn it causes", () => {
    const seen = mountedRun(() => card({ props: { _tile: "Panel", onClick: () => undefined } }));

    expect(seen).toHaveLength(1);
    expect(describeDiagnostic(seen[0] as RuntimeDiagnostic)).toBe(
      "Panel (card)'s props.onClick holds a function whose identity changed (a handler rebuilt per render never compares equal; memoising it fixes that) — this tile re-applies its props on every render",
    );
  });
});

describe("a value that can never compare equal", () => {
  it("is named before the rebuild it caused", () => {
    const seen = hostCardRun(() => card({ props: { at: new Date(0) } }), {});

    // The field is what the host can fix; the rebuild is what it cost.
    expect(seen.map((d) => d.kind)).toEqual(["never-equal-prop", "reconcile-fallback"]);
    expect(seen[0]).toMatchObject({
      tileKind: "card",
      id: "card",
      field: "props.at",
      cause: "non-plain-object",
    });
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  class Span {
    constructor(
      readonly from: number,
      readonly to: number,
    ) {}
  }

  it.each<[string, () => Record<string, unknown>, string, string]>([
    [
      "a fresh Date, though a patcher hides the churn",
      () => ({ props: { at: new Date(0) } }),
      "props.at",
      "non-plain-object",
    ],
    [
      "NaN, unequal to itself by design",
      () => ({ props: { total: Number.NaN } }),
      "props.total",
      "nan",
    ],
    [
      "a class instance",
      () => ({ props: { range: new Span(0, 1) } }),
      "props.range",
      "non-plain-object",
    ],
    ["a Map", () => ({ props: { value: new Map([["k", 1]]) } }), "props.value", "non-plain-object"],
    ["a RegExp", () => ({ props: { value: /x/g } }), "props.value", "non-plain-object"],
    [
      "a DOM node",
      () => ({ props: { value: document.createElement("span") } }),
      "props.value",
      "non-plain-object",
    ],
    ["an exotic on the node itself", () => ({ at: new Date(0) }), "at", "non-plain-object"],
  ])("names %s", (_label, fields, field, cause) => {
    const seen = hostCardRun(() => card(fields()), inPlaceCardPatch);

    expect(neverEqual(seen)).toEqual([expect.objectContaining({ field, cause })]);
  });

  it.each<[string, () => Record<string, unknown>]>([
    ["buried in an array", () => ({ props: { tags: [new Date(0)] } })],
    ["nested deeper than props", () => ({ props: { meta: { at: new Date(0) } } })],
  ])("is not chased when %s", (_label, fields) => {
    const seen = hostCardRun(() => card(fields()), {});

    expect(neverEqual(seen)).toEqual([]);
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("is not reported for the same instance handed over twice", () => {
    const at = new Date(0);
    let renders = 0;
    const seen = hostCardRun(() => {
      renders++;
      return card({ props: { at, label: `render ${renders}` } });
    }, {});

    expect(neverEqual(seen)).toEqual([]);
    // The unequal branch really ran, or this case proves nothing.
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("stays quiet while only one side is exotic", () => {
    let exotic = false;
    const seen: RuntimeDiagnostic[] = [];
    const app = appOf(() => card({ props: { at: exotic ? new Date(0) : { ms: 0 } } }));
    const { dispose } = mountCore(app, root, {
      tiles: hostTiles,
      tilePatchers: inPlaceCardPatch,
      hostTileKinds: ["card"],
      onDiagnostic: (d) => seen.push(d),
    });

    exotic = true;
    app._rerender?.();
    expect(neverEqual(seen)).toEqual([]);

    app._rerender?.();
    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "props.at", cause: "non-plain-object" }),
    ]);
    dispose();
  });

  it("is not reported on a built-in tile", () => {
    let at = new Date(0);
    const seen: RuntimeDiagnostic[] = [];
    const app = appOf(
      () =>
        ({
          kind: "column",
          children: [{ kind: "heading", text: "title", at }, card({ children: [] })],
        }) as unknown as TileNode,
    );
    const { dispose } = mount(app, root, { tiles: hostTiles, onDiagnostic: (d) => seen.push(d) });

    at = new Date(0);
    app._rerender?.();

    expect(neverEqual(seen)).toEqual([]);
    dispose();
  });

  it("is described in words a host can act on", () => {
    const seen = hostCardRun(
      () => card({ props: { _tile: "Panel", at: new Date(0), total: Number.NaN } }),
      inPlaceCardPatch,
    );
    const [exotic, nan] = neverEqual(seen);

    expect(describeDiagnostic(exotic as RuntimeDiagnostic)).toBe(
      "Panel (card)'s props.at holds a non-plain object (Date / Map / Set / class instance), which never compares equal to a freshly built one — this tile re-applies its props on every render",
    );
    expect(describeDiagnostic(nan as RuntimeDiagnostic)).toBe(
      "Panel (card)'s props.total is NaN, which never compares equal to itself — this tile re-applies its props on every render",
    );
  });

  it("changes nothing about the render when no sink is registered", () => {
    let patched = 0;
    const app = appOf(() => card({ props: { at: new Date(0) } }));
    const { dispose } = mountCore(app, root, {
      tiles: hostTiles,
      tilePatchers: { card: () => void patched++ } as TilePatchers,
      hostTileKinds: ["card"],
    });
    const mounted = root.firstElementChild;

    app._rerender?.();

    expect(patched).toBe(1);
    expect(root.firstElementChild).toBe(mounted);
    dispose();
  });
});

describe("the diagnostic scan survives a host value that throws while it reads", () => {
  it("when the props refuse enumeration", () => {
    const errors = captureConsole();
    let enumerated = 0;
    const props = new Proxy(
      { onClick: () => undefined },
      {
        ownKeys() {
          enumerated++;
          throw new Error("host props refuse enumeration");
        },
      },
    );
    let generation = 0;
    const seen: RuntimeDiagnostic[] = [];
    const app = appOf(() => {
      generation++;
      return card({ text: String(generation), props });
    });
    const { dispose } = mount(app, root, { tiles: hostTiles, onDiagnostic: (d) => seen.push(d) });
    const mounted = root.firstElementChild;

    app._rerender?.();

    // The guard is only covered if the trap actually fired.
    expect(enumerated).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(root.firstElementChild).toBe(mounted);
    expect(seen).toEqual([]);
    dispose();
  });

  it("when a value refuses its prototype", () => {
    const errors = captureConsole();
    const hostile = () =>
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("host value refuses its prototype");
          },
        },
      );
    let label = "one";
    const seen: RuntimeDiagnostic[] = [];
    const app = appOf(() => card({ label, props: { value: hostile() } }));
    const { dispose } = mountCore(app, root, {
      tiles: hostTiles,
      tilePatchers: {},
      hostTileKinds: ["card"],
      onDiagnostic: (d) => seen.push(d),
    });

    label = "two";
    app._rerender?.();

    expect(errors).toEqual([]);
    expect(neverEqual(seen)).toEqual([]);
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
    dispose();
  });
});
