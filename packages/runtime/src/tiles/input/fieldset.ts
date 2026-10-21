// Ships with the form tiles rather than in the layout family, which any app with a `column`, `row` or `page` downloads, so an app with no fieldset does not download the legend.

import type { StyleDecl, TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { applyContainerProps, attrValue } from "../../core.ts";

/** A `<fieldset>`'s user-agent margin, border, padding and min-width, reset so it lays out as the `<div>` containers do; a prop that sets one still wins. The server pass writes the same. */
export const FIELDSET_RESET: readonly StyleDecl[] = [
  ["margin", "0"],
  ["border", "0"],
  ["padding", "0"],
  ["min-width", "0"],
];

/** A first child this module did not put there belongs to a child tile, and is never rewritten or removed as the caption. */
const LEGENDS = new WeakSet<Element>();

function syncLegend(el: HTMLElement, props?: TileProps): void {
  const text = attrValue(props?.legend);
  const first = el.firstElementChild;
  let legend = first && LEGENDS.has(first) ? first : null;
  if (text === undefined) {
    legend?.remove();
    return;
  }
  if (!legend) {
    legend = document.createElement("legend");
    LEGENDS.add(legend);
    el.prepend(legend);
  }
  if (legend.textContent !== String(text)) legend.textContent = String(text);
}

/** A real `<fieldset>`, so its `<legend>` is valid markup and names the group for assistive technology. */
export const fieldsetTile: TileRenderer<"fieldset"> = (node, ctx) => {
  const el = document.createElement("fieldset");
  el.dataset.kumikiTile = "fieldset";
  for (const [name, value] of FIELDSET_RESET) el.style.setProperty(name, value);
  applyContainerProps(el, node.props);
  syncLegend(el, node.props);
  for (const child of node.children) {
    if (child != null) el.appendChild(ctx.render(child));
  }
  return el;
};

export const fieldsetPatcher: TilePatcher<"fieldset"> = (el, _oldNode, newNode) => {
  applyContainerProps(el, newNode.props);
  syncLegend(el, newNode.props);
};
