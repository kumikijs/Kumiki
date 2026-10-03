// The `label` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";

export const labelTile: TileRenderer<"label"> = (node) => {
  const lbl = document.createElement("label");
  lbl.dataset.kumikiTile = "label";
  lbl.textContent = node.text;
  const forAttr = node.props?.for;
  if (typeof forAttr === "string") lbl.htmlFor = forAttr;
  return lbl;
};

export const labelPatcher: TilePatcher<"label"> = (el, _oldNode, newNode) => {
  const lbl = el as HTMLLabelElement;
  if (lbl.textContent !== newNode.text) lbl.textContent = newNode.text;
  const forAttr = newNode.props?.for;
  if (typeof forAttr === "string") {
    if (lbl.htmlFor !== forAttr) lbl.htmlFor = forAttr;
  } else if (lbl.htmlFor) {
    lbl.removeAttribute("for");
  }
};
