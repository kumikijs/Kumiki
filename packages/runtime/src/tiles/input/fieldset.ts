// The `fieldset` tile: a `<div>`-based container for a group of fields, with
// the caption its `legend` names (stdlib.md §2.3.5). It ships with the other
// form tiles rather than in the layout family, which every app downloads
// whole, so an app with no fieldset does not download the legend.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { applyContainerProps, attrValue } from "../../core.ts";

/**
 * The `<legend>` elements this module put in front of a fieldset's children.
 * A first child that is not one of them belongs to a child tile, and is never
 * rewritten or removed as if it were the caption.
 */
const LEGENDS = new WeakSet<Element>();

/**
 * Give `el` the caption `props.legend` names, as a `<legend>` ahead of its
 * children, or none when the prop is absent or empty. Create and patch both go
 * through here, so a legend read from a slot follows it: it is added, rewritten
 * in place, or removed.
 */
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

export const fieldsetTile: TileRenderer<"fieldset"> = (node, ctx) => {
  const div = document.createElement("div");
  div.dataset.kumikiTile = "fieldset";
  applyContainerProps(div, node.props);
  syncLegend(div, node.props);
  for (const child of node.children) {
    if (child != null) div.appendChild(ctx.render(child));
  }
  return div;
};

export const fieldsetPatcher: TilePatcher<"fieldset"> = (el, _oldNode, newNode) => {
  applyContainerProps(el, newNode.props);
  syncLegend(el, newNode.props);
};
