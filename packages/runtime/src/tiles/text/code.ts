// The `code` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";

export const codeTile: TileRenderer<"code"> = (node) => {
  const pre = document.createElement("pre");
  pre.dataset.kumikiTile = "code";
  const code = document.createElement("code");
  code.textContent = node.text;
  if (node.lang) code.dataset.lang = node.lang;
  pre.appendChild(code);
  return pre;
};

export const codePatcher: TilePatcher<"code"> = (el, oldNode, newNode) => {
  const pre = el as HTMLPreElement;
  const code = pre.querySelector("code");
  if (code && code.textContent !== newNode.text) code.textContent = newNode.text;
  if (code) {
    if (newNode.lang != null) {
      if (code.dataset.lang !== newNode.lang) code.dataset.lang = newNode.lang;
    } else if (oldNode.lang != null) {
      delete code.dataset.lang;
    }
  }
};
