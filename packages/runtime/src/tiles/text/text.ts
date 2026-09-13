// The `text` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";
import { applyTextProps } from "../../core.ts";

export const textTile: TileRenderer<"text"> = (node) => {
  const span = document.createElement("span");
  span.dataset.kumikiTile = "text";
  span.textContent = node.text;
  applyTextProps(span, node.props);
  return span;
};

export const textPatcher: TilePatcher<"text"> = (el, _oldNode, newNode) => {
  const span = el as HTMLSpanElement;
  if (span.textContent !== newNode.text) span.textContent = newNode.text;
  applyTextProps(span, newNode.props);
};
