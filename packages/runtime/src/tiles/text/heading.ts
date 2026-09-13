// The `heading` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";
import { applyTextProps } from "../../core.ts";

export const headingTile: TileRenderer<"heading"> = (node) => {
  const h = document.createElement("h1");
  h.dataset.kumikiTile = "heading";
  h.textContent = node.text;
  applyTextProps(h, node.props);
  return h;
};

export const headingPatcher: TilePatcher<"heading"> = (el, _oldNode, newNode) => {
  const h = el as HTMLHeadingElement;
  if (h.textContent !== newNode.text) h.textContent = newNode.text;
  applyTextProps(h, newNode.props);
};
