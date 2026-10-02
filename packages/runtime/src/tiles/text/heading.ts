// The `heading` tile (#71): its own shipping unit, so an app that renders one
// does not download the six other text tiles.

import type { TilePatcher, TileRenderer } from "../../core.ts";
import { applyTextProps, PatchRequiresRebuild } from "../../core.ts";

/**
 * The element `heading` renders for its `level` prop (stdlib.md §2.3): `h1`
 * through `h6`. A fractional level drops its fraction and one outside 1-6 is
 * pulled to the nearer end, `Infinity` included (`h6`, and `h1` for
 * `-Infinity`); a heading with no numeric level, or `NaN`, is an `h1`. The SSR
 * renderer calls this too, so both paths draw the same tag.
 */
export function headingTag(level: unknown): string {
  const n = typeof level === "number" && !Number.isNaN(level) ? Math.trunc(level) : 1;
  return `h${Math.min(6, Math.max(1, n))}`;
}

export const headingTile: TileRenderer<"heading"> = (node) => {
  const h = document.createElement(headingTag(node.props?.level));
  h.dataset.kumikiTile = "heading";
  h.textContent = node.text;
  applyTextProps(h, node.props);
  return h;
};

export const headingPatcher: TilePatcher<"heading"> = (el, _oldNode, newNode) => {
  const want = headingTag(newNode.props?.level);
  // A level change is a different element, which cannot be retagged in place.
  if (el.tagName.toLowerCase() !== want) {
    throw new PatchRequiresRebuild(`heading level changed (${el.tagName} → ${want})`);
  }
  if (el.textContent !== newNode.text) el.textContent = newNode.text;
  applyTextProps(el, newNode.props);
};
