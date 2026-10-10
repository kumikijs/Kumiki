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
