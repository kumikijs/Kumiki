import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { attrValue, ensureAnimationStyles } from "../../core.ts";
import { INPUT_STATE, inputHandlers, reconcileId, setHandlers, tileId } from "./_shared.ts";

/** The in-button spinner. Same element the `spinner` tile renders, so one rule set styles both. */
function buttonSpinner(): HTMLElement {
  ensureAnimationStyles();
  const s = document.createElement("span");
  s.dataset.kumikiTile = "spinner";
  s.setAttribute("aria-hidden", "true");
  s.style.marginRight = "0.4em";
  return s;
}

function applyButtonState(b: HTMLButtonElement, props?: TileProps): void {
  const loading = props?.loading === true;
  b.disabled = loading || props?.disabled === true;
  if (loading) b.setAttribute("aria-busy", "true");
  else b.removeAttribute("aria-busy");
  const variant = attrValue(props?.variant);
  if (variant !== undefined) b.dataset.kumikiVariant = String(variant);
  else delete b.dataset.kumikiVariant;
  const spinner = b.querySelector('[data-kumiki-tile="spinner"]');
  if (loading && !spinner) b.insertBefore(buttonSpinner(), b.firstChild);
  else if (!loading && spinner) spinner.remove();
}

function setButtonLabel(b: HTMLButtonElement, text: string): void {
  const last = b.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    if (last.nodeValue !== text) last.nodeValue = text;
    return;
  }
  b.appendChild(document.createTextNode(text));
}

export const buttonTile: TileRenderer<"button"> = (node) => {
  const b = document.createElement("button");
  b.dataset.kumikiTile = "button";
  b.appendChild(document.createTextNode(node.text));
  if (node.type) b.setAttribute("type", node.type);
  applyButtonState(b, node.props);
  const id = tileId(node);
  if (id) b.id = id;
  setHandlers(b, inputHandlers(node));
  b.addEventListener("click", () => {
    const state = INPUT_STATE.get(b);
    if (state?.onClick) state.onClick(state.el ?? {});
  });
  return b;
};

export const buttonPatcher: TilePatcher<"button"> = (el, _oldNode, newNode) => {
  const b = el as HTMLButtonElement;
  setButtonLabel(b, newNode.text);
  const nextType = newNode.type ? String(newNode.type) : null;
  if (b.getAttribute("type") !== nextType) {
    if (nextType === null) b.removeAttribute("type");
    else b.setAttribute("type", nextType);
  }
  applyButtonState(b, newNode.props);
  reconcileId(b, newNode);
  setHandlers(b, inputHandlers(newNode));
};
