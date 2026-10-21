import type { TilePatcher, TileRenderer } from "../../core.ts";
import { patchToggle, syncBoxLabel, toggleTile } from "./_shared.ts";

const renderToggle = toggleTile("check");

/** A checkbox in a label, with the text beside the box as a trailing `<span>` as on a radio; a switch has none. */
export const checkTile: TileRenderer<"check"> = (node, ctx) => {
  const wrap = renderToggle(node, ctx);
  syncBoxLabel(wrap, node.props);
  return wrap;
};

export const checkPatcher: TilePatcher<"check"> = (el, oldNode, newNode, ctx) => {
  patchToggle(el, oldNode, newNode, ctx);
  syncBoxLabel(el, newNode.props);
};
