// Dev-mode observability for the reconcile walker.
//
// The diff has several full-rebuild escape hatches that are correctness-
// preserving but hide behind an ordinary `return`: an app can be re-mounting
// every subtree on every render while the benchmark still reports a waste
// ratio of 1×. The prop-equality kernel adds two more, on either side of its
// own verdict: it treats any two functions as equal, so a host renderer can
// keep a stale closure alive, and it can never call a `Date` or a `NaN` equal,
// so a host tile carrying one is patched every render with nothing reported at
// all.
//
// These tests lock in that each of those paths reports through the opt-in
// `onDiagnostic` sink, and — just as importantly — that a mount without a
// sink behaves exactly as before and that built-in tiles produce neither kind
// of host-tile noise (they route handlers through per-element slots and carry
// only the plain data codegen emits).

import type {
  AppShape,
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
    // The everyday shape: a `when`-gated child inside a column. Because the
    // siblings carry no `key`, dropping one changes `children.length` and the
    // whole column is rebuilt — the authoring cost the diagnostic makes visible.
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

    // The counts are the actionable part: "2 unkeyed children became 1" points
    // straight at the `when` that has to become keyed.
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "child-count-change", oldCount: 2, newCount: 1 }),
    );
    dispose();
  });

  it("survives a sink that throws without disturbing the render", () => {
    // The walker runs inside the reconcile bailout's try/catch, so an unguarded
    // throw from the host's sink would be recorded as a reconcile panic and
    // force a full-tree rebuild — the diagnostic channel inflicting the exact
    // identity loss it exists to report.
    // The churn is nested one level down, so only the inner column should be
    // rebuilt. A panic-driven `fullRender` would take the outer heading with it.
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
    // `mountCore` renders with exactly the registries it is handed. A renderer
    // registered without its companion patcher rebuilds the tile on every data
    // change instead of mutating it — this is what a granular mount looked like
    // before the patcher registry was wired through.
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
    // Defensive path: Kumiki codegen flattens nils out of `_children`, so only
    // a host-built tree can hand the walker a sparse slot. Rebuilding the
    // parent keeps it correct; the diagnostic says why the parent churned.
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
    // A host renderer that builds its children with `document.createElement`
    // instead of `ctx.render` leaves them out of the node→element map, so the
    // walker cannot reuse them and rebuilds the parent on every single render.
    // Silently, today — which is exactly the compat pattern this surfaces.
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

  /**
   * A column whose child at index 0 changes on every render and whose child at
   * index 1 is the one a bail trips over. The shape every case below shares:
   * the bail sits behind a sibling that would otherwise have reconciled.
   */
  function bailBehindSiblingApp(children: () => TileNode[]): AppShape {
    return appOf(() => ({ kind: "column", children: children() }));
  }

  it("reports the same evidence when the bail follows a sibling that would have reconciled", () => {
    // The parent's fate is settled for the whole child list before any of it
    // is applied. That decision asks the same two questions at every index, in
    // index order, so a bail at index 1 still names index 1 — and, for
    // `child-unmapped`, the kind of the child whose element went missing.
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
    // Both questions are asked at the same index and the hole is asked first,
    // which is the order the walk used before the decision was lifted out of
    // it. Pinned because the two are not interchangeable to a reader: a hole
    // says the tree handed the walker an empty slot, `child-unmapped` says a
    // renderer skipped `ctx.render`. The nil child cannot be looked up at all,
    // so only one of them can be the truth here.
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
    // With no patcher registered, reconciling the child at index 0 reports
    // `no-patcher` and rebuilds its subtree — and then the hole at index 1
    // rebuilds the parent, discarding that subtree. Reporting a fallback for a
    // subtree that was thrown away is the same falsehood as listing it in
    // `binds-updated`: the parent's fate is settled first, so the only thing
    // named is the rebuild that actually happened.
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
    // The `child-unmapped` half of the case above, so neither bail is pinned
    // by the other's test. The renderer maps index 0 and hand-builds index 1;
    // with no patcher registered, index 0 would report `no-patcher` and be
    // rebuilt before index 1 stopped the pass.
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

  it("says nothing about a stale closure on a sibling a bail no longer applies", () => {
    // The other diagnostic a child can raise. The host tile at index 0 keeps
    // identical data props and swaps only its handler, so the walk would reuse
    // its element and report `stale-closure-risk` — a warning about code that
    // is about to run. It is not about to run: the hole at index 1 rebuilds
    // the parent, and the element that would have kept the stale closure goes
    // with it. Reporting it would send a reader after a bug that cannot fire.
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

  it("reports a function-identity change the equality check ignored on a host tile", () => {
    // The heisenbug this exists for: the host's renderer captured the handler
    // at create time, the data props are identical, so the tile is reused and
    // keeps firing the first render's closure forever.
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

    const stale = seen.filter((d) => d.kind === "stale-closure-risk");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ tileKind: "card", id: "card", field: "props.onClick" });
    dispose();
  });

  it("catches a handler on the node itself, not only under props", () => {
    // Some hosts hang the handler off the node rather than `props`. The scan
    // covers the node's own data fields too, so both conventions are seen.
    const hostCard = (): HTMLElement => document.createElement("div");
    const app = appOf(() => ({ kind: "card", onSelect: () => undefined }) as unknown as TileNode);
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, {
      tiles: { card: hostCard } as TileRenderers,
      onDiagnostic: sink,
    });

    app._rerender?.();

    expect(seen).toContainEqual(
      expect.objectContaining({ kind: "stale-closure-risk", field: "onSelect" }),
    );
    dispose();
  });

  it("does not chase handlers nested deeper than props", () => {
    // The scan stops at `props.x` on purpose. Anything deeper is past the point
    // where a generic warning helps, and an unbounded walk would run on every
    // reuse decision of every host tile. Locked in so the shallow contract in
    // `ownFieldPairs` cannot silently widen.
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

    expect(seen.filter((d) => d.kind === "stale-closure-risk")).toEqual([]);
    dispose();
  });

  it("stays silent about function identity on built-in tiles", () => {
    // Built-ins route every handler through a per-element slot the patcher
    // refreshes, so a re-minted closure is not a risk there. Reporting it
    // would bury the host-tile signal under one entry per tile per render.
    const app = appOf(() => ({
      kind: "column",
      children: [{ kind: "button", text: "go", props: { onClick: () => undefined } }],
    }));
    const { sink, seen } = collector();
    const { dispose } = mount(app, root, { onDiagnostic: sink });

    app._rerender?.();

    expect(seen.filter((d) => d.kind === "stale-closure-risk")).toEqual([]);
    dispose();
  });

  it("scopes the scan to the kinds the host actually registered", () => {
    // Registering `card` must not put every other tile under suspicion. Without
    // the per-kind gate this passes trivially only while `hostTileKinds` is
    // empty; here it is non-empty and still must not fire for `button`.
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

    expect(seen.filter((d) => d.kind === "stale-closure-risk")).toEqual([]);
    dispose();
  });

  it("survives a host value that throws while the reuse scan reads it", () => {
    // Reading a host node's fields is not inert. Here `props` is the same
    // object on both sides, so the equality kernel short-circuits on `===` and
    // never enumerates it — and then the scan does, hitting a trap the kernel
    // proved nothing about. Unguarded that throw lands in the reconcile bailout
    // as a panic and rebuilds the whole tree: the observation inflicting the
    // identity loss it exists to report.
    const hostCard = (): HTMLElement => document.createElement("div");
    const props = new Proxy(
      { onClick: () => undefined },
      {
        ownKeys() {
          throw new Error("host props refuse enumeration");
        },
      },
    );
    const app = appOf(() => ({ kind: "card", props }) as unknown as TileNode);
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

      expect(errors).toEqual([]);
      expect(root.firstElementChild).toBe(card);
      expect(seen).toEqual([]);
      dispose();
    } finally {
      console.error = originalError;
    }
  });

  // ---- props that can never compare equal ----
  //
  // The mirror image of the stale-closure scan, on the other side of the same
  // fork. A tile whose props compare unequal on EVERY render while a patcher is
  // registered is the identity-preserving happy path as far as the walker is
  // concerned — the element survives, nothing fell back, nothing is reported —
  // and it re-applies the same attributes forever. Both causes are unreachable
  // from a `.kumiki` source, so a host tree is the only way in and the only
  // audience.

  /** Ignores its node: these cases are about the kernel's verdict, not paint. */
  const hostCard = (): HTMLElement => document.createElement("div");

  /** Registered so the unequal decision is PATCHED rather than rebuilt. */
  const inPlaceCardPatch = { card: () => undefined } as TilePatchers;

  /**
   * Mounts a host-registered `card` and re-renders it once. `patchers` picks
   * which of the two shapes is under test: with a patcher the walker preserves
   * the element and reports no fallback at all, without one it rebuilds and
   * reports `no-patcher` on top.
   */
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
    // Without a patcher the churn is already audible as `no-patcher` — but that
    // reason names the kind, not the field, so it cannot say WHICH prop made
    // two structurally identical renders compare unequal. This does.
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
    // The case this whole scan exists for. A patcher runs, the element keeps its
    // identity, nothing degraded — so the fallback channel is silent and the app
    // looks perfectly healthy while patching the same attributes forever.
    const seen = hostCardRun(
      () => ({ kind: "card", props: { at: new Date(0) } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(seen.map((d) => d.kind)).toEqual(["never-equal-prop"]);
    expect(seen[0]).toMatchObject({ field: "props.at", cause: "non-plain-object" });
  });

  it("names a NaN prop, which is unequal to itself by design", () => {
    // §10.3.13 makes `NaN` unequal to `NaN` on purpose — a failed computation
    // should churn visibly rather than freeze a tile. The churn was the visible
    // part; this makes the reason for it visible too.
    const seen = hostCardRun(
      () => ({ kind: "card", props: { total: Number.NaN } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "props.total", cause: "nan" }),
    ]);
  });

  it("names a class instance, not only the built-in exotics", () => {
    // "Plain" is decided by prototype identity, so anything whose state lives
    // outside its own enumerable keys lands here — a domain class as much as a
    // `Date`, and a cross-realm object through the very same check.
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
    // Same two conventions the stale-closure scan covers: a host may hang data
    // off the node rather than `props`.
    const seen = hostCardRun(() => ({ kind: "card", at: new Date(0) }) as unknown as TileNode, {});

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "at", cause: "non-plain-object" }),
    ]);
  });

  it("stays quiet while only one side is exotic", () => {
    // A plain bag becoming a `Date` is an ordinary type change: this render's
    // inequality is real, and nothing yet says the next one will repeat it. The
    // report arrives on the following render, when two exotics that describe the
    // same value still compare unequal — one render late, never wrong.
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
    // Every exotic the spec and `describeDiagnostic` list runs through the one
    // `isPlainDataBag` check. Spot-checked here so narrowing that check to
    // object literals would fail loudly instead of silently exempting the rest.
    const seen = hostCardRun(
      () => ({ kind: "card", props: { value: make() } }) as unknown as TileNode,
      inPlaceCardPatch,
    );

    expect(neverEqual(seen)).toEqual([
      expect.objectContaining({ field: "props.value", cause: "non-plain-object" }),
    ]);
  });

  it("says nothing about a tile the parent's bail is about to discard", () => {
    // Same rule the stale-closure scan follows, and the same reason: the hole
    // at index 1 settles the parent's fate before any child is applied, so the
    // host card at index 0 is never reconciled and the props that would have
    // churned are about to be thrown away with it. Reporting them would point
    // a reader at churn this render did not pay for.
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
    // The kernel short-circuits at the FIRST unequal field, so a later prop can
    // hold something it never touched — here a proxy whose prototype is
    // unreadable, exactly what `neverEqualCause` asks for. The scan abandons
    // the tile and the render carries on: `no-patcher` still reports, the
    // rebuild still happens, and no reconcile panic is recorded.
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
    // The kernel takes arrays element-wise, so an array is never itself the
    // never-equal value — and descending into one to find the `Date` inside is
    // the deep walk this scan refuses on the same grounds as `props.meta.at`.
    // The tile still churns; what is missing is a name for why, which is the
    // documented cost of keeping the scan bounded.
    const seen = hostCardRun(
      () => ({ kind: "card", props: { tags: [new Date(0)] } }) as unknown as TileNode,
      {},
    );

    expect(neverEqual(seen)).toEqual([]);
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("stays quiet for the same instance handed over twice", () => {
    // `===` rescues a stable instance, so an exotic value is only a hazard when
    // a fresh one is minted per render. Reporting the stable case would fire on
    // every unequal decision of every tile that happens to carry one.
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
    // The scan stops at `props.x`, exactly like the stale-closure one: it runs
    // on every unequal decision of every host tile, and an unbounded walk to
    // find an exotic three levels down would be a per-render cost on the hot
    // path. Locked in so the shallow contract cannot silently widen.
    const seen = hostCardRun(
      () => ({ kind: "card", props: { meta: { at: new Date(0) } } }) as unknown as TileNode,
      {},
    );

    expect(neverEqual(seen)).toEqual([]);
    expect(fallbackReasons(seen)).toEqual(["no-patcher"]);
  });

  it("stays silent about an exotic prop on a built-in tile", () => {
    // Same gate the stale-closure scan uses. `card` is registered by the host
    // here, so `hostTileKinds` is non-empty and the check is live — the `heading`
    // beside it must still produce nothing.
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
    // The scan is opt-in like the rest of the channel: without `onDiagnostic`
    // the walker takes the pre-existing path, patcher and all.
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
    // `overlay` puts children 1..N inside a positioning layer, so the elements
    // the walker has mapped are grandchildren of the overlay. The keyed pass
    // moves and removes children by addressing the parent element, which would
    // tear them out of those layers — it stands down and the positional walk
    // runs instead. The diagnostic is how an author learns the list stopped
    // being reorder-stable despite every child carrying a key.
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
    // Every other fallback rebuilt a subtree; this one did not touch the DOM at
    // all. Wording that claimed a rebuild would send the reader hunting churn
    // that is not there.
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
    // The keyed matcher declines because of the wrapper; the structural walk it
    // falls into then rebuilds because the length changed. Both are true and
    // both are worth saying — the first is the cause the author can fix, the
    // second is what it cost this render. Pinned so a future de-duplication
    // does not quietly drop one.
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
    // An unmapped child is a broken invariant, not a placement style: the keyed
    // pass throws, the reconcile bailout records a panic, and that is audible
    // without a diagnostic sink. Diverting it into the placement gate would
    // trade a panic every host sees for a `child-unmapped` only an opted-in one
    // does — so the gate deliberately steps over it.
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
    // The half the gate's reasoning has to cover too. A child on its way out is
    // looked up for removal rather than for reuse, and the invariant it breaks
    // is the same one — so it answers to the same channel, and the pass settles
    // that for the whole old list before it applies anything.
    //
    // The renderer maps index 0 through `ctx.render` and hand-builds index 1,
    // so the survivor is mapped and only the departure is not: the gate is
    // reached and steps over it exactly as it says it does.
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
    // The panic is not a late discovery dressed up as an early one. A departure
    // is looked at last — after every survivor is reconciled and every newcomer
    // built — so resolving the old list up front is what makes the pass leave
    // nothing behind when it throws.
    //
    // The newcomer's renderer counts its own calls, and the keyed pass is the
    // only thing that would ever call it: the parent hand-builds every child
    // after the first, so the full rebuild the panic falls back to does not.
    let mounted = 0;
    const badge = (): HTMLElement => {
      mounted++;
      return document.createElement("b");
    };
    let members = ["a", "gone"];
    const app = appOf(() => ({
      kind: "column",
      children: members.map((id) => ({ kind: id === "a" ? "text" : "badge", text: id, key: id })),
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
    // The placement gate asks two questions, and only the first one steps over
    // an unmapped child. If the second — "this renderer has nowhere to put a
    // newcomer" — could still decline afterwards, the invariant would ride the
    // decline down into the structural walk and come out as an opt-in
    // `child-unmapped`, or as nothing at all once the length change rebuilt the
    // parent. So the mapping is answered in between.
    //
    // `overlay` is in the declared set, and the renderer here places its first
    // child directly and hand-builds the rest — so the measurement comes back
    // clean, the second question has a newcomer to object to, and the unmapped
    // child sits between them.
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
    // `overlay` places its FIRST child directly and only wraps the rest, so a
    // single-layer overlay has nothing out of reach and the keyed path must
    // still run. Locks in that the gate reads actual placement rather than
    // assuming a kind is disqualified wholesale.
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
    // Nothing was lost: the parent kept its element and every child is new, so
    // there was no identity to preserve in the first place. Reporting
    // `child-count-change` here used to send authors looking for keys they had
    // already added.
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
    // `overlay` cannot key-match, but the empty boundary never asks it to: the
    // renderer is re-entered for the interior, so neither the placement decline
    // nor the length rebuild happened.
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
    // With one mounted child the placement probe truthfully reports "nothing is
    // wrapped" — `overlay` places its first child directly. It cannot speak for
    // the slot the SECOND child would get, so the walker reads the renderer's
    // declared placement instead, declines, and the structural walk rebuilds.
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
    // The surfaces wrap every child, so one mounted child is already enough
    // for the placement measurement to answer — and a measurement that can
    // answer always wins. Their entry in the declared set is redundant for
    // these renders, and this pins that it stays redundant rather than
    // producing a second, competing diagnostic.
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
    // `child-hole` exists because a hole desynchronises the positional walk
    // from the old list and costs a rebuild. Growing from empty has no old list
    // to desynchronise from, and the renderer drops nils itself — so the DOM is
    // right and there is no fallback to report. Deliberate, not an oversight:
    // the same tree on a same-length render still reports.
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
    // `wrapped-children` names a child that IS wrapped right now;
    // `unplaceable-insert` names one that cannot be mounted at all. Conflating
    // them would point the author at the wrong element.
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
    // The placement check must not fire for the ordinary containers, or every
    // keyed list in the app would report a fallback it did not take.
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
    // A kind change means "a different thing is here now", and a patcher that
    // declines (a `list` flipping <ul>↔<ol>) is a documented, expected outcome
    // kept out of the log on purpose. Neither is a lost identity guarantee.
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

  // A button that toggles an unkeyed sibling in and out — the shape `smoke`
  // will trip the moment it clicks anything.
  function togglingApp(): AppShape {
    let open = false;
    const app: AppShape = {
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
    // The whole point of keeping these out of `issues`: an unkeyed sibling
    // list is ordinary, correct Kumiki. The corpus must stay green. But a
    // report that says "a subtree was rebuilt" without saying which
    // interaction provoked it answers half the question, so each one carries
    // the same phase / trigger a `SmokeIssue` would.
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

  it("spells out a stale closure as the correctness problem it is", async () => {
    // "reused X" reads as success; the wording has to say the new handler will
    // never fire. This is the only diagnostic that means the app is running
    // the wrong code rather than merely rebuilding too much.
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
      "Panel (card) was reused with the PREVIOUS render's props.onClick — the new one will never fire",
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
