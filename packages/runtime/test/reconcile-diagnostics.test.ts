import type {
  AppShape,
  MountedApp,
  RuntimeDiagnostic,
  TileCtx,
  TileNode,
  TilePatchers,
  TileRenderers,
} from "@kumikijs/runtime";
import {
  describeDiagnostic,
  layoutTiles,
  mount,
  mountCore,
  runScenario,
  smoke,
  textTiles,
} from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstChildMappedColumn } from "./fixtures/host-renderers.ts";

/** A bare app whose root tile is produced by `root` on every render pass. */
function appOf(root: () => TileNode): AppShape {
  return { slots: {}, caps: [], effects: {}, init: [], reducers: [], root };
}

function collector(): { sink: (d: RuntimeDiagnostic) => void; seen: RuntimeDiagnostic[] } {
  const seen: RuntimeDiagnostic[] = [];
  return { sink: (d) => seen.push(d), seen };
}

function fallbackReasons(seen: RuntimeDiagnostic[]): string[] {
  return seen.filter((d) => d.kind === "reconcile-fallback").map((d) => d.reason);
}

describe("runtime: reconcile diagnostics", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("reports an unkeyed sibling-list length change", () => {
    let extra = true;
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "heading", text: "title" },
        ...(extra ? [{ kind: "text" as const, text: "detail" }] : []),
      ],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    extra = false;
    app._rerender?.();

    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "child-count-change", oldCount: 2, newCount: 1 }),
    );
    dispose();
  });

  it("survives a sink that throws without disturbing the render", () => {
    let extra = true;
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "heading", text: "outer" },
        {
          kind: "column",
          children: [
            { kind: "text", text: "inner" },
            ...(extra ? [{ kind: "text" as const, text: "detail" }] : []),
          ],
        },
      ],
    }));
    const suppressed: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => suppressed.push(args);
    try {
      const { dispose } = mount(app, root, {
        onDiagnostic: () => {
          throw new Error("host sink is broken");
        },
      });
      const heading = root.querySelector("h1") as HTMLElement;

      extra = false;
      app._rerender?.();

      expect(suppressed).toEqual([]);
      expect(root.querySelector("h1")).toBe(heading);
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  it("reports a same-kind prop change with no patcher registered for the kind", () => {
    let title = "one";
    const app = appOf(() => ({ kind: "heading", text: title }));
    const { sink, seen } = collector();
    const { dispose } = mountCore(app, root, {
      tiles: { ...textTiles },
      tilePatchers: {},
      onDiagnostic: sink,
    });

    title = "two";
    app._rerender?.();

    expect(fallbackReasons(seen)).toContain("no-patcher");
    dispose();
  });

  it("reports a hole in a children list", () => {
    let holed = false;
    const app = appOf(() => ({
      kind: "column",
      children: holed
        ? ([{ kind: "text", text: "a" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a" },
            { kind: "text", text: "b" },
          ],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    holed = true;
    app._rerender?.();

    expect(seen).toContainEqual(expect.objectContaining({ reason: "child-hole", index: 1 }));
    dispose();
  });

  it("reports a child that never passed through the mapping render ctx", () => {
    const detachedColumn = (node: TileNode, _ctx: TileCtx): HTMLElement => {
      const el = document.createElement("div");
      for (const child of (node as { children?: TileNode[] }).children ?? []) {
        const span = document.createElement("span");
        span.textContent = (child as { text?: string }).text ?? "";
        el.appendChild(span);
      }
      return el;
    };
    let label = "a";
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "text", text: label },
        { kind: "text", text: "static" },
      ],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { column: detachedColumn } as TileRenderers,
      onDiagnostic: sink,
    });

    label = "b";
    app._rerender?.();

    // `childKind` names the child whose element went missing, which is what
    // points at the renderer that skipped `ctx.render`.
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "child-unmapped", index: 0, childKind: "text" }),
    );
    dispose();
  });

  function bailBehindSiblingApp(children: () => TileNode[]): AppShape {
    return appOf(() => ({ kind: "column", children: children() }));
  }

  it("reports the same evidence when the bail follows a sibling that would have reconciled", () => {
    let label = "a";
    let holed = false;
    const holeApp = bailBehindSiblingApp(() =>
      holed
        ? ([{ kind: "text", text: label }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: label },
            { kind: "text", text: "b" },
          ],
    );
    const hole = collector();
    const holeMount = mount(holeApp, root, { onDiagnostic: hole.sink });

    label = "a2";
    holed = true;
    holeApp._rerender?.();

    expect(hole.seen).toContainEqual(expect.objectContaining({ reason: "child-hole", index: 1 }));
    holeMount.dispose();

    // Same shape, other bail: a renderer that maps its first child through
    // `ctx.render` and hand-builds the rest.
    let text = "a";
    const unmappedApp = bailBehindSiblingApp(() => [
      { kind: "text", text },
      { kind: "text", text: "hand-built" },
    ]);
    const unmapped = collector();
    const unmappedMount = mount(unmappedApp, root, {
      tiles: { column: firstChildMappedColumn } as TileRenderers,
      onDiagnostic: unmapped.sink,
    });

    text = "a2";
    unmappedApp._rerender?.();

    expect(unmapped.seen).toContainEqual(
      expect.objectContaining({ reason: "child-unmapped", index: 1, childKind: "text" }),
    );
    unmappedMount.dispose();
  });

  it("calls an index that is both a hole and unmapped a hole", () => {
    let holed = false;
    const app = bailBehindSiblingApp(() =>
      holed
        ? ([{ kind: "text", text: "a2" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a" },
            { kind: "text", text: "hand-built" },
          ],
    );
    const { sink, seen } = collector();
    // The renderer leaves index 1 unmapped, so without the hole this render
    // would report `child-unmapped` at that same index — see the case above.
    const { dispose } = mount(app, root, {
      tiles: { column: firstChildMappedColumn } as TileRenderers,
      onDiagnostic: sink,
    });

    holed = true;
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual(["child-hole"]);
    dispose();
  });

  it("says nothing about the siblings a bail no longer applies", () => {
    let label = "a";
    let holed = false;
    const app = bailBehindSiblingApp(() =>
      holed
        ? ([{ kind: "text", text: label }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: label },
            { kind: "text", text: "b" },
          ],
    );
    const { sink, seen } = collector();
    const { dispose } = mountCore(app, root, {
      tiles: { ...textTiles, ...layoutTiles },
      tilePatchers: {},
      onDiagnostic: sink,
    });

    label = "a2";
    holed = true;
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual(["child-hole"]);
    dispose();
  });

  it("says nothing about the siblings an unmapped-child bail no longer applies", () => {
    let label = "a";
    const app = bailBehindSiblingApp(() => [
      { kind: "text", text: label },
      { kind: "text", text: "hand-built" },
    ]);
    const { sink, seen } = collector();
    const { dispose } = mountCore(app, root, {
      tiles: { ...textTiles, ...layoutTiles, column: firstChildMappedColumn },
      tilePatchers: {},
      hostTileKinds: ["column"],
      onDiagnostic: sink,
    });

    label = "a2";
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual(["child-unmapped"]);
    dispose();
  });

  it("says nothing about a churning handler on a sibling a bail no longer applies", () => {
    const hostCard = (node: TileNode, _ctx: TileCtx): HTMLElement => {
      const el = document.createElement("div");
      el.textContent = (node as { text?: string }).text ?? "";
      return el;
    };
    let handler = () => {};
    let holed = false;
    const card = (): TileNode =>
      ({ kind: "card", text: "steady", props: { onPick: handler } }) as unknown as TileNode;
    const app = bailBehindSiblingApp(() =>
      holed
        ? ([card(), undefined] as unknown as TileNode[])
        : [card(), { kind: "text", text: "b" }],
    );
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    handler = () => {};
    holed = true;
    app._rerender?.();

    expect(seen.map((d) => d.kind)).toEqual(["reconcile-fallback"]);
    expect(fallbackReasons(seen)).toEqual(["child-hole"]);
    dispose();
  });

  it("reports a handler the host rebuilds on every render", () => {
    let generation = 0;
    const hostCard = (node: TileNode, _ctx: TileCtx): HTMLElement => {
      const el = document.createElement("div");
      const props = (node as { props?: Record<string, unknown> }).props;
      el.addEventListener("click", props?.onClick as EventListener);
      return el;
    };
    const app = appOf(() => {
      generation++;
      return {
        kind: "card",
        props: { onClick: () => generation },
      } as unknown as TileNode;
    });
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    app._rerender?.();

    const churn = seen.filter((d) => d.kind === "never-equal-prop");
    expect(churn).toHaveLength(1);
    expect(churn[0]).toMatchObject({
      tileKind: "card",
      id: "card",
      field: "props.onClick",
      cause: "function-identity",
    });
    dispose();
  });

  it("catches a handler on the node itself, not only under props", () => {
    const hostCard = (): HTMLElement => document.createElement("div");
    const app = appOf(() => ({ kind: "card", onSelect: () => undefined }) as unknown as TileNode);
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    app._rerender?.();

    expect(seen).toContainEqual(
      expect.objectContaining({
        kind: "never-equal-prop",
        field: "onSelect",
        cause: "function-identity",
      }),
    );
    dispose();
  });

  it("does not chase handlers nested deeper than props", () => {
    const hostCard = (): HTMLElement => document.createElement("div");
    const app = appOf(
      () =>
        ({
          kind: "card",
          props: { handlers: { onClick: () => undefined } },
        }) as unknown as TileNode,
    );
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    app._rerender?.();

    expect(seen.filter((d) => d.kind === "never-equal-prop")).toEqual([]);
    dispose();
  });

  it("stays silent about function identity on built-in tiles", () => {
    const app = appOf(() => ({
      kind: "column",
      children: [{ kind: "button", text: "go", props: { onClick: () => undefined } }],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    app._rerender?.();

    expect(seen.filter((d) => d.kind === "never-equal-prop")).toEqual([]);
    dispose();
  });

  it("scopes the scan to the kinds the host actually registered", () => {
    const hostCard = (): HTMLElement => document.createElement("div");
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "button", text: "go", props: { onClick: () => undefined } },
        { kind: "card", children: [] },
      ],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    app._rerender?.();

    expect(seen.filter((d) => d.kind === "never-equal-prop")).toEqual([]);
    dispose();
  });

  it("survives a host value that throws while the diagnostic scan reads it", () => {
    const hostCard = (): HTMLElement => document.createElement("div");
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
    const app = appOf(() => {
      generation++;
      return { kind: "card", text: String(generation), props } as unknown as TileNode;
    });
    const { sink, seen } = collector();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mount(app, root, {
        tiles: { card: hostCard } as TileRenderers,
        onDiagnostic: sink,
      });
      const card = root.firstElementChild as HTMLElement;

      app._rerender?.();

      // The guard is only covered if the trap actually fired.
      expect(enumerated).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      expect(root.firstElementChild).toBe(card);
      expect(seen).toEqual([]);
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  /** Ignores its node: these cases are about the kernel's verdict, not paint. */
  const hostCard = (): HTMLElement => document.createElement("div");

  /** Registered so the unequal decision is PATCHED rather than rebuilt. */
  const inPlaceCardPatch = { card: () => undefined } as TilePatchers;

  function hostCardRun(tree: () => TileNode, patchers: TilePatchers): RuntimeDiagnostic[] {
    const app = appOf(tree);
    const { sink, seen } = collector();
    const { dispose } = mountCore(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      tilePatchers: patchers,
      hostTileKinds: ["card"],
      onDiagnostic: sink,
    });
    // Never `?.`: a missing seam would re-render nothing and turn every case
    // below green regardless of what the scan does.
    const rerender = app._rerender;
    if (!rerender)
      throw new Error("mount did not attach `_rerender` — the harness cannot re-render");
    rerender();
    dispose();
    return seen;
  }

  function neverEqual(seen: RuntimeDiagnostic[]): RuntimeDiagnostic[] {
    return seen.filter((d) => d.kind === "never-equal-prop");
  }

  it("names the field holding a fresh Date, and the rebuild it caused", () => {
    const seen = hostCardRun(
      () => ({ kind: "card", props: { at: new Date(0) } }) as unknown as TileNode,
      {},
    );

    // Cause before consequence: the field is what the host can fix, the rebuild
    // is what it cost this render.
    expect(seen.map((d) => d.kind)).toEqual(["never-equal-prop", "reconcile-fallback"]);
    expect(seen[0]).toMatchObject({
      tileKind: "card",
      id: "card",
      field: "props.at",
      cause: "non-plain-object",
    });
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("names it when a patcher makes the churn invisible", () => {
    const seen = hostCardRun(
      () => ({ kind: "card", props: { at: new Date(0) } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(seen.map((d) => d.kind)).toEqual(["never-equal-prop"]);
    expect(seen[0]).toMatchObject({ field: "props.at", cause: "non-plain-object" });
  });

  it("names a NaN prop, which is unequal to itself by design", () => {
    const seen = hostCardRun(
      () => ({ kind: "card", props: { total: Number.NaN } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "props.total", cause: "nan" }),
    ]);
  });

  it("names a class instance, not only the built-in exotics", () => {
    class Span {
      constructor(
        readonly from: number,
        readonly to: number,
      ) {}
    }
    const seen = hostCardRun(
      () => ({ kind: "card", props: { range: new Span(0, 1) } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "props.range", cause: "non-plain-object" }),
    ]);
  });

  it("catches an exotic on the node itself, not only under props", () => {
    const seen = hostCardRun(() => ({ kind: "card", at: new Date(0) }) as unknown as TileNode, {});

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "at", cause: "non-plain-object" }),
    ]);
  });

  it("stays quiet while only one side is exotic", () => {
    let exotic = false;
    const app = appOf(
      () =>
        ({
          kind: "card",
          props: { at: exotic ? new Date(0) : { ms: 0 } },
        }) as unknown as TileNode,
    );
    const { sink, seen } = collector();
    const { dispose } = mountCore(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      tilePatchers: inPlaceCardPatch,
      hostTileKinds: ["card"],
      onDiagnostic: sink,
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

  it.each([
    ["a Map", () => new Map([["k", 1]])],
    ["a RegExp", () => /x/g],
    ["a DOM node", () => document.createElement("span")],
  ])("names %s, since the rule is about the prototype and not the type", (_label, make) => {
    const seen = hostCardRun(
      () => ({ kind: "card", props: { value: make() } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "props.value", cause: "non-plain-object" }),
    ]);
  });

  it("says nothing about a tile the parent's bail is about to discard", () => {
    let holed = false;
    const card = (): TileNode =>
      ({ kind: "card", props: { at: new Date(0) } }) as unknown as TileNode;
    const app = bailBehindSiblingApp(() =>
      holed
        ? ([card(), undefined] as unknown as TileNode[])
        : [card(), { kind: "text", text: "b" }],
    );
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    holed = true;
    app._rerender?.();

    expect(seen.map((d) => d.kind)).toEqual(["reconcile-fallback"]);
    expect(fallbackReasons(seen)).toEqual(["child-hole"]);
    dispose();
  });

  it("survives a host value that throws while the unequal scan reads it", () => {
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
    const app = appOf(
      () => ({ kind: "card", label, props: { value: hostile() } }) as unknown as TileNode,
    );
    const { sink, seen } = collector();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mountCore(app, root, {
        tiles: { card: hostCard } as TileRenderers,
        tilePatchers: {},
        hostTileKinds: ["card"],
        onDiagnostic: sink,
      });

      label = "two";
      app._rerender?.();

      expect(errors).toEqual([]);
      expect(neverEqual(seen)).toEqual([]);
      expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  it("stays quiet for an exotic buried in an array", () => {
    const seen = hostCardRun(
      () => ({ kind: "card", props: { tags: [new Date(0)] } }) as unknown as TileNode,
      {},
    );

    expect(neverEqual(seen)).toEqual([]);
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("stays quiet for the same instance handed over twice", () => {
    const at = new Date(0);
    let renders = 0;
    const seen = hostCardRun(() => {
      renders++;
      return { kind: "card", props: { at, label: `render ${renders}` } } as unknown as TileNode;
    }, {});

    expect(neverEqual(seen)).toEqual([]);
    // The unequal branch really did run — otherwise this case proves nothing.
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("does not chase exotics nested deeper than props", () => {
    const seen = hostCardRun(
      () => ({ kind: "card", props: { meta: { at: new Date(0) } } }) as unknown as TileNode,
      {},
    );

    expect(neverEqual(seen)).toEqual([]);
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("stays silent about an exotic prop on a built-in tile", () => {
    let at = new Date(0);
    const app = appOf(
      () =>
        ({
          kind: "column",
          children: [
            { kind: "heading", text: "title", at },
            { kind: "card", children: [] },
          ],
        }) as unknown as TileNode,
    );
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    at = new Date(0);
    app._rerender?.();

    expect(neverEqual(seen)).toEqual([]);
    dispose();
  });

  it("changes nothing about the render when no sink is registered", () => {
    let patched = 0;
    const app = appOf(() => ({ kind: "card", props: { at: new Date(0) } }) as unknown as TileNode);
    const { dispose } = mountCore(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      tilePatchers: {
        card: () => {
          patched++;
        },
      } as TilePatchers,
      hostTileKinds: ["card"],
    });
    const card = root.firstElementChild as HTMLElement;

    app._rerender?.();

    expect(patched).toBe(1);
    expect(root.firstElementChild).toBe(card);
    dispose();
  });

  it("says which value can never be equal, in words a host can act on", () => {
    const seen = hostCardRun(
      () =>
        ({
          kind: "card",
          props: { _tile: "Panel", at: new Date(0), total: Number.NaN },
        }) as unknown as TileNode,
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

  it("names the authored tile and the bind so a report points back at the source", () => {
    let extra = true;
    const app = appOf(() => ({
      kind: "column",
      props: { _tile: "Panel" },
      children: [
        { kind: "input", bind: "note", value: "" },
        ...(extra ? [{ kind: "text" as const, text: "hint" }] : []),
      ],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    extra = false;
    app._rerender?.();

    const d = seen.find((x) => x.kind === "reconcile-fallback");
    expect(d).toMatchObject({ tileKind: "column", tile: "Panel", id: "column" });
    dispose();
  });

  it("reports keyed children the parent renderer wrapped out of reach", () => {
    let order = ["a", "b", "c"];
    const app = appOf(() => ({
      kind: "overlay",
      children: order.map((id) => ({ kind: "text" as const, text: `layer ${id}`, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["c", "a", "b"];
    app._rerender?.();

    // index 1 is the first wrapped child — index 0 is the base layer, which
    // the overlay does place directly.
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "wrapped-children", index: 1, childKind: "text" }),
    );
    dispose();
  });

  it("says the keyed match was declined, not that anything was rebuilt", () => {
    let order = ["a", "b"];
    const app = appOf(() => ({
      kind: "overlay",
      props: { _tile: "Stack" },
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["b", "a"];
    app._rerender?.();

    const d = seen.find(
      (x) => x.kind === "reconcile-fallback" && x.reason === "wrapped-children",
    ) as RuntimeDiagnostic;
    expect(describeDiagnostic(d)).toBe(
      "reconcile could not key-match Stack (overlay)'s children: wrapped-children (children[1], a text, is wrapped by its parent's renderer instead of sitting directly under it, so reorder fell back to positional matching)",
    );
    dispose();
  });

  it("reports a wrapped list that also changed length twice, naming both facts", () => {
    let order = ["a", "b", "c"];
    const app = appOf(() => ({
      kind: "overlay",
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["a", "c"];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual(["wrapped-children", "child-count-change"]);
    dispose();
  });

  it("leaves a keyed child missing from the element map on the panic path", () => {
    const detachedColumn = (node: TileNode): HTMLElement => {
      const el = document.createElement("div");
      for (const child of (node as { children?: TileNode[] }).children ?? []) {
        const span = document.createElement("span");
        span.textContent = (child as { text?: string }).text ?? "";
        el.appendChild(span);
      }
      return el;
    };
    let label = "a";
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "text", text: label, key: "first" },
        { kind: "text", text: "static", key: "second" },
      ],
    }));
    const { sink, seen } = collector();
    // The bailout reports the panic through `console.error`; capture it so the
    // assertion is on the panic itself rather than on incidental test noise.
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mount(app, root, {
        tiles: { column: detachedColumn } as TileRenderers,
        onDiagnostic: sink,
      });

      label = "b";
      app._rerender?.();

      expect(errors.flat().map(String).join(" ")).toContain("has no live element mapping");
      expect(fallbackReasons(seen)).not.toContain("wrapped-children");
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  it("puts a DEPARTING keyed child with no element mapping on that same path", () => {
    let members = ["a", "b"];
    const app = appOf(() => ({
      kind: "column",
      children: members.map((id) => ({
        kind: "text" as const,
        text: id === "b" ? "hand-built" : id,
        key: id,
      })),
    }));
    const { sink, seen } = collector();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mount(app, root, {
        tiles: { column: firstChildMappedColumn } as TileRenderers,
        onDiagnostic: sink,
      });

      members = ["a"];
      app._rerender?.();

      expect(errors.flat().map(String).join(" ")).toContain("has no live element mapping");
      // The gate let it through rather than declining, and no diagnostic stood
      // in for the panic — the two channels this could have gone to instead.
      expect(fallbackReasons(seen)).not.toContain("wrapped-children");
      expect(fallbackReasons(seen)).not.toContain("child-unmapped");
      // What a silent skip leaves behind: the departure's hand-built element is
      // never removed, because the removal it was meant to get was the lookup
      // that failed. The panic's full rebuild is what clears it.
      expect(root.textContent).not.toContain("hand-built");
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  it("answers the missing mapping before it mounts a newcomer", () => {
    let mounted = 0;
    const badge = (): HTMLElement => {
      mounted++;
      return document.createElement("b");
    };
    let members = ["a", "gone"];
    const app = appOf(() => ({
      kind: "column",
      children: members.map((id) =>
        id === "a"
          ? ({ kind: "text", text: id, key: id } as TileNode)
          : // `badge` comes from this mount's host registry, and `TileNode` is
            // the closed set of built-ins — the same reason the registry below
            // is handed over as `TileRenderers`.
            ({ kind: "badge", text: id, key: id } as unknown as TileNode),
      ),
    }));
    const { sink } = collector();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mount(app, root, {
        tiles: { column: firstChildMappedColumn, badge } as TileRenderers,
        onDiagnostic: sink,
      });
      expect(mounted).toBe(0);

      members = ["a", "new"];
      app._rerender?.();

      expect(errors.flat().map(String).join(" ")).toContain("has no live element mapping");
      expect(mounted).toBe(0);
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  it("does not let a later reason to decline swallow the missing mapping", () => {
    let members = ["a", "hand-built"];
    const app = appOf(() => ({
      kind: "overlay",
      children: members.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mount(app, root, {
        tiles: { overlay: firstChildMappedColumn } as TileRenderers,
        onDiagnostic: sink,
      });

      members = ["a", "hand-built", "newcomer"];
      app._rerender?.();

      expect(errors.flat().map(String).join(" ")).toContain("has no live element mapping");
      expect(fallbackReasons(seen)).not.toContain("unplaceable-insert");
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  it("stays quiet for a one-child overlay, which wraps nothing", () => {
    let text = "one";
    const app = appOf(() => ({
      kind: "overlay",
      children: [{ kind: "text" as const, text, key: "solo" }],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    text = "two";
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    dispose();
  });

  it("stays quiet when a list grows from empty", () => {
    let order: string[] = [];
    const app = appOf(() => ({
      kind: "column",
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["a", "b", "c"];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    dispose();
  });

  it("stays quiet when a list is cleared to empty", () => {
    let order = ["a", "b", "c"];
    const app = appOf(() => ({
      kind: "column",
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = [];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    dispose();
  });

  it("stays quiet for a wrapping parent whose list grows from empty", () => {
    let order: string[] = [];
    const app = appOf(() => ({
      kind: "overlay",
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["a", "b", "c"];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    dispose();
  });

  it("reports a newcomer the parent renderer has nowhere to put", () => {
    let order = ["solo"];
    const app = appOf(() => ({
      kind: "overlay",
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["solo", "b"];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual(["unplaceable-insert", "child-count-change"]);
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "unplaceable-insert", index: 1, childKind: "text" }),
    );
    dispose();
  });

  it.each([
    "modal",
    "drawer",
    "popover",
  ] as const)("reports a %s's growth from the measurement, not from the declaration", (kind) => {
    let order = ["a"];
    const app = appOf(() => ({
      kind,
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["a", "b"];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual(["wrapped-children", "child-count-change"]);
    dispose();
  });

  it("stays quiet for an empty slot in a list that grows from empty", () => {
    let filled = false;
    const app = appOf(() => ({
      kind: "column",
      children: filled
        ? ([
            { kind: "text" as const, text: "a", key: "a" },
            null,
            { kind: "text" as const, text: "b", key: "b" },
          ] as unknown as TileNode[])
        : [],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });
    const column = root.firstElementChild as HTMLElement;

    filled = true;
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    expect(root.firstElementChild).toBe(column);
    expect(Array.from(column.children).map((e) => e.textContent)).toEqual(["a", "b"]);
    dispose();
  });

  it("says the newcomer could not be placed, not that the child was wrapped", () => {
    let order = ["solo"];
    const app = appOf(() => ({
      kind: "overlay",
      props: { _tile: "Stack" },
      children: order.map((id) => ({ kind: "text" as const, text: id, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["solo", "b"];
    app._rerender?.();

    const d = seen.find(
      (x) => x.kind === "reconcile-fallback" && x.reason === "unplaceable-insert",
    ) as RuntimeDiagnostic;
    expect(describeDiagnostic(d)).toBe(
      "reconcile could not key-match Stack (overlay)'s children: unplaceable-insert (children[1], a text, is new, and this parent's renderer does not place every child directly under its own element, so the keyed matcher could not mount it into the slot the renderer would have given it)",
    );
    dispose();
  });

  it("stays quiet when the parent places its keyed children directly", () => {
    let order = ["a", "b", "c"];
    const app = appOf(() => ({
      kind: "column",
      children: order.map((id) => ({ kind: "text" as const, text: `row ${id}`, key: id })),
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    order = ["c", "a", "b"];
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    dispose();
  });

  it("leaves the by-design paths alone", () => {
    let ordered = false;
    let swapped = false;
    const app = appOf(() => ({
      kind: "column",
      children: [
        swapped ? { kind: "text", text: "x" } : { kind: "heading", text: "x" },
        { kind: "list", ordered, children: [{ kind: "list-item", children: [] }] },
      ],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    ordered = true;
    swapped = true;
    app._rerender?.();

    expect(fallbackReasons(seen)).toEqual([]);
    dispose();
  });

  it("changes nothing when no sink is registered", () => {
    let title = "one";
    const app = appOf(() => ({
      kind: "column",
      children: [{ kind: "heading", text: title }],
    }));
    const { dispose } = mount(app, root);

    const heading = root.querySelector("h1") as HTMLElement;
    heading.dataset.probe = "seeded";
    title = "two";
    app._rerender?.();

    expect(root.querySelector("h1")).toBe(heading);
    expect(heading.textContent).toBe("two");
    dispose();
  });
});

describe("smoke: reconcile diagnostics", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  function togglingApp(): AppShape & { _dispatch?: MountedApp["_dispatch"] } {
    let open = false;
    const app: AppShape & { _dispatch?: MountedApp["_dispatch"] } = {
      slots: { open: { value: false } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "toggle",
          selector: { tile: "Toggle" },
          event: { kind: "ui", ev: "click" },
          apply: () => {
            open = !open;
            return { slots: { open }, emits: [] };
          },
        },
      ],
      root: () => ({
        kind: "column",
        children: [
          {
            kind: "button",
            text: "toggle",
            props: { _tile: "Toggle", onClick: () => app._dispatch?.("toggle", {}) },
          },
          ...(open ? [{ kind: "text" as const, text: "detail" }] : []),
        ],
      }),
    };
    return app;
  }

  it("collects diagnostics without failing the run, with the context of an issue", async () => {
    const report = await smoke(togglingApp(), root, { settleMs: 0 });

    expect(report.ok).toBe(true);
    const fallback = report.diagnostics.find(
      (d) =>
        d.diagnostic.kind === "reconcile-fallback" && d.diagnostic.reason === "child-count-change",
    );
    expect(fallback).toBeDefined();
    expect(fallback?.phase).toBe("interaction");
    expect(fallback?.trigger).toMatch(/^click button/);
  });

  it("promotes them to issues when the caller opts in", async () => {
    const report = await smoke(togglingApp(), root, { settleMs: 0, diagnosticsAsIssues: true });

    expect(report.ok).toBe(false);
    // The message spells out the evidence, not just the reason name.
    expect(
      report.issues.some((i) =>
        /child-count-change \(1 unkeyed children became 2\)/.test(i.message),
      ),
    ).toBe(true);
  });

  it("spells out a per-render handler as the churn it causes", async () => {
    const hostCard = (): HTMLElement => document.createElement("div");
    const app = appOf(
      () =>
        ({
          kind: "card",
          props: { _tile: "Panel", onClick: () => undefined },
        }) as unknown as TileNode,
    );
    // Asserted outside the sink on purpose: the runtime swallows throws from a
    // host sink, so an `expect` inside one would never fail the test.
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });
    app._rerender?.();

    expect(seen).toHaveLength(1);
    expect(describeDiagnostic(seen[0] as RuntimeDiagnostic)).toBe(
      "Panel (card)'s props.onClick holds a function whose identity changed (a handler rebuilt per render never compares equal; memoising it fixes that) — this tile re-applies its props on every render",
    );
    dispose();
  });
});

describe("runScenario: diagnostics are attributed to the step that caused them", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  /** Toggles an unkeyed sibling on `toggle`; `noop` re-renders without churn. */
  function togglingApp(): AppShape {
    let open = false;
    return {
      slots: { open: { value: false } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "toggle",
          event: { kind: "ui", ev: "click" },
          apply: () => {
            open = !open;
            return { slots: { open }, emits: [] };
          },
        },
        {
          name: "noop",
          event: { kind: "ui", ev: "click" },
          apply: () => ({ slots: { open }, emits: [] }),
        },
      ],
      root: () => ({
        kind: "column",
        children: [
          { kind: "heading", text: "steps" },
          ...(open ? [{ kind: "text" as const, text: "detail" }] : []),
        ],
      }),
    };
  }

  it("separates the churning step from the quiet ones", async () => {
    const report = await runScenario(
      togglingApp(),
      root,
      {
        steps: [
          { label: "quiet", do: { dispatch: "noop" } },
          { label: "toggles", do: { dispatch: "toggle" } },
          { label: "quiet again", do: { dispatch: "noop" } },
        ],
      },
      { settleMs: 0 },
    );

    expect(report.steps.map((s) => s.diagnostics.length)).toEqual([0, 1, 0]);
    expect(report.steps[1]?.diagnostics[0]).toMatchObject({
      kind: "reconcile-fallback",
      reason: "child-count-change",
    });
    // Buffered per step, so the churn never leaks forward into later steps or
    // backward from the initial mount (which is a full render, not a diff).
    expect(report.ok).toBe(true);
  });
});
