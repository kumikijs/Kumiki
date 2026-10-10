import type { TileNode, TileRenderers } from "@kumikijs/runtime";
import {
  collectionTiles,
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
import { appOf } from "./helpers/app.ts";
import { freshRoot } from "./helpers/dom.ts";
import { childAt, keyedRowsApp, overlayLayers } from "./helpers/reconcile-apps.ts";

let root: HTMLElement;

beforeEach(() => {
  root = freshRoot();
});
afterEach(() => {
  root.remove();
});

/** Every layer holds exactly the one tile it wraps, and the base child sits on the overlay. */
function expectIntactLayers(overlay: HTMLElement, layerCount: number): void {
  const layers = overlayLayers(overlay);
  expect(layers.length).toBe(layerCount);
  for (const layer of layers) {
    expect(layer.children.length).toBe(1);
    expect(layer.style.position).toBe("absolute");
  }
  expect((overlay.children[0] as HTMLElement).dataset.kumikiTile).toBe("text");
  expect(overlay.children.length).toBe(layerCount + 1);
}

describe("an overlay's keyed children stay inside their layers", () => {
  it.each([
    ["across a reorder", ["c", "a", "b"]],
    ["when one is removed", ["a", "c"]],
    ["when the list grows", ["a", "b", "c", "d"]],
  ])("%s", (_label, after) => {
    let order = ["a", "b", "c"];
    const app = keyedRowsApp(() => order, "overlay");
    const { dispose } = mount(app, root);
    expectIntactLayers(root.firstElementChild as HTMLElement, 2);

    order = after;
    app._rerender?.();

    const overlay = root.firstElementChild as HTMLElement;
    expectIntactLayers(overlay, after.length - 1);
    expect([...(overlay.textContent ?? "").matchAll(/row (\w)/g)].map((m) => m[1]).sort()).toEqual(
      [...after].sort(),
    );
    dispose();
  });

  it("splices a rebuilt wrapped child into its wrapper, not onto the parent", () => {
    let secondKind: "text" | "heading" = "text";
    const app = appOf(() => ({
      kind: "overlay",
      children: [
        { kind: "text", text: "base", key: "a" },
        { kind: secondKind, text: "wrapped", key: "b" },
      ],
    }));
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    const layer = overlayLayers(overlay)[0] as HTMLElement;

    secondKind = "heading";
    app._rerender?.();

    expect(overlayLayers(overlay)[0]).toBe(layer);
    expect(layer.children.length).toBe(1);
    expect(childAt(layer, 0).tagName).toBe("H1");
    expect(overlay.children.length).toBe(2);
    dispose();
  });

  it("re-wraps a newcomer that joins a one-child overlay", () => {
    let order = ["solo"];
    const app = keyedRowsApp(() => order, "overlay");
    const { dispose } = mount(app, root);
    expect(overlayLayers(root.firstElementChild as HTMLElement)).toEqual([]);

    order = ["solo", "b"];
    app._rerender?.();

    const overlay = root.firstElementChild as HTMLElement;
    expectIntactLayers(overlay, 1);
    expect(overlayLayers(overlay)[0]?.textContent).toBe("row b");
    dispose();
  });

  it("still takes the keyed path for a one-child overlay with no newcomer", () => {
    let text = "one";
    const app = appOf(() => ({ kind: "overlay", children: [{ kind: "text", text, key: "solo" }] }));
    const { dispose } = mount(app, root);
    const overlay = root.firstElementChild as HTMLElement;
    const solo = childAt(overlay, 0);

    text = "two";
    app._rerender?.();

    expect(root.firstElementChild).toBe(overlay);
    expect(childAt(overlay, 0)).toBe(solo);
    expect(solo.textContent).toBe("two");
    dispose();
  });
});

describe("WRAPPING_TILE_KINDS", () => {
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
      const host = freshRoot();
      const app = appOf(
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
    expect(
      [...WRAPPING_TILE_KINDS].filter((k) => !containers.includes(k as TileNode["kind"])),
    ).toEqual([]);
  });
});
