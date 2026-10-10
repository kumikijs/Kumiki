import type { TileNode, TileRenderer, TileRenderers } from "@kumikijs/runtime";
import { mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appOf, bareApp, lifecycleReducer } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";
import { childAt, childList, keyedRowsApp } from "./helpers/reconcile-apps.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
});

const texts = (el: Element): (string | null)[] => childList(el).map((c) => c.textContent);

describe("keyed children keep their elements across a reorder, insert or removal", () => {
  it.each([
    ["a full reorder", ["a", "b", "c"], ["c", "a", "b"]],
    ["a middle insert", ["a", "b", "c"], ["a", "x", "b", "c"]],
    ["a removal", ["a", "b", "c"], ["a", "c"]],
  ])("%s", (_label, before, after) => {
    let order = before;
    const app = keyedRowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const byKey = new Map(before.map((id, i) => [id, childAt(column, i)]));

    order = after;
    app._rerender?.();

    expect(root.firstElementChild).toBe(column);
    expect(texts(column)).toEqual(after.map((id) => `row ${id}`));
    after.forEach((id, i) => {
      if (byKey.has(id)) expect(childAt(column, i)).toBe(byKey.get(id));
    });
    dispose();
  });

  function keyedInputsApp(order: () => string[]) {
    return appOf(() => ({
      kind: "column",
      children: order().map((id) => ({
        kind: "box",
        key: id,
        children: [{ kind: "input", value: `v${id}`, id: `i-${id}` }],
      })),
    }));
  }

  it("keeps a value the user typed into a moved input", () => {
    let order = ["a", "b", "c"];
    const app = keyedInputsApp(() => order);
    const { dispose } = mount(app, root);
    const inputB = defined(root.querySelector<HTMLInputElement>("#i-b"), "input b");
    inputB.value = "user typed this";

    order = ["b", "a", "c"];
    app._rerender?.();

    expect(root.querySelector("#i-b")).toBe(inputB);
    expect(inputB.value).toBe("user typed this");
    dispose();
  });

  it("keeps focus and caret on a moved input", () => {
    let order = ["a", "b", "c"];
    const app = keyedInputsApp(() => order);
    const { dispose } = mount(app, root);
    const inputB = defined(root.querySelector<HTMLInputElement>("#i-b"), "input b");
    inputB.focus();
    inputB.setSelectionRange(1, 1);

    order = ["c", "b", "a"];
    app._rerender?.();

    expect(root.querySelector("#i-b")).toBe(inputB);
    expect(document.activeElement).toBe(inputB);
    expect([inputB.selectionStart, inputB.selectionEnd]).toEqual([1, 1]);
    dispose();
  });

  it("falls back to the structural diff when only some children carry a key", () => {
    let grow = false;
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "text", text: "keyed", key: "a" },
        { kind: "text", text: "not keyed" },
        ...(grow ? [{ kind: "text" as const, text: "extra" }] : []),
      ],
    }));
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;

    grow = true;
    app._rerender?.();

    expect(root.firstElementChild).not.toBe(column);
    expect(root.firstElementChild?.children.length).toBe(3);
    dispose();
  });

  it.each([
    ["fires no tile.unmount while another instance of the tile remains", ["a"], []],
    ["fires tile.unmount once the last instance of the tile is gone", [], ["unmount:Row"]],
  ])("%s", (_label, remaining, expected) => {
    const events: string[] = [];
    let rows = ["a", "b"];
    const app = bareApp({
      reducers: [
        lifecycleReducer('tile.unmount("Row")', (s) => {
          events.push("unmount:Row");
          return { slots: s, emits: [] };
        }),
      ],
      root: () => ({
        kind: "column",
        children:
          rows.length > 0
            ? rows.map((id) => ({
                kind: "box",
                key: id,
                props: { _tile: "Row" },
                children: [{ kind: "text", text: id }],
              }))
            : [{ kind: "text", text: "empty", key: "placeholder" }],
      }),
    });
    const { dispose } = mount(app, root);

    rows = remaining;
    app._rerender?.();

    expect(events).toEqual(expected);
    dispose();
  });

  it.each([
    ["duplicate sibling keys", "a", "a"],
    ["empty keys", "", ""],
  ])("panics on %s and still renders every child", (_label, first, second) => {
    const errors = captureConsole();
    let broken = false;
    const app = appOf(() => ({
      kind: "column",
      children: broken
        ? [
            { kind: "text", text: "x1", key: first },
            { kind: "text", text: "x2", key: second },
          ]
        : [{ kind: "text", text: "start", key: "s" }],
    }));
    const { dispose } = mount(app, root);

    broken = true;
    app._rerender?.();

    expect(texts(root.firstElementChild as HTMLElement)).toEqual(["x1", "x2"]);
    expect(errors).not.toEqual([]);
    dispose();
  });
});

type Placement = { node: Node; moved: boolean };

/** Records every insertion into `parent`, and whether the node was already its child. */
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

describe("a keyed reorder moves the minimum", () => {
  it.each([
    ["touches nothing when the order is unchanged", "abcd", "abcd", 0, 0],
    ["moves one element when one element moved", "abcd", "dabc", 1, 0],
    ["moves n-1 elements for a full reversal", "abc", "cba", 2, 0],
    ["places only the newcomer when a list grows at the head", "abc", "xabc", 0, 1],
    ["moves nothing when a list shrinks in the middle", "abcd", "acd", 0, 0],
    ["mounts, moves and drops in one render", "abcd", "dxc", 1, 1],
    ["mounts a wholly new list without moving the departing one", "abc", "xyz", 0, 3],
  ])("%s", (_label, before, after, moves, mounts) => {
    let order = [...before];
    const app = keyedRowsApp(() => order);
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const byKey = new Map([...before].map((id, i) => [id, childAt(column, i)]));
    const placements = trackPlacements(column);

    order = [...after];
    app._rerender?.();

    expect(texts(column)).toEqual(order.map((id) => `row ${id}`));
    order.forEach((id, i) => {
      if (byKey.has(id)) expect(childAt(column, i)).toBe(byKey.get(id));
    });
    expect(placements.filter((p) => p.moved).length).toBe(moves);
    expect(placements.filter((p) => !p.moved).length).toBe(mounts);
    dispose();
  });

  it("leaves a focused child that did not move alone: no blur, no placement", () => {
    let order = ["a", "b", "c", "d"];
    const app = appOf(() => ({
      kind: "column",
      children: order.map((id) => ({ kind: "input", value: `v${id}`, id: `i-${id}`, key: id })),
    }));
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;
    const inputB = defined(root.querySelector<HTMLInputElement>("#i-b"), "input b");
    inputB.focus();
    let blurs = 0;
    inputB.addEventListener("blur", () => {
      blurs += 1;
    });
    const placements = trackPlacements(column);

    order = ["d", "a", "b", "c"];
    app._rerender?.();

    expect(blurs).toBe(0);
    expect(placements.map((p) => p.node)).not.toContain(inputB);
    expect(document.activeElement).toBe(inputB);
    dispose();
  });

  it("anchors the tail on where the child list ended, not on a rebuilt child", () => {
    let order = ["a", "b", "c"];
    let cKind: "text" | "heading" = "text";
    const app = appOf(() => ({
      kind: "column",
      children: order.map((id) => ({
        kind: id === "c" ? cKind : "text",
        text: `row ${id}`,
        key: id,
      })),
    }));
    const { dispose } = mount(app, root);
    const column = root.firstElementChild as HTMLElement;

    order = ["b", "c", "a"];
    cKind = "heading";
    app._rerender?.();

    expect(texts(column)).toEqual(["row b", "row c", "row a"]);
    expect(childAt(column, 1).tagName).toBe("H1");
    dispose();
  });

  /** A card renderer that frames its children with elements of its own. */
  const framedCard =
    (header: boolean): TileRenderer<"card"> =>
    (node, ctx) => {
      const el = document.createElement("div");
      if (header) el.appendChild(document.createElement("header"));
      for (const child of node.children) el.appendChild(ctx.render(child));
      el.appendChild(document.createElement("footer"));
      return el;
    };

  it.each([
    ["keeps a reordered list ahead of the renderer's trailing content", true, "abc", "bca"],
    ["mounts a tail newcomer ahead of the renderer's trailing content", false, "ab", "abx"],
  ])("%s", (_label, header, before, after) => {
    let order = [...before];
    const app = keyedRowsApp(() => order, "card");
    const { dispose } = mount(app, root, { tiles: { card: framedCard(header) } as TileRenderers });
    const card = root.firstElementChild as HTMLElement;

    order = [...after];
    app._rerender?.();

    expect(childList(card).map((c) => c.tagName)).toEqual([
      ...(header ? ["HEADER"] : []),
      ...order.map(() => "SPAN"),
      "FOOTER",
    ]);
    expect(card.textContent).toBe(order.map((id) => `row ${id}`).join(""));
    dispose();
  });
});

describe("a renderer that places its children directly takes the keyed path", () => {
  it("takes a host renderer at its word", () => {
    let order = ["a"];
    const shelf: TileRenderer = (node, ctx) => {
      const el = document.createElement("section");
      for (const child of (node as { children: TileNode[] }).children) {
        el.appendChild(ctx.render(child));
      }
      return el;
    };
    const app = keyedRowsApp(() => order, "host-shelf" as TileNode["kind"]);
    const { dispose } = mount(app, root, { tiles: { "host-shelf": shelf } as TileRenderers });
    const section = root.firstElementChild as HTMLElement;
    const first = childAt(section, 0);

    order = ["a", "b"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(section);
    expect(childAt(section, 0)).toBe(first);
    expect(texts(section)).toEqual(["row a", "row b"]);
    dispose();
  });
});
