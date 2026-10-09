import type {
  AppShape,
  Episode,
  EpisodeLogger,
  ReducerSpec,
  TileCtx,
  TileNode,
  TileProps,
  TileRenderer,
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
import { firstChildMappedColumn } from "./fixtures/host-renderers.ts";
import { defined } from "./helpers/defined.ts";

function lifecycleReducer(name: string, apply: ReducerSpec["apply"]): ReducerSpec {
  return {
    name: `r-${name.replace(/[^a-z0-9]/gi, "")}`,
    event: { kind: "lifecycle", name },
    apply,
  };
}

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

const childAt = (parent: Element, i: number): Element =>
  defined(parent.children[i], `child ${i} of <${parent.tagName.toLowerCase()}>`);

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
    expect(childAt(column, 0)).toBe(savedHeading);
    expect(childAt(column, 0).textContent).toBe("Count: 1");
    // Every sibling row survived — SAME element reference.
    for (let i = 0; i < savedRows.length; i++) {
      expect(column.children[i + 1]).toBe(savedRows[i]);
    }

    dispose();
  });

  it("preserves DOM identity for the containing column when only a child changes", () => {
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

    expect(root.querySelector("input")).toBe(savedInput);
    expect(document.activeElement).toBe(savedInput);
    expect(savedInput.selectionStart).toBe(2);
    expect(savedInput.selectionEnd).toBe(2);
    dispose();
  });

  it("rebuilds the whole subtree when child list length changes", () => {
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
    const savedBtn = root.querySelector("button") as HTMLButtonElement;
    app._rerender?.();
    app._rerender?.();
    app._rerender?.();
    expect(root.querySelector("button")).toBe(savedBtn);
    savedBtn.click();
    expect(clicks).toBe(1);
    dispose();
  });

  it("rebuilds the element in place when the tile kind at a position changes", () => {
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
    const savedTop = childAt(column, 0);
    const savedMiddle = childAt(column, 1);
    const savedBottom = childAt(column, 2);
    expect(savedMiddle.tagName.toLowerCase()).toBe("h1");

    showHeading = false;
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(childAt(column, 0)).toBe(savedTop);
    expect(childAt(column, 2)).toBe(savedBottom);
    expect(childAt(column, 1)).not.toBe(savedMiddle);
    expect(childAt(column, 1).tagName.toLowerCase()).not.toBe("h1");
    expect(childAt(column, 1).textContent).toBe("swap me");
    dispose();
  });

  it("preserves intermediate container identity on a deep-tree leaf change", () => {
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
    const savedSibling = childAt(column, 0);
    const savedBox = childAt(column, 1);
    const savedCard = childAt(savedBox, 0);
    const savedHeading = childAt(savedCard, 0);
    expect(savedHeading.textContent).toBe("deep 0");

    live.n = 7;
    app._rerender?.();

    // Root, sibling row, and every ancestor of the changed leaf keep identity.
    expect(root.firstElementChild).toBe(column);
    expect(childAt(column, 0)).toBe(savedSibling);
    expect(childAt(column, 1)).toBe(savedBox);
    expect(childAt(savedBox, 0)).toBe(savedCard);
    expect(childAt(savedCard, 0)).toBe(savedHeading);
    expect(childAt(savedCard, 0).textContent).toBe("deep 7");
    dispose();
  });
});

describe("runtime: keyed reconcile", () => {
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
    const ea = childAt(column, 0);
    const eb = childAt(column, 1);
    const ec = childAt(column, 2);
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
    expect(defined(after[1], "the inserted row").textContent).toBe("row x");
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

    expect(root.querySelector("#i-b")).toBe(inputB);
    expect(document.activeElement).toBe(inputB);
    expect(inputB.selectionStart).toBe(1);
    expect(inputB.selectionEnd).toBe(1);
    dispose();
  });

  it("falls back to structural diff when only some children carry a key (mixed)", () => {
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

    const rebuiltColumn = root.firstElementChild as HTMLElement;
    expect(rebuiltColumn).not.toBe(initialColumn);
    expect(Array.from(rebuiltColumn.children).length).toBe(3);
    dispose();
  });

  it("keyed removal of one instance does NOT fire tile.unmount when another same-named tile remains (mount/unmount is name-based, not per-instance)", () => {
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
      const column = root.firstElementChild as HTMLElement;
      expect(column.children.length).toBe(2);
      expect(childAt(column, 0).textContent).toBe("a1");
      expect(childAt(column, 1).textContent).toBe("a2");
      // And the reconcile threw — the outer panic path logged it.
      expect(suppressed.length).toBeGreaterThan(0);
      dispose();
    } finally {
      console.error = consoleError;
    }
  });

  it("panics when a keyed tile's key is empty / null / undefined (compiler-side helper enforcement)", () => {
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
    const app = makeStripApp({ rows: 5 }) as unknown as DispatchApp;
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    app._dispatch("bump", {});

    expect(lastBindsUpdated(committed)).toEqual(["heading"]);
    dispose();
  });

  it("emits the bind expression (bind + bindPath joined) for a rebuilt form control", () => {
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

    expect(lastBindsUpdated(committed)).toEqual(["c"]);
    dispose();
  });

  it("emits an empty binds-updated when the dirty slot did not change the tile tree", () => {
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

  /**
   * An app whose root column re-renders `children()` on every dispatch of
   * `"advance"`. The child list is what each #216 case varies.
   */
  function childListApp(children: () => TileNode[]): AppShape {
    return {
      slots: { rev: { value: 0 } },
      caps: [],
      effects: {},
      init: [],
      reducers: [
        {
          name: "advance",
          event: { kind: "ui", ev: "click" },
          apply: (s) => ({ slots: { rev: ((s.rev as number) ?? 0) + 1 }, emits: [] }),
        },
      ],
      root: (): TileNode => ({ kind: "column", children: children() }),
    };
  }

  it("names only the rebuilt parent when a hole abandons the positional walk", () => {
    let holed = false;
    const app = childListApp(() =>
      holed
        ? ([{ kind: "text", text: "a2", key: "a" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a", key: "a" },
            { kind: "text", text: "b", key: "b" },
          ],
    );
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    holed = true;
    (app as unknown as DispatchApp)._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["column"]);
    dispose();
  });

  it("names only the rebuilt parent when an unmapped child abandons the walk", () => {
    let label = "a";
    const app = childListApp(() => [
      { kind: "text", text: label },
      { kind: "text", text: "hand-built" },
    ]);
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, {
      tiles: { column: firstChildMappedColumn } as TileRenderers,
      episodeLogger: logger,
    });

    label = "a2";
    (app as unknown as DispatchApp)._dispatch("advance", {});

    expect(lastBindsUpdated(committed)).toEqual(["column"]);
    dispose();
  });

  it("leaves the element map describing only what is mounted after a bail", () => {
    let holed = false;
    const app = childListApp(() =>
      holed
        ? ([{ kind: "text", text: "a2" }, undefined] as unknown as TileNode[])
        : [
            { kind: "text", text: "a" },
            { kind: "text", text: "b" },
          ],
    );
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    holed = true;
    (app as unknown as DispatchApp)._dispatch("advance", {});
    holed = false;
    (app as unknown as DispatchApp)._dispatch("advance", {});

    // Listed rather than counted so a failure names the panic that happened.
    expect(committed.flatMap((ep) => ep.steps.filter((s) => s.kind === "panic"))).toEqual([]);
    expect(
      Array.from(root.querySelectorAll('[data-kumiki-tile="text"]')).map((el) => el.textContent),
    ).toEqual(["a", "b"]);
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
    const app = listSwapApp([], ["a", "b", "c"]);
    const { logger, committed } = makeLogger();
    const { dispose } = mount(app, root, { episodeLogger: logger });

    (app as unknown as DispatchApp)._dispatch("swap", {});

    expect(lastBindsUpdated(committed)).toEqual(["a", "b", "c"]);
    dispose();
  });

  it("emits the parent when a list is cleared to empty", () => {
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

describe("runtime: identity-preserving patch", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    document.body.removeChild(root);
  });

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

  it("select: carries its bind path as the marker focus restoration looks it up by", () => {
    const { app, dispose } = drive((s) => ({
      kind: "column",
      children: [
        (s.n as number) === 0
          ? { kind: "select", bind: "draft", bindPath: ["title"], options: [] }
          : { kind: "select", options: [] },
      ],
    }));
    const sel = defined(root.querySelector("select"), "the mounted select");
    expect(sel.dataset.kumikiBind).toBe("draft.title");

    (app as unknown as { bump: () => void }).bump();
    expect(defined(root.querySelector("select"), "the reused select")).toBe(sel);
    expect(sel.dataset.kumikiBind).toBeUndefined();
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
      defined(app.live, "the app's live map")[name] = value;
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

    secondKind = "heading";
    app._rerender?.();

    expect(layerDivs(overlay)[0]).toBe(layer);
    expect(layer.children.length).toBe(1);
    expect((layer.children[0] as HTMLElement).tagName).toBe("H1");
    expect(overlay.children.length).toBe(2);
    dispose();
  });

  it("still takes the keyed path when the parent places its children directly", () => {
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

  /** A `modal` whose title the caller varies between renders. */
  function surfaceApp(getTitle: () => string | undefined): AppShape {
    return emptySideApp(() => {
      const title = getTitle();
      return {
        kind: "modal",
        open: true,
        children: [],
        ...(title === undefined ? {} : { title }),
      } as TileNode;
    });
  }

  it("announces a modal as the dialog it is, under the name its title gives it", () => {
    let title: string | undefined = "Confirm";
    const app = surfaceApp(() => title);
    const { dispose } = mount(app, root);
    const surface = defined(root.firstElementChild, "the mounted modal") as HTMLElement;
    expect(surface.getAttribute("role")).toBe("dialog");
    expect(surface.getAttribute("aria-label")).toBe("Confirm");

    title = "Delete";
    app._rerender?.();
    expect(root.firstElementChild).toBe(surface);
    expect(surface.getAttribute("aria-label")).toBe("Delete");

    title = undefined;
    app._rerender?.();
    expect(surface.hasAttribute("aria-label")).toBe(false);
    dispose();
  });

  it("lets a modal's own role and aria win, and loses the renderer's with them", () => {
    let props: TileProps | undefined = { role: "alertdialog", aria: { label: "Careful" } };
    const app = emptySideApp(
      () => ({ kind: "modal", open: true, title: "Confirm", children: [], props }) as TileNode,
    );
    const { dispose } = mount(app, root);
    const surface = defined(root.firstElementChild, "the mounted modal") as HTMLElement;
    expect(surface.getAttribute("role")).toBe("alertdialog");
    expect(surface.getAttribute("aria-label")).toBe("Careful");

    props = undefined;
    app._rerender?.();
    expect(root.firstElementChild).toBe(surface);
    expect(surface.hasAttribute("role")).toBe(false);
    expect(surface.hasAttribute("aria-label")).toBe(false);
    dispose();
  });

  it("rebuilds the renderer's own interior alongside the children", () => {
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
    let order = ["a"];
    const hostTiles: TileRenderers = {
      ...layoutTiles,
      "host-shelf": (node: TileNode, ctx: TileCtx) => {
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

type Placement = { node: Node; moved: boolean };

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

    expect(placements.length).toBe(1);
    expect(placements[0]?.moved).toBe(false);
    const after = Array.from(column.children) as HTMLElement[];
    expect(after.slice(1)).toEqual([ea, eb, ec]);
    expect(after[0]?.textContent).toBe("row x");
    dispose();
  });

  it("moves nothing when a list shrinks in the middle", () => {
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
