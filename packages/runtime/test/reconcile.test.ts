// Tile-level keyed diff (issue #187) — behavioural regression suite for the
// renderer's reconcile path. These tests drive the runtime through `mount()`;
// what they lock in is *DOM node identity across re-render*: sibling tiles that
// did not change must keep the very same HTMLElement instance, so focus / caret
// / <select> state / event listeners survive a slot update without going
// through the snapshot-restore fallback (which only exists as a safety net for
// tiles that DID change).

import type { AppShape, Episode, EpisodeLogger, ReducerSpec, TileNode } from "@kumikijs/runtime";
import { createEpisodeLogger, mount } from "@kumikijs/runtime";
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
    // #190: identity-preserving reconciliation. The heading's text prop
    // changed, but the per-kind patcher mutates .textContent in place and
    // returns the same HTMLElement — no more subtree teardown for a leaf
    // data-prop change. Pre-#190 this asserted `not.toBe` (rebuild path).
    expect(column.children[0]).toBe(savedHeading);
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
    // #190: leaf-tile data-prop change is patched in place, so element
    // identity is preserved. Pre-#190 this asserted `not.toBe` (rebuild).
    expect(savedCard.children[0]).toBe(savedHeading);
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

  it("keyed removal of one instance does NOT fire tile.unmount when another same-named tile remains (mount/unmount is name-based, not per-instance)", () => {
    // Lock in the current name-based lifecycle semantics: removing one keyed
    // Row while another Row is still mounted keeps the name in the mounted
    // set → unmount does NOT fire. If we ever move to per-instance lifecycle
    // this assertion must change accordingly.
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

    expect(events).toEqual([]);
    dispose();
  });

  it("fires tile.unmount when the last instance of a keyed user tile is removed", () => {
    // Complement to the "one of many" test above: removing the LAST Row
    // takes the name out of the mounted set, so tile.unmount(Row) must fire.
    // Proves the keyed removal path is not silently dropping the lifecycle
    // signal that the outer render-pass walk needs to observe.
    const events: string[] = [];
    let showRow = true;
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
        children: showRow
          ? [
              {
                kind: "box",
                key: "a",
                props: { _tile: "Row" },
                children: [{ kind: "text", text: "a" }],
              },
            ]
          : [{ kind: "text", text: "empty", key: "placeholder" }],
      }),
    };
    const { dispose } = mount(app, root);
    expect(events).toEqual([]);

    showRow = false;
    app._rerender?.();

    expect(events).toEqual(["unmount:Row"]);
    dispose();
  });

  it("panics on duplicate sibling keys (loud fallback, not silent DOM collapse)", () => {
    // Two children with the same key would collapse into one DOM element
    // silently — a bug class the outer bailout must at least surface. The
    // reconciler throws, the outer render pass catches, records a
    // 'reconcile' panic, and does a full rebuild. We only need to observe
    // that the app does not crash and that DOM shape reflects the new tree.
    let dupe = false;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: dupe
          ? [
              { kind: "text", text: "a1", key: "a" },
              { kind: "text", text: "a2", key: "a" },
            ]
          : [{ kind: "text", text: "start", key: "s" }],
      }),
    };
    const consoleError = console.error;
    const suppressed: unknown[] = [];
    console.error = (...args: unknown[]) => {
      suppressed.push(args);
    };
    try {
      const { dispose } = mount(app, root);
      dupe = true;
      app._rerender?.();
      // Both duplicated children must actually be present after the outer
      // rebuild — full rebuild renders them positionally.
      const column = root.firstElementChild as HTMLElement;
      expect(column.children.length).toBe(2);
      expect(column.children[0].textContent).toBe("a1");
      expect(column.children[1].textContent).toBe("a2");
      // And the reconcile threw — the outer panic path logged it.
      expect(suppressed.length).toBeGreaterThan(0);
      dispose();
    } finally {
      console.error = consoleError;
    }
  });

  it("panics when a keyed tile's key is empty / null / undefined (compiler-side helper enforcement)", () => {
    // Direct assertion of the invariant the compiler's `_wk` helper enforces.
    // Runtime constructing a TileNode with an empty key manually is a bug —
    // we prove the reconciler's own duplicate-detection path fires (empty
    // strings collide when siblings coincide, but even a single "" is a
    // programmer error). This test locks the runtime-side signal; the
    // compiler side is covered by _wk itself which throws before emitting.
    let broken = false;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: broken
          ? [
              { kind: "text", text: "x", key: "" },
              { kind: "text", text: "y", key: "" },
            ]
          : [{ kind: "text", text: "start", key: "s" }],
      }),
    };
    const consoleError = console.error;
    const suppressed: unknown[] = [];
    console.error = (...args: unknown[]) => {
      suppressed.push(args);
    };
    try {
      const { dispose } = mount(app, root);
      broken = true;
      app._rerender?.();
      // Bailout renders both children — no silent collapse.
      const column = root.firstElementChild as HTMLElement;
      expect(column.children.length).toBe(2);
      expect(suppressed.length).toBeGreaterThan(0);
      dispose();
    } finally {
      console.error = consoleError;
    }
  });
});

// -----------------------------------------------------------------------------
// #189: episode `signal-update` step's `binds-updated` is populated from the
// tiles / binds the keyed diff (#187) actually patched. Same fixture pattern as
// the reconcile tests above, but each case dispatches a reducer through the
// `_dispatch` seam so the outer `applyReducer` fires a trailing `signal-update`
// step that we can inspect on the logger.

type DispatchApp = AppShape & {
  _dispatch: (name: string, el: Record<string, unknown>) => void;
};

function makeLogger(): { logger: EpisodeLogger; committed: Episode[] } {
  const committed: Episode[] = [];
  let t = 1000;
  let seq = 0;
  const logger = createEpisodeLogger({
    now: () => ++t,
    idGen: () => `ep_${(seq++).toString().padStart(4, "0")}`,
    onEpisode: (ep) => committed.push(ep),
  });
  return { logger, committed };
}

/** Extract the `binds-updated` list from the last committed episode. */
function lastBindsUpdated(committed: Episode[]): string[] | undefined {
  const ep = committed[committed.length - 1];
  if (!ep) return undefined;
  for (let i = ep.steps.length - 1; i >= 0; i--) {
    const s = ep.steps[i];
    if (s && s.kind === "signal-update") return s["binds-updated"];
  }
  return undefined;
}

describe("runtime: episode binds-updated wiring (#189)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("populates binds-updated with only the tiles the diff rebuilt", () => {
    // The static rows are reused; only the heading is rebuilt. `binds-updated`
    // must list "heading" alone — proving the log distinguishes "changed" from
    // "unchanged" at the granularity of what the diff actually touched.
    const app = makeStripApp({ rows: 5 }) as unknown as DispatchApp;
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    app._dispatch("bump", {});

    expect(lastBindsUpdated(committed)).toEqual(["heading"]);
    dispose();
  });

  it("emits the bind expression (bind + bindPath joined) for a rebuilt form control", () => {
    // Same shape as data-kumiki-bind, so an authored `bind=todo.title` shows up
    // as the same "todo.title" identifier a reader would see in the DOM.
    let bindPath = ["title"];
    let value = "initial";
    const app: AppShape = {
      slots: { flip: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "flip",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            value = "changed";
            return { slots: { flip: ((s.flip as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: [{ kind: "input", bind: "todo", bindPath, value }],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("flip", {});
    expect(lastBindsUpdated(committed)).toEqual(["todo.title"]);

    // A bind without a bindPath collapses to just the bind name.
    bindPath = [];
    value = "again";
    (app as unknown as DispatchApp)._dispatch("flip", {});
    expect(lastBindsUpdated(committed)).toEqual(["todo"]);
    dispose();
  });

  it("emits the key for a keyed-diff fresh insert (and not the survivors)", () => {
    let items: Array<{ id: string; text: string }> = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ];
    const app: AppShape = {
      slots: { rev: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "append",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            items = [...items, { id: "c", text: "C" }];
            return { slots: { rev: ((s.rev as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: items.map(
          (it): TileNode => ({ kind: "text", text: it.text, key: it.id }) as TileNode,
        ),
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("append", {});

    // Only the newly-mounted "c" child fires — "a" / "b" are keyed survivors
    // and pass through reconcileNode without hitting a rebuild path.
    expect(lastBindsUpdated(committed)).toEqual(["c"]);
    dispose();
  });

  it("emits an empty binds-updated when the dirty slot did not change the tile tree", () => {
    // The reducer writes a slot but the `root()` closure returns identical data
    // — reconcile walks the tree, finds no differences, rebuilds nothing.
    const app: AppShape = {
      slots: { hidden: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "touchHidden",
          event: { kind: "ui", ev: "click" },
          apply: (s) => ({ slots: { hidden: ((s.hidden as number) ?? 0) + 1 }, emits: [] }),
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: [{ kind: "text", text: "static" }],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("touchHidden", {});

    // dirty-slots still records the write; binds-updated is empty because the
    // diff found nothing visible to patch.
    const ep = committed[committed.length - 1]!;
    const step = ep.steps.find((s) => s.kind === "signal-update") as
      | { "dirty-slots": string[]; "binds-updated": string[] }
      | undefined;
    expect(step).toBeDefined();
    expect(step!["dirty-slots"]).toEqual(["hidden"]);
    expect(step!["binds-updated"]).toEqual([]);
    dispose();
  });

  it("emits the new tile's identifier when the kind at a position changes", () => {
    // Directly exercises the `oldNode.kind !== newNode.kind` branch of
    // reconcileNode. The rebuilt element carries the NEW kind, which is what
    // shows up in binds-updated — the log describes what was mounted, not
    // what was thrown away.
    let showHeading = true;
    const app: AppShape = {
      slots: { swap: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "swap",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            showHeading = !showHeading;
            return { slots: { swap: ((s.swap as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: [
          { kind: "text", text: "top" },
          showHeading ? { kind: "heading", text: "swap" } : { kind: "text", text: "swap" },
          { kind: "text", text: "bottom" },
        ],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("swap", {});

    // heading → text: the incoming tile is `text`; siblings unchanged and
    // do not appear.
    expect(lastBindsUpdated(committed)).toEqual(["text"]);
    dispose();
  });

  it("emits just the bind name when bindPath is absent (not just empty array)", () => {
    // `bindPath === undefined` is a distinct branch from `bindPath === []` —
    // both must collapse to the bare bind name. Codegen omits the field
    // entirely for a bare `bind=note` input, so this is the common shape.
    let value = "initial";
    const app: AppShape = {
      slots: { flip: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "flip",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            value = "changed";
            return { slots: { flip: ((s.flip as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: [{ kind: "input", bind: "note", value }],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("flip", {});
    expect(lastBindsUpdated(committed)).toEqual(["note"]);
    dispose();
  });

  it("leaves binds-updated empty when reconcile throws and full-render bails out", () => {
    // Regression guard: reconcile's local `touched` accumulator lives inside
    // `reconcileTree` — a throw partway through (here: duplicate sibling keys
    // in `reconcileKeyedChildren`) drops the array on the floor, so
    // `lastRenderTouched` in `renderPass` is never assigned and stays at the
    // `[]` reset. The episode step records `binds-updated: []` alongside the
    // panic step. A future refactor that leaks partial touched IDs across the
    // bailout would fail this test.
    let broken = false;
    const app: AppShape = {
      slots: { rev: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "breakIt",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            broken = true;
            return { slots: { rev: ((s.rev as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: broken
          ? [
              { kind: "text", text: "a", key: "dup" },
              { kind: "text", text: "b", key: "dup" },
            ]
          : [{ kind: "text", text: "start", key: "s" }],
      }),
    };
    const { logger, committed } = makeLogger();
    const consoleError = console.error;
    const suppressed: unknown[] = [];
    console.error = (...args: unknown[]) => {
      suppressed.push(args);
    };
    try {
      const { dispose } = mount(app, root, { episodeLogger: logger });
      (app as unknown as DispatchApp)._dispatch("breakIt", {});
      expect(lastBindsUpdated(committed)).toEqual([]);
      // The reconcile bailout also records a panic step — evidence the throw
      // path was actually taken, not sidestepped.
      const ep = committed[committed.length - 1]!;
      expect(ep.steps.some((s) => s.kind === "panic")).toBe(true);
      dispose();
    } finally {
      console.error = consoleError;
    }
  });

  it("dedups identifiers when multiple rebuilt subtrees share an identifier", () => {
    // Two <text> tiles at different positions both change → each is a separate
    // rebuild, but the identifier ("text") collapses to a single entry in the
    // log so the field stays a small, human-scannable set.
    let n = 0;
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "bump",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            n += 1;
            return { slots: { n: ((s.n as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: [
          { kind: "text", text: `top ${n}` },
          { kind: "text", text: "static" },
          { kind: "text", text: `bottom ${n}` },
        ],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("bump", {});

    expect(lastBindsUpdated(committed)).toEqual(["text"]);
    dispose();
  });
});

// Per-kind identity-preserving patch (#190). These lock in the invariant
// that a same-kind tile whose data props diverge is reconciled in place —
// the mounted HTMLElement is reused across the render, so browser-owned
// state (`<select>` open, `<video>` playback, `<details>` open,
// contenteditable caret) survives what pre-#190 was a full teardown +
// createElement + replaceChild cycle.
describe("runtime: identity-preserving patch (#190)", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  // A minimal single-slot app whose root() returns whatever `treeFn` produces —
  // used across the suite so each per-kind test can focus on one tile.
  function drive(treeFn: (s: Record<string, unknown>) => TileNode): {
    app: AppShape;
    dispose: () => void;
  } {
    const live: Record<string, unknown> = { n: 0 };
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: () => treeFn(live),
    };
    const rerender = { fn: undefined as (() => void) | undefined };
    // Expose a setter for `n` that also re-renders — tests just call `bump()`.
    const { dispose } = mount(app, root);
    rerender.fn = app._rerender;
    return {
      app: Object.assign(app, {
        _live: live,
        bump: () => {
          live.n = (live.n as number) + 1;
          rerender.fn?.();
        },
      }) as AppShape & { _live: Record<string, unknown>; bump: () => void },
      dispose,
    };
  }

  it("select: DOM identity + a browser-marked open-index survives when the options list is patched", () => {
    const { app, dispose } = drive((s) => ({
      kind: "column",
      children: [
        {
          kind: "select",
          value: "b",
          // On tick 0 → 3 options; on tick 1 → 4 (extra option appended).
          options:
            (s.n as number) === 0
              ? [
                  { label: "A", value: "a" },
                  { label: "B", value: "b" },
                  { label: "C", value: "c" },
                ]
              : [
                  { label: "A", value: "a" },
                  { label: "B", value: "b" },
                  { label: "C", value: "c" },
                  { label: "D", value: "d" },
                ],
        },
      ],
    }));
    const sel = root.querySelector("select") as HTMLSelectElement;
    expect(sel).toBeTruthy();
    // Seed a dataset marker the runtime never writes — its survival across
    // the rerender is direct evidence that the same HTMLSelectElement was
    // reused (pre-#190 the select was destroyed and rebuilt on any
    // `options` change, and this marker would vanish).
    sel.dataset.probe = "seeded";
    const optionsBefore = sel.options.length;
    expect(optionsBefore).toBe(3);

    (app as unknown as { bump: () => void }).bump();

    const selAfter = root.querySelector("select") as HTMLSelectElement;
    expect(selAfter).toBe(sel);
    expect(selAfter.dataset.probe).toBe("seeded");
    expect(selAfter.options.length).toBe(4);
    // Value carries across the options change.
    expect(selAfter.value).toBe(JSON.stringify("b"));
    dispose();
  });

  it("input: element identity preserved on a value change; a stale-marker survives", () => {
    const { app, dispose } = drive((s) => ({
      kind: "input",
      value: `v${s.n}`,
    }));
    const inp = root.querySelector("input") as HTMLInputElement;
    inp.dataset.probe = "seeded";
    expect(inp.value).toBe("v0");
    (app as unknown as { bump: () => void }).bump();
    const inpAfter = root.querySelector("input") as HTMLInputElement;
    expect(inpAfter).toBe(inp);
    expect(inpAfter.dataset.probe).toBe("seeded");
    expect(inpAfter.value).toBe("v1");
    dispose();
  });

  it("video: element identity preserved when `controls` flips", () => {
    const { app, dispose } = drive((s) => ({
      kind: "video",
      src: "/demo.mp4",
      controls: (s.n as number) % 2 === 1,
    }));
    const v = root.querySelector("video") as HTMLVideoElement;
    v.dataset.probe = "seeded";
    expect(v.controls).toBe(false);
    (app as unknown as { bump: () => void }).bump();
    const vAfter = root.querySelector("video") as HTMLVideoElement;
    expect(vAfter).toBe(v);
    expect(vAfter.dataset.probe).toBe("seeded");
    expect(vAfter.controls).toBe(true);
    dispose();
  });

  it("details: element identity preserved when the summary changes; native .open persists", () => {
    const { app, dispose } = drive((s) => ({
      kind: "details",
      summary: `count ${s.n}`,
      children: [{ kind: "text", text: "panel" }],
    }));
    const det = root.querySelector("details") as HTMLDetailsElement;
    det.open = true;
    det.dataset.probe = "seeded";
    (app as unknown as { bump: () => void }).bump();
    const detAfter = root.querySelector("details") as HTMLDetailsElement;
    expect(detAfter).toBe(det);
    expect(detAfter.open).toBe(true);
    expect(detAfter.dataset.probe).toBe("seeded");
    expect(detAfter.querySelector("summary")?.textContent).toBe("count 1");
    dispose();
  });

  it("editable: element identity preserved on an unrelated slot bump; textContent survives", () => {
    const { app, dispose } = drive((s) => ({
      kind: "column",
      children: [
        { kind: "editable", text: "hello", id: "e" },
        { kind: "text", text: `n=${s.n}` },
      ],
    }));
    const div = root.querySelector("#e") as HTMLDivElement;
    expect(div.contentEditable).toBe("true");
    div.dataset.probe = "seeded";
    (app as unknown as { bump: () => void }).bump();
    const divAfter = root.querySelector("#e") as HTMLDivElement;
    expect(divAfter).toBe(div);
    expect(divAfter.dataset.probe).toBe("seeded");
    expect(divAfter.textContent).toBe("hello");
    dispose();
  });

  it("binds-updated records the patched tile's identifier", () => {
    // A slot bump changes the input's `value` — reconcile takes the patch
    // path, and `tileTouchedId` is still pushed so the causal chain
    // `slot n → binds-updated ["field"]` lands in the episode log.
    const live: Record<string, unknown> = { n: 0 };
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "bump",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            live.n = ((s.n as number) ?? 0) + 1;
            return { slots: { n: live.n }, emits: [] };
          },
        },
      ],
      root: () => ({
        kind: "column",
        children: [{ kind: "input", bind: "field", value: `v${live.n}` }],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });
    (app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void })._dispatch(
      "bump",
      {},
    );
    expect(lastBindsUpdated(committed)).toContain("field");
    dispose();
  });
});
