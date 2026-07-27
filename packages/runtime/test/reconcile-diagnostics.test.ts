// Dev-mode observability for the reconcile walker.
//
// The diff has several full-rebuild escape hatches that are correctness-
// preserving but hide behind an ordinary `return`: an app can be re-mounting
// every subtree on every render while the benchmark still reports a waste
// ratio of 1×. And because the prop-equality kernel treats any two functions
// as equal, a host that registers its own renderer can keep a stale closure
// alive with no signal at all.
//
// These tests lock in that each of those paths reports through the opt-in
// `onDiagnostic` sink, and — just as importantly — that a mount without a
// sink behaves exactly as before and that built-in tiles never produce
// stale-closure noise (they route handlers through per-element slots).

import type {
  AppShape,
  RuntimeDiagnostic,
  TileCtx,
  TileNode,
  TileRenderers,
} from "@kumikijs/runtime";
import {
  describeDiagnostic,
  mount,
  mountCore,
  runScenario,
  smoke,
  textTiles,
} from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
