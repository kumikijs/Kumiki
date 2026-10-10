import type {
  AppShape,
  MountedApp,
  RuntimeDiagnostic,
  TileCtx,
  TileNode,
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstChildMappedColumn } from "./fixtures/host-renderers.ts";
import { appOf, bareApp } from "./helpers/app.ts";
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

function collector(): { sink: (d: RuntimeDiagnostic) => void; seen: RuntimeDiagnostic[] } {
  const seen: RuntimeDiagnostic[] = [];
  return { sink: (d) => seen.push(d), seen };
}

function fallbackReasons(seen: RuntimeDiagnostic[]): string[] {
  return seen.filter((d) => d.kind === "reconcile-fallback").map((d) => d.reason);
}

const keyedTexts = (ids: string[]) =>
  ids.map((id) => ({ kind: "text" as const, text: id, key: id }));

/** A renderer that draws its children itself, so none of them is in the element map. */
const detachedColumn = (node: TileNode): HTMLElement => {
  const el = document.createElement("div");
  for (const child of (node as { children?: TileNode[] }).children ?? []) {
    const span = document.createElement("span");
    span.textContent = (child as { text?: string }).text ?? "";
    el.appendChild(span);
  }
  return el;
};

/** Mounts the tree for `value`, re-renders it for `next`, and returns that pass's diagnostics. */
function rerenderReport<T>(
  value: T,
  next: T,
  tree: (v: T) => TileNode,
  tiles?: TileRenderers,
): RuntimeDiagnostic[] {
  let current = value;
  const app = appOf(() => tree(current));
  const { sink, seen } = collector();
  const { dispose } = mount(app, root, { onDiagnostic: sink, ...(tiles ? { tiles } : {}) });
  current = next;
  app._rerender?.();
  dispose();
  return seen;
}

describe("a reconcile fallback is reported with its evidence", () => {
  it("names an unkeyed sibling-list length change", () => {
    const seen = rerenderReport(true, false, (extra) => ({
      kind: "column",
      children: [
        { kind: "heading", text: "title" },
        ...(extra ? [{ kind: "text" as const, text: "detail" }] : []),
      ],
    }));

    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "child-count-change", oldCount: 2, newCount: 1 }),
    );
  });

  it("names a same-kind prop change with no patcher registered for the kind", () => {
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

  it("names a hole in a children list", () => {
    const seen = rerenderReport(false, true, (holed) => ({
      kind: "column",
      children: holed
        ? ([{ kind: "text", text: "a" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a" },
            { kind: "text", text: "b" },
          ],
    }));

    expect(seen).toContainEqual(expect.objectContaining({ reason: "child-hole", index: 1 }));
  });

  it("names the child that never passed through the mapping render ctx", () => {
    const seen = rerenderReport(
      "a",
      "b",
      (label) => ({
        kind: "column",
        children: [
          { kind: "text", text: label },
          { kind: "text", text: "static" },
        ],
      }),
      { column: detachedColumn } as TileRenderers,
    );

    // `childKind` points at the renderer that skipped `ctx.render`.
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "child-unmapped", index: 0, childKind: "text" }),
    );
  });

  it("names the authored tile and the bind so a report points back at the source", () => {
    const seen = rerenderReport(true, false, (extra) => ({
      kind: "column",
      props: { _tile: "Panel" },
      children: [
        { kind: "input", bind: "note", value: "" },
        ...(extra ? [{ kind: "text" as const, text: "hint" }] : []),
      ],
    }));

    expect(seen.find((x) => x.kind === "reconcile-fallback")).toMatchObject({
      tileKind: "column",
      tile: "Panel",
      id: "column",
    });
  });

  it("survives a sink that throws without disturbing the render", () => {
    const errors = captureConsole();
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
    const { dispose } = mount(app, root, {
      onDiagnostic: () => {
        throw new Error("host sink is broken");
      },
    });
    const heading = root.querySelector("h1");

    extra = false;
    app._rerender?.();

    expect(errors).toEqual([]);
    expect(root.querySelector("h1")).toBe(heading);
    dispose();
  });

  it("changes nothing about the render when no sink is registered", () => {
    let title = "one";
    const app = appOf(() => ({ kind: "column", children: [{ kind: "heading", text: title }] }));
    const { dispose } = mount(app, root);
    const heading = root.querySelector("h1") as HTMLElement;
    heading.dataset.probe = "seeded";

    title = "two";
    app._rerender?.();

    expect(root.querySelector("h1")).toBe(heading);
    expect(heading.textContent).toBe("two");
    dispose();
  });

  it("leaves the by-design paths alone", () => {
    const seen = rerenderReport(false, true, (changed) => ({
      kind: "column",
      children: [
        changed ? { kind: "text", text: "x" } : { kind: "heading", text: "x" },
        { kind: "list", ordered: changed, children: [{ kind: "list-item", children: [] }] },
      ],
    }));

    expect(fallbackReasons(seen)).toEqual([]);
  });
});

describe("a bail behind a sibling reports only the bail", () => {
  const holedAfter = (first: TileNode) => (holed: boolean) =>
    ({
      kind: "column",
      children: holed ? [first, undefined] : [first, { kind: "text", text: "b" }],
    }) as unknown as TileNode;

  it("reports the hole when the sibling before it would have reconciled", () => {
    let label = "a";
    let holed = false;
    const app = appOf(() => holedAfter({ kind: "text", text: label })(holed));
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
    expect(seen).toContainEqual(expect.objectContaining({ reason: "child-hole", index: 1 }));
    dispose();
  });

  it("reports the unmapped child when the sibling before it would have reconciled", () => {
    let label = "a";
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "text", text: label },
        { kind: "text", text: "hand-built" },
      ],
    }));
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
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "child-unmapped", index: 1, childKind: "text" }),
    );
    dispose();
  });

  it("calls an index that is both a hole and unmapped a hole", () => {
    const seen = rerenderReport(
      false,
      true,
      (holed) =>
        ({
          kind: "column",
          children: holed
            ? [{ kind: "text", text: "a2" }, undefined]
            : [
                { kind: "text", text: "a" },
                { kind: "text", text: "hand-built" },
              ],
        }) as unknown as TileNode,
      { column: firstChildMappedColumn } as TileRenderers,
    );

    expect(fallbackReasons(seen)).toEqual(["child-hole"]);
  });

  it.each<[string, () => TileNode]>([
    [
      "a churning handler",
      () => ({ kind: "card", text: "steady", props: { onPick: () => {} } }) as unknown as TileNode,
    ],
    ["a fresh Date", () => ({ kind: "card", props: { at: new Date(0) } }) as unknown as TileNode],
  ])("says nothing about %s on a sibling the bail discards", (_label, card) => {
    const hostCard = (node: TileNode, _ctx: TileCtx): HTMLElement => {
      const el = document.createElement("div");
      el.textContent = (node as { text?: string }).text ?? "";
      return el;
    };
    const seen = rerenderReport(false, true, (holed) => holedAfter(card())(holed), {
      card: hostCard,
    } as TileRenderers);

    expect(seen.map((d) => d.kind)).toEqual(["reconcile-fallback"]);
    expect(fallbackReasons(seen)).toEqual(["child-hole"]);
  });
});

describe("the keyed matcher reports why it declined", () => {
  it("names keyed children the parent renderer wrapped out of reach", () => {
    const seen = rerenderReport(["a", "b", "c"], ["c", "a", "b"], (order) => ({
      kind: "overlay",
      children: keyedTexts(order),
    }));

    // Index 0 is the base layer, which the overlay places directly.
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "wrapped-children", index: 1, childKind: "text" }),
    );
  });

  it("names both facts when a wrapped list also changed length", () => {
    const seen = rerenderReport(["a", "b", "c"], ["a", "c"], (order) => ({
      kind: "overlay",
      children: keyedTexts(order),
    }));

    expect(fallbackReasons(seen)).toEqual(["wrapped-children", "child-count-change"]);
  });

  it("names a newcomer the parent renderer has nowhere to put", () => {
    const seen = rerenderReport(["solo"], ["solo", "b"], (order) => ({
      kind: "overlay",
      children: keyedTexts(order),
    }));

    expect(fallbackReasons(seen)).toEqual(["unplaceable-insert", "child-count-change"]);
    expect(seen).toContainEqual(
      expect.objectContaining({ reason: "unplaceable-insert", index: 1, childKind: "text" }),
    );
  });

  it.each([
    "modal",
    "drawer",
    "popover",
  ] as const)("reports a %s's growth from the measurement, not from the declaration", (kind) => {
    const seen = rerenderReport(["a"], ["a", "b"], (order) => ({
      kind,
      children: keyedTexts(order),
    }));

    expect(fallbackReasons(seen)).toEqual(["wrapped-children", "child-count-change"]);
  });

  it.each<[string, TileNode["kind"], string[], string[], string]>([
    ["a one-child overlay, which wraps nothing", "overlay", ["solo"], ["solo"], "!"],
    ["a list that grows from empty", "column", [], ["a", "b", "c"], ""],
    ["a list cleared to empty", "column", ["a", "b", "c"], [], ""],
    ["a wrapping parent whose list grows from empty", "overlay", [], ["a", "b", "c"], ""],
    [
      "a parent that places its keyed children directly",
      "column",
      ["a", "b", "c"],
      ["c", "a", "b"],
      "",
    ],
  ])("stays quiet for %s", (_label, kind, before, after, edit) => {
    const seen = rerenderReport(
      { ids: before, suffix: "" },
      { ids: after, suffix: edit },
      ({ ids, suffix }) =>
        ({
          kind,
          children: keyedTexts(ids).map((t) => ({ ...t, text: t.text + suffix })),
        }) as TileNode,
    );

    expect(fallbackReasons(seen)).toEqual([]);
  });

  it("stays quiet for an empty slot in a list that grows from empty", () => {
    let filled = false;
    const app = appOf(() => ({
      kind: "column",
      children: filled
        ? ([...keyedTexts(["a"]), null, ...keyedTexts(["b"])] as unknown as TileNode[])
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

  it.each([
    [
      "wrapped-children",
      ["a", "b"],
      ["b", "a"],
      "reconcile could not key-match Stack (overlay)'s children: wrapped-children (children[1], a text, is wrapped by its parent's renderer instead of sitting directly under it, so reorder fell back to positional matching)",
    ],
    [
      "unplaceable-insert",
      ["solo"],
      ["solo", "b"],
      "reconcile could not key-match Stack (overlay)'s children: unplaceable-insert (children[1], a text, is new, and this parent's renderer does not place every child directly under its own element, so the keyed matcher could not mount it into the slot the renderer would have given it)",
    ],
  ])("describes %s as a declined match, not a rebuild", (reason, before, after, message) => {
    const seen = rerenderReport(before, after, (order) => ({
      kind: "overlay",
      props: { _tile: "Stack" },
      children: keyedTexts(order),
    }));

    const d = seen.find((x) => x.kind === "reconcile-fallback" && x.reason === reason);
    expect(describeDiagnostic(d as RuntimeDiagnostic)).toBe(message);
  });
});

describe("a keyed child with no element mapping takes the panic path", () => {
  const panicked = (errors: string[]) =>
    expect(errors.join(" ")).toContain("has no live element mapping");

  it("for a surviving child, without reporting a wrapped list", () => {
    const errors = captureConsole();
    const seen = rerenderReport(
      "a",
      "b",
      (label) => ({
        kind: "column",
        children: [
          { kind: "text", text: label, key: "first" },
          { kind: "text", text: "static", key: "second" },
        ],
      }),
      { column: detachedColumn } as TileRenderers,
    );

    panicked(errors);
    expect(fallbackReasons(seen)).not.toContain("wrapped-children");
  });

  it("for a departing child, whose stale element the full rebuild then clears", () => {
    const errors = captureConsole();
    const seen = rerenderReport(
      ["a", "b"],
      ["a"],
      (members) => ({
        kind: "column",
        children: members.map((id) => ({
          kind: "text" as const,
          text: id === "b" ? "hand-built" : id,
          key: id,
        })),
      }),
      { column: firstChildMappedColumn } as TileRenderers,
    );

    panicked(errors);
    expect(fallbackReasons(seen)).not.toContain("wrapped-children");
    expect(fallbackReasons(seen)).not.toContain("child-unmapped");
    expect(root.textContent).not.toContain("hand-built");
  });

  it("before it mounts a newcomer", () => {
    const errors = captureConsole();
    let mounted = 0;
    const badge = (): HTMLElement => {
      mounted++;
      return document.createElement("b");
    };
    rerenderReport(
      ["a", "gone"],
      ["a", "new"],
      (members) => ({
        kind: "column",
        children: members.map((id) =>
          // `badge` is a host kind outside the closed `TileNode` union.
          id === "a"
            ? ({ kind: "text", text: id, key: id } as TileNode)
            : ({ kind: "badge", text: id, key: id } as unknown as TileNode),
        ),
      }),
      { column: firstChildMappedColumn, badge } as TileRenderers,
    );

    panicked(errors);
    expect(mounted).toBe(0);
  });

  it("even when a later reason to decline would also apply", () => {
    const errors = captureConsole();
    const seen = rerenderReport(
      ["a", "hand-built"],
      ["a", "hand-built", "newcomer"],
      (members) => ({ kind: "overlay", children: keyedTexts(members) }),
      { overlay: firstChildMappedColumn } as TileRenderers,
    );

    panicked(errors);
    expect(fallbackReasons(seen)).not.toContain("unplaceable-insert");
  });
});

describe("smoke reports reconcile diagnostics", () => {
  function togglingApp(): AppShape {
    let open = false;
    const app: AppShape = bareApp({
      slots: { open: { value: false } },
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
            props: { _tile: "Toggle", onClick: () => (app as MountedApp)._dispatch("toggle", {}) },
          },
          ...(open ? [{ kind: "text" as const, text: "detail" }] : []),
        ],
      }),
    });
    return app;
  }

  it("collects them without failing the run, with the context of an issue", async () => {
    const report = await smoke(togglingApp(), root, { settleMs: 0 });

    expect(report.ok).toBe(true);
    const fallback = report.diagnostics.find(
      (d) =>
        d.diagnostic.kind === "reconcile-fallback" && d.diagnostic.reason === "child-count-change",
    );
    expect(fallback?.phase).toBe("interaction");
    expect(fallback?.trigger).toMatch(/^click button/);
  });

  it("promotes them to issues, spelling out the evidence, when the caller opts in", async () => {
    const report = await smoke(togglingApp(), root, { settleMs: 0, diagnosticsAsIssues: true });

    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.message)).toContainEqual(
      expect.stringMatching(/child-count-change \(1 unkeyed children became 2\)/),
    );
  });
});

describe("runScenario attributes diagnostics to the step that caused them", () => {
  it("separates the churning step from the quiet ones", async () => {
    let open = false;
    const app = bareApp({
      slots: { open: { value: false } },
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
    });

    const report = await runScenario(
      app,
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

    // Buffered per step: nothing leaks forward, or back from the initial full render.
    expect(report.steps.map((s) => s.diagnostics.length)).toEqual([0, 1, 0]);
    expect(report.steps[1]?.diagnostics[0]).toMatchObject({
      kind: "reconcile-fallback",
      reason: "child-count-change",
    });
    expect(report.ok).toBe(true);
  });
});
