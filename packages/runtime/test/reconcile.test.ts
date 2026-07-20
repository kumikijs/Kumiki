// Tile-level keyed diff (issue #187) — behavioural regression suite for the
// renderer's reconcile path. These tests drive the runtime through `mount()`;
// what they lock in is *DOM node identity across re-render*: sibling tiles that
// did not change must keep the very same HTMLElement instance, so focus / caret
// / <select> state / event listeners survive a slot update without going
// through the snapshot-restore fallback (which only exists as a safety net for
// tiles that DID change).

import type { AppShape, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function lifecycleReducer(name: string, apply: ReducerSpec["apply"]): ReducerSpec {
  return {
    name: `r-${name.replace(/[^a-z0-9]/gi, "")}`,
    event: { kind: "lifecycle", name },
    apply,
  };
}

// Column with:
//   [0] heading bound to `count`  (this one changes each render)
//   [1..N] static text rows       (these never change → identity must be kept)
// Optionally an input at the end for the focus test.
function makeStripApp(opts: {
  rows: number;
  withInput?: boolean;
}): AppShape & { _live: { count: number } } {
  const live = { count: 0 };
  const app: AppShape = {
    slots: { count: { value: 0 } },
    caps: [],
    effects: {},
    init: [],
    reducers: [
      {
        name: "bump",
        selector: { tile: "Bump" },
        event: { kind: "ui", ev: "click" },
        apply: (s) => ({ slots: { count: (s.count as number) + 1 }, emits: [] }),
      },
    ],
    root: (): TileNode => {
      const children: TileNode[] = [{ kind: "heading", text: `Count: ${live.count}` }];
      for (let i = 0; i < opts.rows; i++) {
        children.push({ kind: "text", text: `row ${i}` });
      }
      if (opts.withInput) {
        children.push({ kind: "input", bind: "note", value: "hello" });
      }
      return { kind: "column", children };
    },
  };
  // Mirror slot writes into the shadow `live` closure the root() reads.
  const original = app.reducers;
  app.reducers = original.map((r) => ({
    ...r,
    apply: (slots, payload) => {
      const result = r.apply(slots, payload);
      for (const [k, v] of Object.entries(result.slots)) {
        (live as Record<string, unknown>)[k] = v;
      }
      return result;
    },
  }));
  return Object.assign(app, { _live: live });
}

describe("runtime: tile-level keyed diff (#187)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("reuses DOM nodes for tiles whose data props did not change", () => {
    const app = makeStripApp({ rows: 5 });
    const { dispose } = mount(app, root);

    const column = root.firstElementChild as HTMLElement;
    expect(column).toBeTruthy();
    // children[0] = heading (will change), children[1..5] = static rows (must NOT change)
    const savedColumn = column;
    const savedHeading = column.children[0];
    const savedRows = Array.from(column.children).slice(1);

    // Trigger a slot update that only affects the heading.
    app._live.count = 1;
    app._rerender?.();

    expect(root.firstElementChild).toBe(savedColumn); // root unchanged
    // Heading was rebuilt because its text changed.
    expect(column.children[0]).not.toBe(savedHeading);
    expect(column.children[0].textContent).toBe("Count: 1");
    // Every sibling row survived — SAME element reference.
    for (let i = 0; i < savedRows.length; i++) {
      expect(column.children[i + 1]).toBe(savedRows[i]);
    }

    dispose();
  });

  it("preserves DOM identity for the containing column when only a child changes", () => {
    // The parent column's own data props are unchanged across renders, so the
    // reconcile must recurse into its children instead of rebuilding it.
    const app = makeStripApp({ rows: 3 });
    const { dispose } = mount(app, root);
    const savedColumn = root.firstElementChild;
    app._live.count = 42;
    app._rerender?.();
    expect(root.firstElementChild).toBe(savedColumn);
    dispose();
  });

  it("keeps focus and caret on an input whose subtree was not rebuilt (no snapshot needed)", () => {
    const app = makeStripApp({ rows: 3, withInput: true });
    const { dispose } = mount(app, root);
    const input = root.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = "abc";
    input.focus();
    input.setSelectionRange(2, 2);
    expect(document.activeElement).toBe(input);

    const savedInput = input;
    app._live.count = 1;
    app._rerender?.();

    // Identity of the input element itself must survive — the snapshot layer
    // could only reproduce focus, never element identity, so this asserts that
    // reconcile (not snapshot/restore) is what preserved focus.
    expect(root.querySelector("input")).toBe(savedInput);
    expect(document.activeElement).toBe(savedInput);
    expect(savedInput.selectionStart).toBe(2);
    expect(savedInput.selectionEnd).toBe(2);
    dispose();
  });

  it("rebuilds the whole subtree when child list length changes", () => {
    // Without keys (#188), a length change falls back to a subtree rebuild —
    // the test just locks in that the app does not crash and the new content
    // renders correctly.
    let rows = 2;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => {
        const children: TileNode[] = [];
        for (let i = 0; i < rows; i++) children.push({ kind: "text", text: `row ${i}` });
        return { kind: "column", children };
      },
    };
    const { dispose } = mount(app, root);
    expect(root.querySelectorAll("[data-kumiki-tile='text']").length).toBe(2);
    rows = 4;
    app._rerender?.();
    expect(root.querySelectorAll("[data-kumiki-tile='text']").length).toBe(4);
    const texts = Array.from(root.querySelectorAll("[data-kumiki-tile='text']")).map(
      (el) => el.textContent,
    );
    expect(texts).toEqual(["row 0", "row 1", "row 2", "row 3"]);
    dispose();
  });

  it("still fires tile.mount / tile.unmount lifecycle across the reconcile path", () => {
    // The mount/unmount diff walks the new tree, independent of the DOM diff.
    // The reconcile changes must not disturb that.
    const events: string[] = [];
    let show = true;
    const named = (name: string, child: TileNode): TileNode => ({
      kind: "box",
      children: [child],
      props: { _tile: name },
    });
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [
        lifecycleReducer('tile.mount("Panel")', (s) => {
          events.push("mount");
          return { slots: s, emits: [] };
        }),
        lifecycleReducer('tile.unmount("Panel")', (s) => {
          events.push("unmount");
          return { slots: s, emits: [] };
        }),
      ],
      root: () =>
        show
          ? ({
              kind: "column",
              children: [named("Panel", { kind: "text", text: "p" })],
            } as TileNode)
          : ({ kind: "column", children: [{ kind: "text", text: "p" }] } as TileNode),
    };
    const { dispose } = mount(app, root);
    expect(events).toEqual(["mount"]);
    show = false;
    app._rerender?.();
    expect(events).toEqual(["mount", "unmount"]);
    dispose();
  });

  it("does not multiply-register event listeners on reused DOM nodes", () => {
    // If reconcile re-attached handlers to a reused element, addEventListener-
    // based handlers (`applyUiEventHandlers` in core.ts) would accumulate and a
    // single click would fire N reducers. Prove the count stays at one.
    let clicks = 0;
    const app: AppShape & { _live: { n: number } } = Object.assign(
      {
        slots: { n: { value: 0 } },
        caps: [],
        effects: {},
        init: [],
        reducers: [
          {
            name: "hit",
            event: { kind: "ui", ev: "click" } as const,
            apply: (s: Record<string, unknown>) => {
              clicks++;
              return { slots: { n: (s.n as number) + 1 }, emits: [] };
            },
          },
        ],
        root: (): TileNode => ({
          kind: "column",
          children: [
            { kind: "heading", text: "hdr" },
            {
              kind: "button",
              text: "hit",
              props: {
                onClick: () =>
                  (
                    app as unknown as {
                      _dispatch: (n: string, el: Record<string, unknown>) => void;
                    }
                  )._dispatch("hit", {}),
              },
            },
          ],
        }),
      } as AppShape,
      { _live: { n: 0 } },
    );
    const { dispose } = mount(app, root);
    // Force several re-renders. If reconcile re-attached handlers, each click
    // below would fire once per prior render.
    app._rerender?.();
    app._rerender?.();
    app._rerender?.();
    const btn = root.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(clicks).toBe(1);
    dispose();
  });
});
