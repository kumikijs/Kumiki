// Tile-level keyed diff (issue #187) — behavioural regression suite for the
// renderer's reconcile path. These tests drive the runtime through `mount()`;
// what they lock in is *DOM node identity across re-render*: sibling tiles that
// did not change must keep the very same HTMLElement instance, so focus / caret
// / <select> state / event listeners survive a slot update without going
// through the snapshot-restore fallback (which only exists as a safety net for
// tiles that DID change).

import type {
  AppShape,
  Episode,
  EpisodeLogger,
  ReducerSpec,
  TileNode,
  TileRenderers,
} from "@kumikijs/runtime";
import {
  collectionTiles,
  createEpisodeLogger,
  inputTiles,
  layoutTiles,
  mediaTiles,
  mount,
  mountCore,
  overlayTiles,
  statusTiles,
  textTiles,
} from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WRAPPING_TILE_KINDS } from "../src/core.ts";

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

  /** A keyed column whose whole child list is swapped by one dispatch. */
  function listSwapApp(before: string[], after: string[]): AppShape {
    let items = before;
    return {
      slots: { rev: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "swap",
          event: { kind: "ui", ev: "click" },
          apply: (s) => {
            items = after;
            return { slots: { rev: ((s.rev as number) ?? 0) + 1 }, emits: [] };
          },
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        children: items.map((id): TileNode => ({ kind: "text", text: id, key: id })),
      }),
    };
  }

  it("emits each freshly mounted child when a list grows from empty", () => {
    // Same granularity as a keyed insert: each new child is the root of a
    // subtree that was just mounted, and the parent kept its element.
    const app = listSwapApp([], ["a", "b", "c"]);
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("swap", {});

    expect(lastBindsUpdated(committed)).toEqual(["a", "b", "c"]);
    dispose();
  });

  it("emits the parent when a list is cleared to empty", () => {
    // Per-child would give `[]` here — indistinguishable from "the diff found
    // nothing to do", for a render that visibly emptied the DOM. The parent is
    // what changed, and it is what the rebuild path used to report.
    const app = listSwapApp(["a", "b"], []);
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });
    expect(root.firstElementChild?.children.length).toBe(2);

    (app as unknown as DispatchApp)._dispatch("swap", {});

    expect(root.firstElementChild?.children.length).toBe(0);
    expect(lastBindsUpdated(committed)).toEqual(["column"]);
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

  it("input: bind swap A→B routes new writes to the new slot (INPUT_STATE handler slot refresh)", () => {
    // #190 handler-slot pattern: on the patch path, the input's native
    // `input` listener stays the same but dispatches through the WeakMap
    // slot, so `bind` swapping to a different slot after a data-prop patch
    // must land the next keystroke in the NEW slot. Pre-#190 (full rebuild
    // path) this always worked because the listener was re-created; the
    // handler-slot pattern preserves that guarantee across in-place patch.
    let bind: "a" | "b" = "a";
    const live: Record<string, unknown> = { a: "", b: "" };
    const app: AppShape = {
      slots: { a: { value: "" }, b: { value: "" } },
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: () => ({
        kind: "input",
        bind,
        // `placeholder` diverges so `tileFieldsEqual` is false → patch runs.
        placeholder: bind === "a" ? "first" : "second",
      }),
    };
    // Mirror slot writes into `live` so the next render reads the new value.
    const original = mount(app, root);
    const setSlot = (app as unknown as { _setSlot: (name: string, value: unknown) => void })
      ._setSlot;
    (app as unknown as { _setSlot: (name: string, value: unknown) => void })._setSlot = (
      name,
      value,
    ) => {
      live[name] = value;
      (app as unknown as Record<string, Record<string, unknown>>).live[name] = value;
      setSlot(name, value);
    };
    const inp = root.querySelector("input") as HTMLInputElement;
    // Simulate user typing "x" while bound to slot `a`.
    inp.value = "x";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    // Swap the bind + re-render (data-prop change → patch, NOT rebuild).
    bind = "b";
    app._rerender?.();
    const inpAfter = root.querySelector("input") as HTMLInputElement;
    // Identity preserved by the patch path.
    expect(inpAfter).toBe(inp);
    // New keystroke should now write to slot `b`.
    inpAfter.value = "y";
    inpAfter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(live.b).toBe("y");
    // And slot `a` still holds the previous "x" (never overwritten by the
    // post-swap listener despite listener identity being unchanged).
    expect(live.a).toBe("x");
    original.dispose();
  });

  it("applyStateStyles: repeated patch does not grow data-kumiki-state or the shared stylesheet", () => {
    // Pre-fix each patch appended a fresh token + a fresh rule; the element
    // attribute and the `<style id=kumiki-state-styles>` node both grew
    // unboundedly. Idempotency guard collapses identical re-applications to
    // a no-op; a real state-prop change is still allowed.
    const app: AppShape = {
      slots: { n: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "bump",
          event: { kind: "ui", ev: "click" },
          apply: (s) => ({ slots: { n: ((s.n as number) ?? 0) + 1 }, emits: [] }),
        },
      ],
      root: (): TileNode => ({
        kind: "column",
        // `hover` is a state-style prop; children carry a text tile whose
        // content diverges on every dispatch so the parent's patcher runs.
        props: { hover: { bg: "red" } } as unknown as Record<string, unknown>,
        children: [
          {
            kind: "text",
            text: `n=${((app as unknown as Record<string, Record<string, unknown>>).live?.n as number) ?? 0}`,
          },
        ],
      }),
    };
    const { dispose } = mount(app, root);
    const col = root.firstElementChild as HTMLElement;
    const stateBefore = col.dataset.kumikiState;
    expect(stateBefore).toBeTruthy();
    const styleEl = document.getElementById("kumiki-state-styles");
    const rulesBefore = styleEl?.childNodes.length ?? 0;
    // Kick 10 dispatches; every one triggers the parent patcher.
    for (let i = 0; i < 10; i++) {
      (app as unknown as { _dispatch: (n: string, p: Record<string, unknown>) => void })._dispatch(
        "bump",
        {},
      );
    }
    // Same token; no growth on the shared stylesheet either.
    expect(col.dataset.kumikiState).toBe(stateBefore);
    expect(styleEl?.childNodes.length ?? 0).toBe(rulesBefore);
    dispose();
  });

  it("list: `ordered` flip declines the in-place patch WITHOUT recording a reconcile panic", () => {
    // `PatchRequiresRebuild` is a controlled escape hatch — the outer
    // reconcile catches it specifically and falls back to a subtree rebuild
    // WITHOUT calling `episode.recordPanic`, so a legitimate `<ul>` ↔ `<ol>`
    // flip does not pollute the episode log. Raw throws still panic (locked
    // in by the "reconcile bailout records a panic" test elsewhere).
    let ordered = false;
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "list",
        ordered,
        children: [{ kind: "list-item", children: [{ kind: "text", text: "one" }] }],
      }),
    };
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });
    expect((root.firstElementChild as HTMLElement).tagName).toBe("UL");
    ordered = true;
    app._rerender?.();
    expect((root.firstElementChild as HTMLElement).tagName).toBe("OL");
    // No panic step recorded — the sentinel path skipped `episode.recordPanic`.
    for (const ep of committed) {
      expect(ep.steps.some((s) => s.kind === "panic")).toBe(false);
    }
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

describe("runtime: reconcile child-placement contract", () => {
  // The keyed child pass takes ownership of its children's DOM slots: it moves
  // survivors with `parentEl.appendChild` and drops unmatched ones with
  // `parentEl.removeChild`. Both only address elements the parent element holds
  // DIRECTLY. `overlay` breaks that: children 1..N are each wrapped in an
  // absolutely-positioned `overlay-layer` div, so the element the reconciler
  // has mapped for a child is a grandchild of the overlay. Taking the keyed
  // path there tears children out of their layer (destroying the stacking) and
  // strands the emptied layer divs in the DOM. The walker must recognise that
  // it does not own those slots and fall back to the structural walk, whose
  // rebuild path re-enters the renderer and re-wraps correctly.
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  function overlayLayersApp(getOrder: () => string[]): AppShape {
    return {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      // Every child keyed → the keyed gate would fire if placement were not
      // checked. Mirrors `overlay(for l in layers Layer(l))`, where the
      // compiler stamps an implicit key on each iteration's tile.
      root: (): TileNode => ({
        kind: "overlay",
        props: { align: "center" },
        children: getOrder().map((id) => ({
          kind: "text",
          text: `layer ${id}`,
          key: id,
        })),
      }),
    };
  }

  const layerDivs = (overlay: HTMLElement): HTMLElement[] =>
    Array.from(overlay.children).filter(
      (c) => (c as HTMLElement).dataset.kumikiTile === "overlay-layer",
    ) as HTMLElement[];

  it("keeps wrapped children inside their overlay layer across a reorder", () => {
    let order = ["a", "b", "c"];
    const app = overlayLayersApp(() => order);
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    // child[0] is the base layer (in normal flow); [1] and [2] are wrapped.
    expect(overlay.children.length).toBe(3);
    expect(layerDivs(overlay).length).toBe(2);

    order = ["c", "a", "b"];
    app._rerender?.();

    // Structure is intact: still one base child + two positioned layers, and
    // every layer still holds exactly the one tile element it wraps.
    expect(overlay.children.length).toBe(3);
    const layers = layerDivs(overlay);
    expect(layers.length).toBe(2);
    for (const layer of layers) {
      expect(layer.children.length).toBe(1);
      expect(layer.style.position).toBe("absolute");
    }
    // No tile element escaped its wrapper onto the overlay itself.
    expect((overlay.children[0] as HTMLElement).dataset.kumikiTile).toBe("text");
    expect(overlay.textContent).toContain("layer c");
    expect(overlay.textContent).toContain("layer a");
    expect(overlay.textContent).toContain("layer b");
    dispose();
  });

  it("leaves no stranded overlay layer when a wrapped keyed child is removed", () => {
    let order = ["a", "b", "c"];
    const app = overlayLayersApp(() => order);
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    expect(layerDivs(overlay).length).toBe(2);

    order = ["a", "c"];
    app._rerender?.();

    // Two children now → one base + exactly one layer. An emptied wrapper left
    // behind would show up either as a third child or as a childless layer.
    const after = root.firstElementChild as HTMLElement;
    expect(after.children.length).toBe(2);
    const layers = layerDivs(after);
    expect(layers.length).toBe(1);
    expect(layers[0]?.children.length).toBe(1);
    expect(after.textContent).toContain("layer a");
    expect(after.textContent).toContain("layer c");
    expect(after.textContent).not.toContain("layer b");
    dispose();
  });

  it("re-wraps correctly when a wrapped keyed list grows", () => {
    // Growth lands on the structural walk's rebuild path (the length changed
    // and the keyed matcher already stood down), so the overlay renderer runs
    // again from scratch. What must come back is the same shape: one base
    // child in normal flow plus one positioning layer per remaining tile.
    let order = ["a", "b", "c"];
    const app = overlayLayersApp(() => order);
    const { dispose } = mount(app, root);
    expect(layerDivs(root.firstElementChild as HTMLElement).length).toBe(2);

    order = ["a", "b", "c", "d"];
    app._rerender?.();

    const after = root.firstElementChild as HTMLElement;
    expect(after.children.length).toBe(4);
    const layers = layerDivs(after);
    expect(layers.length).toBe(3);
    for (const layer of layers) {
      expect(layer.children.length).toBe(1);
      expect(layer.style.position).toBe("absolute");
    }
    expect(after.textContent).toContain("layer d");
    dispose();
  });

  it("splices a rebuilt wrapped child into its wrapper, not onto the parent", () => {
    // The structural walk discards `reconcileNode`'s return value because
    // `replaceWithFreshTile` has already spliced the new element in — anchored
    // on the OLD element's parent, which under `overlay` is the layer div. An
    // anchor taken from the parent tile's element instead would put the fresh
    // element directly on the overlay and empty the layer, and every other
    // assertion in this file would still pass.
    let secondKind: "text" | "heading" = "text";
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "overlay",
        children: [
          { kind: "text", text: "base", key: "a" },
          { kind: secondKind, text: "wrapped", key: "b" },
        ],
      }),
    };
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    const layer = layerDivs(overlay)[0] as HTMLElement;
    expect(layer.children.length).toBe(1);

    // A kind change is the one path that always rebuilds, so this exercises
    // the splice without depending on which patcher is registered.
    secondKind = "heading";
    app._rerender?.();

    // Same layer element, now holding the rebuilt tile — and the overlay still
    // has exactly its base child plus that layer.
    expect(layerDivs(overlay)[0]).toBe(layer);
    expect(layer.children.length).toBe(1);
    expect((layer.children[0] as HTMLElement).tagName).toBe("H1");
    expect(overlay.children.length).toBe(2);
    dispose();
  });

  it("still takes the keyed path when the parent places its children directly", () => {
    // Guard against the placement check over-triggering: `column` appends
    // children directly, so keyed reuse across a reorder must be unaffected.
    let order = ["a", "b", "c"];
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: order.map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
      }),
    };
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, eb, ec] = Array.from(column.children) as HTMLElement[];

    order = ["c", "a", "b"];
    app._rerender?.();

    expect(Array.from(column.children)).toEqual([ec, ea, eb]);
    dispose();
  });
});

// -----------------------------------------------------------------------------
// Empty-side child lists. A parent whose child list is empty on exactly one side
// of a render has nothing to match — not by key, not by position. Every new
// child is a fresh mount and every old child departs, so the only question left
// is WHERE the new children go, and the answer belongs to the parent's renderer
// (`overlay` wraps every child after the first in a positioning layer; the
// surfaces wrap all of theirs in a content div). With no mounted child left, the
// placement probe that normally answers that has nothing to testify with — which
// is why the walker re-enters the renderer for a fresh interior and moves that
// into the element it is keeping, instead of rebuilding the parent.

function emptySideApp(root: () => TileNode): AppShape {
  return { slots: {}, caps: [], effects: {}, init: [], reducers: [], root };
}

const overlayLayerDivs = (el: HTMLElement): HTMLElement[] =>
  Array.from(el.children).filter(
    (c) => (c as HTMLElement).dataset.kumikiTile === "overlay-layer",
  ) as HTMLElement[];

describe("runtime: child lists that are empty on one side", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  function rowsApp(getOrder: () => string[], kind: TileNode["kind"] = "column"): AppShape {
    return emptySideApp(
      () =>
        ({
          kind,
          summary: "disclosure",
          children: getOrder().map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
        }) as TileNode,
    );
  }

  it("keeps the parent element and mounts only the new children when a list grows from empty", () => {
    let order: string[] = [];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    expect(column.children.length).toBe(0);

    order = ["a", "b", "c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(Array.from(column.children).map((e) => e.textContent)).toEqual([
      "row a",
      "row b",
      "row c",
    ]);
    dispose();
  });

  it("keeps the parent element when a keyed list is cleared to empty", () => {
    let order = ["a", "b", "c"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    expect(column.children.length).toBe(3);

    order = [];
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(column.children.length).toBe(0);
    dispose();
  });

  it("preserves the parent's browser-owned state across a clear and a refill", () => {
    // happy-dom has no layout, so `scrollTop` cannot stand in for "the element
    // survived". A seeded expando can: it lives on the instance and dies with
    // it, which is exactly the thing the rebuild path used to take away.
    let order = ["a", "b"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    column.dataset.probe = "seeded";

    order = [];
    app._rerender?.();
    order = ["c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(column.dataset.probe).toBe("seeded");
    expect(column.textContent).toBe("row c");
    dispose();
  });

  it("wraps the new children through the parent's renderer when the old list was empty", () => {
    // The hazard the whole design turns on. `overlay` places child[0] in normal
    // flow and wraps the rest in absolutely-positioned layers. Appending the new
    // children straight onto the overlay — which is what the keyed pass does,
    // and what an "empty lists are keyed" one-liner would have let it do here —
    // produces three bare siblings and no stacking at all.
    let order: string[] = [];
    const app = rowsApp(() => order, "overlay");
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;

    order = ["a", "b", "c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(overlay);
    expect(overlay.children.length).toBe(3);
    const layers = overlayLayerDivs(overlay);
    expect(layers.length).toBe(2);
    for (const layer of layers) {
      expect(layer.children.length).toBe(1);
      expect(layer.style.position).toBe("absolute");
    }
    expect((overlay.children[0] as HTMLElement).dataset.kumikiTile).toBe("text");
    expect(overlay.textContent).toBe("row arow brow c");
    dispose();
  });

  it("clears a wrapped list without stranding its layers", () => {
    let order = ["a", "b", "c"];
    const app = rowsApp(() => order, "overlay");
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    expect(overlayLayerDivs(overlay).length).toBe(2);

    order = [];
    app._rerender?.();

    expect(root.firstElementChild).toBe(overlay);
    expect(overlay.children.length).toBe(0);
    dispose();
  });

  it.each([
    "modal",
    "drawer",
    "popover",
  ] as const)("fills a %s through its content wrapper, not onto the surface itself", (kind) => {
    // The surfaces wrap ALL of their children, so unlike `overlay` they are
    // caught by the placement measurement the moment one child is mounted —
    // but at zero there is nothing to measure, and this is the path that
    // decides where the first ones land.
    let order: string[] = [];
    const app = rowsApp(() => order, kind);
    const { dispose } = mount(app, root);
    const surface = root.firstElementChild as HTMLElement;

    order = ["a", "b"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(surface);
    const content = surface.children[0] as HTMLElement;
    expect(content.dataset.kumikiTile).toBe(`${kind}-content`);
    expect(surface.children.length).toBe(1);
    expect(Array.from(content.children).map((e) => e.textContent)).toEqual(["row a", "row b"]);
    dispose();
  });

  it("rebuilds the renderer's own interior alongside the children", () => {
    // `details` owns a `<summary>` that is not a tile child. Emptying `oldEl`
    // and appending the new children would drop it; re-entering the renderer
    // brings it back, and `open` rides on the retained element itself.
    let order = ["a", "b"];
    const app = rowsApp(() => order, "details");
    const { dispose } = mount(app, root);
    const det = root.firstElementChild as HTMLDetailsElement;
    det.open = true;

    order = [];
    app._rerender?.();

    expect(root.firstElementChild).toBe(det);
    expect(det.open).toBe(true);
    expect(det.querySelector("summary")?.textContent).toBe("disclosure");

    order = ["c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(det);
    expect(det.open).toBe(true);
    expect(det.querySelector("summary")?.textContent).toBe("disclosure");
    expect(det.textContent).toBe("disclosurerow c");
    dispose();
  });

  it("keeps a <ul> across a list that fills from empty", () => {
    let order: string[] = [];
    const app = emptySideApp(() => ({
      kind: "list",
      children: order.map((id) => ({ kind: "list-item", children: [], key: id })),
    }));
    const { dispose } = mount(app, root);
    const ul = root.firstElementChild as HTMLElement;
    expect(ul.tagName).toBe("UL");

    order = ["a", "b", "c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(ul);
    expect(ul.querySelectorAll("li").length).toBe(3);
    dispose();
  });

  it("keeps the parent when an UNKEYED list grows from empty", () => {
    // The empty boundary is key-agnostic: with nothing on the old side there is
    // nothing keys could have matched against. `column(when(open, X))` is the
    // commonest shape this reaches, and it carries no key at all.
    let open = false;
    const app = emptySideApp(() => ({
      kind: "column",
      children: open ? [{ kind: "text", text: "hint" }] : [],
    }));
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    column.dataset.probe = "seeded";

    open = true;
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(column.dataset.probe).toBe("seeded");
    expect(column.textContent).toBe("hint");
    dispose();
  });

  it("does not re-enter the renderer when both sides are empty", () => {
    // Ordering guard: the both-empty early return must stay ahead of the new
    // branch, or every render of a childless container would rebuild its
    // interior for nothing.
    let heading = "one";
    let renders = 0;
    const counting: TileRenderers = {
      ...layoutTiles,
      column(node, ctx) {
        renders++;
        return (layoutTiles as Required<TileRenderers>).column(node, ctx);
      },
    };
    const app = emptySideApp(() => ({
      kind: "column",
      children: [
        { kind: "heading", text: heading },
        { kind: "column", children: [] },
      ],
    }));
    const { dispose } = mount(app, root, { tiles: counting });
    const inner = (root.firstElementChild as HTMLElement).children[1] as HTMLElement;
    const before = renders;

    heading = "two";
    app._rerender?.();

    expect(renders).toBe(before);
    expect((root.firstElementChild as HTMLElement).children[1]).toBe(inner);
    dispose();
  });

  it("hands the refilled list back to the ordinary keyed pass on the next render", () => {
    // The new branch overwrites the node→element mapping the fresh render made.
    // If it did not, the following render would look its children up in the map,
    // miss, and throw the keyed pass's invariant error.
    let order: string[] = [];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;

    order = ["a", "b", "c"];
    app._rerender?.();
    const [ea, eb, ec] = Array.from(column.children) as HTMLElement[];

    order = ["c", "a", "b"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(Array.from(column.children)).toEqual([ec, ea, eb]);
    dispose();
  });

  it("leaves the old element untouched when the renderer throws mid-transition", () => {
    // `ctx.render` runs before `replaceChildren` on purpose: a renderer that
    // throws must leave the mounted element exactly as it was, so the outer
    // bailout's full rebuild is the only thing that changes the DOM.
    let armed = true;
    let order = ["a", "b", "c"];
    const oneShot: TileRenderers = {
      ...layoutTiles,
      column(node, ctx) {
        if (armed && (node as { children: TileNode[] }).children.length === 0) {
          armed = false;
          throw new Error("renderer refused an empty column");
        }
        return (layoutTiles as Required<TileRenderers>).column(node, ctx);
      },
    };
    const app = rowsApp(() => order);
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const { dispose } = mount(app, root, { tiles: oneShot });
      const column = root.firstElementChild as HTMLElement;

      order = [];
      app._rerender?.();

      // The throw landed in the reconcile bailout, and the element the walker
      // was holding still carries the children it had before the attempt.
      expect(errors.flat().map(String).join(" ")).toContain("renderer refused an empty column");
      expect(column.children.length).toBe(3);
      expect(root.firstElementChild).not.toBe(column);
      dispose();
    } finally {
      console.error = originalError;
    }
  });
});

describe("runtime: keyed inserts under a renderer that wraps its children", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  it("re-wraps a newcomer that joins a one-child overlay", () => {
    // `overlay` places its FIRST child directly, so with exactly one mounted
    // child the placement probe truthfully reports "nothing is wrapped" — and
    // the keyed pass then appends the newcomer bare, with no layer around it.
    // The probe can only speak for slots that already exist; whether a NEW child
    // can be placed is a property of the renderer, not of the current DOM.
    let order = ["solo"];
    const app = emptySideApp(() => ({
      kind: "overlay",
      children: order.map((id) => ({ kind: "text", text: `layer ${id}`, key: id })),
    }));
    const { dispose } = mount(app, root);
    expect(overlayLayerDivs(root.firstElementChild as HTMLElement).length).toBe(0);

    order = ["solo", "b"];
    app._rerender?.();

    const overlay = root.firstElementChild as HTMLElement;
    expect(overlay.children.length).toBe(2);
    const layers = overlayLayerDivs(overlay);
    expect(layers.length).toBe(1);
    expect(layers[0]?.children.length).toBe(1);
    expect(layers[0]?.textContent).toBe("layer b");
    expect((overlay.children[0] as HTMLElement).dataset.kumikiTile).toBe("text");
    dispose();
  });

  it("still takes the keyed path for a one-child overlay with no newcomer", () => {
    // The declaration must only bite when there is something to place. A
    // same-membership render of a single-layer overlay has nothing to insert, so
    // the keyed pass runs and the mounted element is reused.
    let text = "one";
    const app = emptySideApp(() => ({
      kind: "overlay",
      children: [{ kind: "text", text, key: "solo" }],
    }));
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    const solo = overlay.children[0] as HTMLElement;

    text = "two";
    app._rerender?.();

    expect(root.firstElementChild).toBe(overlay);
    expect(overlay.children[0]).toBe(solo);
    expect(solo.textContent).toBe("two");
    dispose();
  });

  it("takes a host renderer at its word when it places children directly", () => {
    // The declaration covers built-ins only. Declining for every unknown kind
    // would be the safe-looking choice and would cost every well-behaved host
    // integration its keyed inserts — so an unknown kind is trusted, and the
    // measurement still catches one that wraps as soon as a child is mounted.
    // Pinned because "unknown ⇒ unsafe" is a tempting future tightening.
    let order = ["a"];
    const hostTiles: TileRenderers = {
      ...layoutTiles,
      "host-shelf": (node, ctx) => {
        const el = document.createElement("section");
        el.dataset.kumikiTile = "host-shelf";
        for (const child of (node as { children: TileNode[] }).children) {
          if (child) el.appendChild(ctx.render(child));
        }
        return el;
      },
    } as TileRenderers;
    const app = emptySideApp(
      () =>
        ({
          kind: "host-shelf",
          children: order.map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
        }) as unknown as TileNode,
    );
    const { dispose } = mount(app, root, { tiles: hostTiles });
    const shelf = root.firstElementChild as HTMLElement;
    const first = shelf.children[0] as HTMLElement;

    order = ["a", "b"];
    app._rerender?.();

    // Keyed insert: the survivor kept its element and the newcomer joined it.
    expect(root.firstElementChild).toBe(shelf);
    expect(shelf.children[0]).toBe(first);
    expect(Array.from(shelf.children).map((e) => e.textContent)).toEqual(["row a", "row b"]);
    dispose();
  });

  it("agrees with what the built-in renderers actually do with their children", () => {
    // `WRAPPING_TILE_KINDS` is a declaration, and a declaration can drift from
    // the renderers it describes. Mount every container kind with two children
    // and compare the DOM the renderer produced against what the set claims.
    const containers: Array<TileNode["kind"]> = [
      "page",
      "column",
      "row",
      "card",
      "box",
      "form",
      "grid",
      "stack",
      "region",
      "scroll",
      "panel",
      "fieldset",
      "overlay",
      "list",
      "list-item",
      "table",
      "table-head",
      "table-body",
      "table-row",
      "table-cell",
      "modal",
      "drawer",
      "popover",
      "tooltip",
      "route-outlet",
      "details",
    ];
    const allTiles: TileRenderers = {
      ...layoutTiles,
      ...textTiles,
      ...inputTiles,
      ...collectionTiles,
      ...overlayTiles,
      ...mediaTiles,
      ...statusTiles,
    };
    const mismatches: string[] = [];
    for (const kind of containers) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const app = emptySideApp(
        () =>
          ({
            kind,
            summary: "s",
            open: true,
            children: [
              { kind: "text", text: "one", key: "a" },
              { kind: "text", text: "two", key: "b" },
            ],
          }) as TileNode,
      );
      const { dispose } = mountCore(app, host, { tiles: allTiles });
      const parent = host.firstElementChild as HTMLElement;
      const kids = Array.from(parent.querySelectorAll('[data-kumiki-tile="text"]'));
      if (kids.length !== 2) {
        mismatches.push(`${kind}: rendered ${kids.length} of its 2 children — update the list`);
      } else {
        // Membership, not `child.parentElement === parent`: happy-dom hands out
        // `<form>` behind a Proxy (for named-item access), so the identity
        // comparison reports a wrapper that is not there. The structural answer
        // is what this test is about.
        const direct = new Set(Array.from(parent.children));
        const allDirect = kids.every((k) => direct.has(k));
        if (allDirect === WRAPPING_TILE_KINDS.includes(kind)) {
          mismatches.push(
            allDirect
              ? `${kind}: places its children directly but is listed as wrapping`
              : `${kind}: wraps its children but is missing from WRAPPING_TILE_KINDS`,
          );
        }
      }
      dispose();
      host.remove();
    }
    expect(mismatches).toEqual([]);
    // Nothing may be declared that is not a container at all.
    expect(
      [...WRAPPING_TILE_KINDS].filter((k) => !containers.includes(k as TileNode["kind"])),
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The minimum move set. Matching children by key says WHICH old element belongs
// to which new child; it does not say how many of them have to be touched to
// get the new sequence. Re-attaching a node blurs it, so every survivor the
// reorder moves for no reason costs exactly the state the keyed path exists to
// keep: focus, the caret, an open `<select>`, an in-flight IME composition.
//
// These tests observe the DOM operations themselves rather than the resulting
// order, because the order was already correct — what was wrong was the price
// paid for it.

type Placement = { node: Node; moved: boolean };

/**
 * Record every child placement the reconciler performs on `parent`, saying for
 * each whether it MOVED a node already mounted there or inserted a fresh one.
 * The counter lives here rather than in the runtime because "how many moves"
 * is a property of what reaches the DOM, and the DOM node is where that can be
 * observed without the implementation reporting on itself.
 *
 * `appendChild` is wrapped alongside `insertBefore` so a test asserting "this
 * element was never placed" cannot be satisfied by the implementation simply
 * reaching for the other method.
 */
function trackPlacements(parent: HTMLElement): Placement[] {
  const placements: Placement[] = [];
  const insertBefore = parent.insertBefore.bind(parent) as (node: Node, ref: Node | null) => Node;
  const appendChild = parent.appendChild.bind(parent) as (node: Node) => Node;
  parent.insertBefore = ((node: Node, ref: Node | null): Node => {
    placements.push({ node, moved: node.parentNode === parent });
    return insertBefore(node, ref);
  }) as typeof parent.insertBefore;
  parent.appendChild = ((node: Node): Node => {
    placements.push({ node, moved: node.parentNode === parent });
    return appendChild(node);
  }) as typeof parent.appendChild;
  return placements;
}

describe("runtime: keyed reorder moves the minimum", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

  function rowsApp(getOrder: () => string[]): AppShape {
    return {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: getOrder().map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
      }),
    };
  }

  it("touches nothing when the order is unchanged", () => {
    // The common case, and the one the unconditional sweep was worst at: a
    // list re-rendered because something else in the app changed. Every child
    // is already where it belongs, so the reorder has nothing to do at all.
    let order = ["a", "b", "c", "d"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const before = Array.from(column.children);
    const placements = trackPlacements(column);

    order = ["a", "b", "c", "d"];
    app._rerender?.();

    expect(placements).toEqual([]);
    expect(Array.from(column.children)).toEqual(before);
    dispose();
  });

  it("moves one element when one element moved", () => {
    // `d` to the front leaves `a b c` in their existing relative order, so they
    // are the longest run that can stay put and `d` is the only thing to place.
    let order = ["a", "b", "c", "d"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, eb, ec, ed] = Array.from(column.children) as HTMLElement[];
    const placements = trackPlacements(column);

    order = ["d", "a", "b", "c"];
    app._rerender?.();

    expect(placements.length).toBe(1);
    expect(placements[0]).toEqual({ node: ed, moved: true });
    expect(Array.from(column.children)).toEqual([ed, ea, eb, ec]);
    dispose();
  });

  it("moves n-1 elements for a full reversal — one survivor always stays", () => {
    // The worst case for a keyed list: no two children keep their relative
    // order, so the longest run that can stay put has length one. Even here the
    // sweep's Nth move is avoidable.
    let order = ["a", "b", "c"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, eb, ec] = Array.from(column.children) as HTMLElement[];
    const placements = trackPlacements(column);

    order = ["c", "b", "a"];
    app._rerender?.();

    expect(placements.length).toBe(2);
    expect(placements.every((p) => p.moved)).toBe(true);
    expect(Array.from(column.children)).toEqual([ec, eb, ea]);
    dispose();
  });

  it("places only the newcomer when a list grows at the head", () => {
    let order = ["a", "b", "c"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, eb, ec] = Array.from(column.children) as HTMLElement[];
    const placements = trackPlacements(column);

    order = ["x", "a", "b", "c"];
    app._rerender?.();

    // One placement, and it is a mount rather than a move: nothing that was
    // already on the page was touched to make room.
    expect(placements.length).toBe(1);
    expect(placements[0]?.moved).toBe(false);
    const after = Array.from(column.children) as HTMLElement[];
    expect(after.slice(1)).toEqual([ea, eb, ec]);
    expect(after[0]?.textContent).toBe("row x");
    dispose();
  });

  it("moves nothing when a list shrinks in the middle", () => {
    // Removal already addresses the departing element directly. What the sweep
    // added on top was re-appending every survivor behind it.
    let order = ["a", "b", "c", "d"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [ea, , ec, ed] = Array.from(column.children) as HTMLElement[];
    const placements = trackPlacements(column);

    order = ["a", "c", "d"];
    app._rerender?.();

    expect(placements).toEqual([]);
    expect(Array.from(column.children)).toEqual([ea, ec, ed]);
    dispose();
  });

  it("leaves a focused child that did not move alone — no blur, no placement", () => {
    // The guarantee §10.3.11 makes is that the patch path does not need the
    // focus-restore fallback, so the test has to hold with that layer out of
    // the picture. It does: the placement record is taken before the restore
    // runs and is not something a `.focus()` can put back.
    //
    // The `blur` listener states the consequence the user actually feels, but
    // it does not enforce it here — happy-dom does not model a moved element
    // losing focus, so it stays at zero even when the element is moved. A real
    // browser is where that assertion has teeth; the placement record is what
    // holds the line in this tier.
    let order = ["a", "b", "c", "d"];
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: order.map((id) => ({ kind: "input", value: `v${id}`, id: `i-${id}`, key: id })),
      }),
    };
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const inputB = root.querySelector("#i-b") as HTMLInputElement;
    inputB.focus();
    expect(document.activeElement).toBe(inputB);
    let blurs = 0;
    inputB.addEventListener("blur", () => {
      blurs += 1;
    });
    const placements = trackPlacements(column);

    // Only `d` has to move; `a b c` keep their relative order.
    order = ["d", "a", "b", "c"];
    app._rerender?.();

    expect(blurs).toBe(0);
    expect(placements.map((p) => p.node)).not.toContain(inputB);
    expect(document.activeElement).toBe(inputB);
    expect(root.querySelector("#i-b")).toBe(inputB);
    dispose();
  });

  it("mounts, moves and drops in one render and still lands on the new order", () => {
    // The three things the pass does, interleaved, so their orderings cannot be
    // right only in isolation: `b` departs, `x` arrives, `d` moves to the front
    // and `c` stays.
    let order = ["a", "b", "c", "d"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const [, , ec, ed] = Array.from(column.children) as HTMLElement[];
    const placements = trackPlacements(column);

    order = ["d", "x", "c"];
    app._rerender?.();

    const after = Array.from(column.children) as HTMLElement[];
    expect(after.map((e) => e.textContent)).toEqual(["row d", "row x", "row c"]);
    expect(after[0]).toBe(ed);
    expect(after[2]).toBe(ec);
    // `c` is the survivor that stays; `d` is the one move, `x` the one mount.
    expect(placements.filter((p) => p.moved).length).toBe(1);
    expect(placements.filter((p) => !p.moved).length).toBe(1);
    dispose();
  });

  it("mounts a wholly new list without moving the departing one out of the way", () => {
    // No key matches, so every child is a mount and every old one a removal.
    // The survivors' relative order — the thing that normally decides what to
    // leave alone — has nothing to say here, and the placements have to produce
    // the order on their own.
    let order = ["a", "b", "c"];
    const app = rowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const placements = trackPlacements(column);

    order = ["x", "y", "z"];
    app._rerender?.();

    expect(Array.from(column.children).map((e) => e.textContent)).toEqual([
      "row x",
      "row y",
      "row z",
    ]);
    expect(placements.length).toBe(3);
    expect(placements.some((p) => p.moved)).toBe(false);
    dispose();
  });

  it("anchors the tail on where the child list ended, not on a rebuilt child", () => {
    // The last new child has no successor to insert against, so it takes the
    // anchor read from the end of the mounted child list. That read has to
    // happen before any child is rebuilt: `replaceWithFreshTile` splices a new
    // element into the old one's slot, and the old element — still what the map
    // holds — is left detached. An anchor derived after that walks back to the
    // previous child, whose next sibling is now the rebuilt element, and the
    // tail lands in front of it instead of at the end.
    //
    // `c` changes kind, which is the rebuild reconcile performs silently, and
    // `a` moves to the tail in the same render.
    let order = ["a", "b", "c"];
    let cKind: "text" | "heading" = "text";
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "column",
        children: order.map((id) => ({
          kind: id === "c" ? cKind : "text",
          text: `row ${id}`,
          key: id,
        })),
      }),
    };
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;

    order = ["b", "c", "a"];
    cKind = "heading";
    app._rerender?.();

    const after = Array.from(column.children) as HTMLElement[];
    expect(after.map((e) => e.textContent)).toEqual(["row b", "row c", "row a"]);
    expect(after[1]?.tagName).toBe("H1");
    dispose();
  });

  it("keeps a reordered list ahead of content the parent's renderer put after it", () => {
    // The keyed pass owns its children's slots, not the whole parent. A
    // renderer is free to keep its own content on either side of them, and a
    // reorder that appends survivors to the parent walks them past it. Every
    // built-in that places its children directly happens to keep its own
    // content in front of them, so this is written with a host renderer — the
    // integration the placement contract explicitly admits.
    //
    // The order moves `a` to the TAIL on purpose: only the last new child
    // reaches for the end-of-list anchor, so any other permutation would leave
    // that branch — the one this test exists for — unexercised.
    const hostCard: TileRenderer<"card"> = (node, ctx) => {
      const el = document.createElement("div");
      el.appendChild(document.createElement("header"));
      for (const child of node.children) el.appendChild(ctx.render(child));
      el.appendChild(document.createElement("footer"));
      return el;
    };
    let order = ["a", "b", "c"];
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "card",
        children: order.map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
      }),
    };
    const { dispose } = mount(app, root, { tiles: { card: hostCard } as TileRenderers });
    const card = root.firstElementChild as HTMLElement;
    const shape = (): string[] => Array.from(card.children).map((c) => c.tagName);
    expect(shape()).toEqual(["HEADER", "SPAN", "SPAN", "SPAN", "FOOTER"]);

    order = ["b", "c", "a"];
    app._rerender?.();

    expect(shape()).toEqual(["HEADER", "SPAN", "SPAN", "SPAN", "FOOTER"]);
    expect(card.textContent).toBe("row brow crow a");
    dispose();
  });

  it("mounts a newcomer at the tail ahead of the renderer's own trailing content", () => {
    // The same anchor, reached by a mount rather than a move: a list that grows
    // at the end has nothing to insert its newcomer against either.
    const hostCard: TileRenderer<"card"> = (node, ctx) => {
      const el = document.createElement("div");
      for (const child of node.children) el.appendChild(ctx.render(child));
      el.appendChild(document.createElement("footer"));
      return el;
    };
    let order = ["a", "b"];
    const app: AppShape = {
      slots: {},
      caps: [],
      effects: {},
      init: [],
      reducers: [],
      root: (): TileNode => ({
        kind: "card",
        children: order.map((id) => ({ kind: "text", text: `row ${id}`, key: id })),
      }),
    };
    const { dispose } = mount(app, root, { tiles: { card: hostCard } as TileRenderers });
    const card = root.firstElementChild as HTMLElement;

    order = ["a", "b", "x"];
    app._rerender?.();

    expect(Array.from(card.children).map((c) => c.tagName)).toEqual([
      "SPAN",
      "SPAN",
      "SPAN",
      "FOOTER",
    ]);
    expect(card.textContent).toBe("row arow brow x");
    dispose();
  });
});
