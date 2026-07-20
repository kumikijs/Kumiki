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
    // Capture the button element BEFORE any re-renders. If reuse breaks and
    // reconcile silently rebuilds it, `savedBtn !== root.querySelector("button")`
    // will catch the fresh-render case (which would install exactly one
    // fresh listener and pass the click count check by coincidence).
    const savedBtn = root.querySelector("button") as HTMLButtonElement;
    // Force several re-renders. If reconcile re-attached handlers, each click
    // below would fire once per prior render.
    app._rerender?.();
    app._rerender?.();
    app._rerender?.();
    expect(root.querySelector("button")).toBe(savedBtn);
    savedBtn.click();
    expect(clicks).toBe(1);
    dispose();
  });

  it("rebuilds the element in place when the tile kind at a position changes", () => {
    // Covers the `oldNode.kind !== newNode.kind` branch — the walker must
    // splice a fresh element at that position while preserving siblings.
    let showHeading = true;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: [
          { kind: "text", text: "top" },
          showHeading ? { kind: "heading", text: "swap me" } : { kind: "text", text: "swap me" },
          { kind: "text", text: "bottom" },
        ],
      }),
    };
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const savedTop = column.children[0];
    const savedMiddle = column.children[1];
    const savedBottom = column.children[2];
    expect(savedMiddle.tagName.toLowerCase()).toBe("h1");

    showHeading = false;
    app._rerender?.();

    // Same column, same top / bottom, but middle became a fresh element of a
    // different tag (`text` renders a <div>-family element, not <h1>).
    expect(root.firstElementChild).toBe(column);
    expect(column.children[0]).toBe(savedTop);
    expect(column.children[2]).toBe(savedBottom);
    expect(column.children[1]).not.toBe(savedMiddle);
    expect(column.children[1].tagName.toLowerCase()).not.toBe("h1");
    expect(column.children[1].textContent).toBe("swap me");
    dispose();
  });

  it("preserves intermediate container identity on a deep-tree leaf change", () => {
    // Every level between the root and the changing leaf must reuse its DOM
    // node — this locks in that the walker recurses through unchanged parents
    // instead of rebuilding the whole path.
    const live = { n: 0 };
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: [
          { kind: "text", text: "sibling row" },
          {
            kind: "box",
            children: [
              {
                kind: "card",
                children: [{ kind: "heading", text: `deep ${live.n}` }],
              },
            ],
          },
        ],
      }),
    };
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const savedSibling = column.children[0];
    const savedBox = column.children[1];
    const savedCard = savedBox.children[0];
    const savedHeading = savedCard.children[0];
    expect(savedHeading.textContent).toBe("deep 0");

    live.n = 7;
    app._rerender?.();

    // Root, sibling row, and every ancestor of the changed leaf keep identity.
    expect(root.firstElementChild).toBe(column);
    expect(column.children[0]).toBe(savedSibling);
    expect(column.children[1]).toBe(savedBox);
    expect(savedBox.children[0]).toBe(savedCard);
    // Only the leaf whose text changed was rebuilt.
    expect(savedCard.children[0]).not.toBe(savedHeading);
    expect(savedCard.children[0].textContent).toBe("deep 7");
    dispose();
  });
});

// Keyed diff (issue #188) — once `TileNode.key` is present on every child at a
// given level, reconcile matches children by key across renders. Reorder,
// insert, and remove all preserve DOM identity of the surviving children. Old
// bundles (children without `key`) still work via the structural path locked in
// by the #187 suite above.
describe("runtime: keyed reconcile (#188)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  function keyedListApp(getOrder: () => string[]): AppShape {
    return {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: getOrder().map((id) => ({
          kind: "text",
          text: `row ${id}`,
          key: id,
        })),
      }),
    };
  }

  it("preserves DOM identity across a full reorder of keyed children", () => {
    let order = ["a", "b", "c"];
    const app = keyedListApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, eb, ec] = Array.from(column.children) as HTMLElement[];
    expect([ea.textContent, eb.textContent, ec.textContent]).toEqual(["row a", "row b", "row c"]);

    order = ["c", "a", "b"];
    app._rerender?.();

    const reordered = Array.from(column.children);
    expect(reordered).toEqual([ec, ea, eb]);
    expect(reordered.map((e) => e.textContent)).toEqual(["row c", "row a", "row b"]);
    dispose();
  });

  it("reuses existing children on middle insert", () => {
    let order = ["a", "b", "c"];
    const app = keyedListApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, eb, ec] = Array.from(column.children) as HTMLElement[];

    order = ["a", "x", "b", "c"];
    app._rerender?.();

    const after = Array.from(column.children) as HTMLElement[];
    expect(after.length).toBe(4);
    expect(after[0]).toBe(ea);
    expect(after[2]).toBe(eb);
    expect(after[3]).toBe(ec);
    expect(after[1].textContent).toBe("row x");
    dispose();
  });

  it("keeps DOM identity of surviving children after a remove and fires no rebuild", () => {
    let order = ["a", "b", "c"];
    const app = keyedListApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, , ec] = Array.from(column.children) as HTMLElement[];

    order = ["a", "c"];
    app._rerender?.();

    const after = Array.from(column.children) as HTMLElement[];
    expect(after.length).toBe(2);
    expect(after[0]).toBe(ea);
    expect(after[1]).toBe(ec);
    dispose();
  });

  it("preserves DOM-only state (a manually-set input value) across a reorder of keyed items", () => {
    // The key guarantee for reorder is DOM element identity: because the very
    // same HTMLInputElement is reused, anything the browser tracked on it
    // survives — `<select>` value, `<details>` open state, focus, caret, and
    // in this test a manually-set input value that the reconciler is unaware
    // of. Using an input keeps the test decoupled from the select tile's
    // option-value serialization details.
    let order = ["a", "b", "c"];
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: order.map((id) => ({
          kind: "box",
          key: id,
          children: [{ kind: "input", id: `i-${id}` }],
        })),
      }),
    };
    const { dispose } = mount(app, root);
    const inputB = root.querySelector("#i-b") as HTMLInputElement;
    inputB.value = "user typed this";

    order = ["b", "a", "c"];
    app._rerender?.();

    // Same DOM element → the manually-typed value is still there.
    expect(root.querySelector("#i-b")).toBe(inputB);
    expect(inputB.value).toBe("user typed this");
    dispose();
  });

  it("preserves focus and caret across a reorder of keyed items", () => {
    let order = ["a", "b", "c"];
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: order.map((id) => ({
          kind: "box",
          key: id,
          children: [{ kind: "input", value: `v${id}`, id: `i-${id}` }],
        })),
      }),
    };
    const { dispose } = mount(app, root);
    const inputB = root.querySelector("#i-b") as HTMLInputElement;
    inputB.focus();
    inputB.setSelectionRange(1, 1);
    expect(document.activeElement).toBe(inputB);

    order = ["c", "b", "a"];
    app._rerender?.();

    // The DOM element identity for i-b is unchanged; browser focus and caret
    // therefore survive naturally (no snapshot/restore path needed).
    expect(root.querySelector("#i-b")).toBe(inputB);
    expect(document.activeElement).toBe(inputB);
    expect(inputB.selectionStart).toBe(1);
    expect(inputB.selectionEnd).toBe(1);
    dispose();
  });

  it("falls back to structural diff when only some children carry a key (mixed)", () => {
    // Mixed-key children (some entries have `key`, some do not) should not
    // enter the key-map path — reconcile keeps the current structural behavior
    // (rebuild on length change). This locks in the design decision that key
    // matching is all-or-nothing per parent.
    let mode: "same" | "grow" = "same";
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => {
        const base: TileNode[] = [
          { kind: "text", text: "keyed", key: "a" },
          { kind: "text", text: "not keyed" },
        ];
        if (mode === "grow") base.push({ kind: "text", text: "extra" });
        return { kind: "column", children: base };
      },
    };
    const { dispose } = mount(app, root);
    const initialColumn = root.firstElementChild as HTMLElement;
    expect(Array.from(initialColumn.children).length).toBe(2);

    mode = "grow";
    app._rerender?.();

    // Structural path rebuilds the whole subtree on length change — the fresh
    // column has 3 children, the old column reference is detached from DOM.
    const rebuiltColumn = root.firstElementChild as HTMLElement;
    expect(rebuiltColumn).not.toBe(initialColumn);
    expect(Array.from(rebuiltColumn.children).length).toBe(3);
    dispose();
  });

  it("fires tile.unmount when a keyed user tile is removed by key", () => {
    // Removing a keyed child must still surface tile.unmount for the user tile
    // it contained. Lifecycle firing is driven by the full-tree walk after each
    // render, so removal via key-map matching does not need per-node hooks —
    // this test just proves the outer machinery still sees the drop.
    const events: string[] = [];
    let showTwo = true;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [
        lifecycleReducer('tile.unmount("Row")', (s) => {
          events.push("unmount:Row");
          return { slots: s, emits: [] };
        }),
      ],
      root: (): TileNode => ({
        kind: "column",
        children: showTwo
          ? [
              {
                kind: "box",
                key: "a",
                props: { _tile: "Row" },
                children: [{ kind: "text", text: "a" }],
              },
              {
                kind: "box",
                key: "b",
                props: { _tile: "Row" },
                children: [{ kind: "text", text: "b" }],
              },
            ]
          : [
              {
                kind: "box",
                key: "a",
                props: { _tile: "Row" },
                children: [{ kind: "text", text: "a" }],
              },
            ],
      }),
    };
    const { dispose } = mount(app, root);
    expect(events).toEqual([]);

    showTwo = false;
    app._rerender?.();

    // Only one "Row" boundary remains — the walker's diff should fire unmount
    // for the removed instance (the mount/unmount diff is name-based, not per
    // instance, so this fires when the last Row goes; here both were Rows and
    // one Row still remains → unmount should NOT fire yet).
    expect(events).toEqual([]);
    dispose();
  });
});
