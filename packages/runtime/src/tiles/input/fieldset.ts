// Ships with the form tiles rather than in the layout family every app downloads, so an app with no fieldset does not download the legend.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { applyContainerProps, attrValue } from "../../core.ts";

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
