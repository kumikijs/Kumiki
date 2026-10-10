import type { TileNode, TileProps, TileRenderers } from "@kumikijs/runtime";
import { layoutTiles, mount } from "@kumikijs/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appOf } from "./helpers/app.ts";
import { captureConsole } from "./helpers/console.ts";
import { defined } from "./helpers/defined.ts";
import { freshRoot } from "./helpers/dom.ts";
import { childAt, childList, keyedRowsApp, overlayLayers } from "./helpers/reconcile-apps.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
});

const column = (layout: TileRenderers["column"]): TileRenderers =>
  ({ ...layoutTiles, column: layout }) as TileRenderers;

const builtinColumn = defined(layoutTiles.column, "the column renderer");

describe("a child list that is empty on one side keeps its parent element", () => {
  it.each([
    ["grows from empty", [], ["a", "b", "c"]],
    ["is cleared to empty", ["a", "b", "c"], []],
  ])("when a keyed list %s", (_label, before, after) => {
    let order = before;
    const app = keyedRowsApp(() => order);
    const { dispose } = mount(app, root);
    const parent = root.firstElementChild as HTMLElement;

    order = after;
    app._rerender?.();

    expect(root.firstElementChild).toBe(parent);
    expect(childList(parent).map((e) => e.textContent)).toEqual(after.map((id) => `row ${id}`));
    dispose();
  });

  it("keeps the parent's browser-owned state across a clear and a refill", () => {
    let order = ["a", "b"];
    const app = keyedRowsApp(() => order);
    const { dispose } = mount(app, root);
    const parent = root.firstElementChild as HTMLElement;
    parent.dataset.probe = "seeded";

    order = [];
    app._rerender?.();
    order = ["c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(parent);
    expect(parent.dataset.probe).toBe("seeded");
    expect(parent.textContent).toBe("row c");
    dispose();
  });

  it("keeps the parent when an unkeyed list grows from empty", () => {
    let open = false;
    const app = appOf(() => ({
      kind: "column",
      children: open ? [{ kind: "text", text: "hint" }] : [],
    }));
    const { dispose } = mount(app, root);
    const parent = root.firstElementChild as HTMLElement;

    open = true;
    app._rerender?.();

    expect(root.firstElementChild).toBe(parent);
    expect(parent.textContent).toBe("hint");
    dispose();
  });

  it("keeps a <ul> across a list that fills from empty", () => {
    let order: string[] = [];
    const app = appOf(() => ({
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

  it("hands the refilled list back to the ordinary keyed pass on the next render", () => {
    let order: string[] = [];
    const app = keyedRowsApp(() => order);
    const { dispose } = mount(app, root);
    const parent = root.firstElementChild as HTMLElement;

    order = ["a", "b", "c"];
    app._rerender?.();
    const [ea, eb, ec] = childList(parent);

    order = ["c", "a", "b"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(parent);
    expect(childList(parent)).toEqual([ec, ea, eb]);
    dispose();
  });
});

describe("a wrapping parent filled or emptied from one side", () => {
  it("wraps the new children through the overlay's renderer when the old list was empty", () => {
    let order: string[] = [];
    const app = keyedRowsApp(() => order, "overlay");
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;

    order = ["a", "b", "c"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(overlay);
    expect(overlay.children.length).toBe(3);
    const layers = overlayLayers(overlay);
    expect(layers.length).toBe(2);
    for (const layer of layers) {
      expect(layer.children.length).toBe(1);
      expect(layer.style.position).toBe("absolute");
    }
    expect(childAt(overlay, 0).getAttribute("data-kumiki-tile")).toBe("text");
    expect(overlay.textContent).toBe("row arow brow c");
    dispose();
  });

  it("clears a wrapped list without stranding its layers", () => {
    let order = ["a", "b", "c"];
    const app = keyedRowsApp(() => order, "overlay");
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;

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
    const app = keyedRowsApp(() => order, kind);
    const { dispose } = mount(app, root);
    const surface = root.firstElementChild as HTMLElement;

    order = ["a", "b"];
    app._rerender?.();

    expect(root.firstElementChild).toBe(surface);
    expect(surface.children.length).toBe(1);
    const content = childAt(surface, 0) as HTMLElement;
    expect(content.dataset.kumikiTile).toBe(`${kind}-content`);
    expect(childList(content).map((e) => e.textContent)).toEqual(["row a", "row b"]);
    dispose();
  });

  it("rebuilds a details' own summary alongside the children, keeping it open", () => {
    let order = ["a", "b"];
    const app = keyedRowsApp(() => order, "details");
    const { dispose } = mount(app, root);
    const det = root.firstElementChild as HTMLDetailsElement;
    det.open = true;

    for (const next of [[], ["c"]]) {
      order = next;
      app._rerender?.();
      expect(root.firstElementChild).toBe(det);
      expect(det.open).toBe(true);
      expect(det.querySelector("summary")?.textContent).toBe("disclosure");
    }
    expect(det.textContent).toBe("disclosurerow c");
    dispose();
  });
});

describe("a modal surface", () => {
  it("is announced as a dialog under the name its title gives it", () => {
    let title: string | undefined = "Confirm";
    const app = appOf(
      () =>
        ({
          kind: "modal",
          open: true,
          children: [],
          ...(title === undefined ? {} : { title }),
        }) as TileNode,
    );
    const { dispose } = mount(app, root);
    const surface = defined(root.firstElementChild, "the mounted modal");
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

  it("lets its own role and aria win, and loses the renderer's with them", () => {
    let props: TileProps | undefined = { role: "alertdialog", aria: { label: "Careful" } };
    const app = appOf(
      () => ({ kind: "modal", open: true, title: "Confirm", children: [], props }) as TileNode,
    );
    const { dispose } = mount(app, root);
    const surface = defined(root.firstElementChild, "the mounted modal");
    expect(surface.getAttribute("role")).toBe("alertdialog");
    expect(surface.getAttribute("aria-label")).toBe("Careful");

    props = undefined;
    app._rerender?.();
    expect(root.firstElementChild).toBe(surface);
    expect(surface.hasAttribute("role")).toBe(false);
    expect(surface.hasAttribute("aria-label")).toBe(false);
    dispose();
  });
});

describe("the renderer on an empty-side transition", () => {
  it("is not re-entered when both sides are empty", () => {
    let heading = "one";
    let renders = 0;
    const app = appOf(() => ({
      kind: "column",
      children: [
        { kind: "heading", text: heading },
        { kind: "column", children: [] },
      ],
    }));
    const { dispose } = mount(app, root, {
      tiles: column((node, ctx) => {
        renders++;
        return builtinColumn(node, ctx);
      }),
    });
    const inner = childAt(root.firstElementChild as HTMLElement, 1);
    const before = renders;

    heading = "two";
    app._rerender?.();

    expect(renders).toBe(before);
    expect(childAt(root.firstElementChild as HTMLElement, 1)).toBe(inner);
    dispose();
  });

  it("leaves the old element untouched when it throws mid-transition", () => {
    const errors = captureConsole();
    let armed = true;
    let order = ["a", "b", "c"];
    const app = keyedRowsApp(() => order);
    const { dispose } = mount(app, root, {
      tiles: column((node, ctx) => {
        if (armed && node.children.length === 0) {
          armed = false;
          throw new Error("renderer refused an empty column");
        }
        return builtinColumn(node, ctx);
      }),
    });
    const parent = root.firstElementChild as HTMLElement;

    order = [];
    app._rerender?.();

    expect(errors.join(" ")).toContain("renderer refused an empty column");
    expect(parent.children.length).toBe(3);
    expect(root.firstElementChild).not.toBe(parent);
    dispose();
  });
});
