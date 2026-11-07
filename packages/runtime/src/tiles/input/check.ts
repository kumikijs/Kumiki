import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { attrValue } from "../../core.ts";
import { patchToggle, toggleTile } from "./_shared.ts";

/** The text after a `check` or `radio` box, by the `legend` rule: a number shows its digits; a Bool or an empty Text shows nothing. radio.ts and the server pass follow it too. */
export function boxLabelText(props: TileProps | undefined): string {
  const label = attrValue(props?.label);
  return label === undefined ? "" : String(label);
}

/** The text beside the box, a trailing `<span>` as on a radio; a switch has none. */
function syncLabel(wrap: HTMLElement, props: TileProps | undefined): void {
  const text = boxLabelText(props);
  const span = wrap.querySelector("span");
  if (!text) {
    span?.remove();
    return;
  }
  if (!span) {
    const s = document.createElement("span");
    s.textContent = text;
    wrap.appendChild(s);
  } else if (span.textContent !== text) {
    span.textContent = text;
  }
}

const renderToggle = toggleTile("check");

export const checkTile: TileRenderer<"check"> = (node, ctx) => {
  const wrap = renderToggle(node, ctx);
  syncLabel(wrap, node.props);
  return wrap;
};

export const checkPatcher: TilePatcher<"check"> = (el, oldNode, newNode, ctx) => {
  patchToggle(el, oldNode, newNode, ctx);
  syncLabel(el, newNode.props);
};
