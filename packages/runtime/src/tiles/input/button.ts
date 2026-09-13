// The `button` tile (#71): its own shipping unit, so an app that renders one
// does not download the nine other input controls.

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

/**
 * `disabled`, `loading` and `variant` on a `<button>` (stdlib.md §2.3.4,
 * forms.md §5.8). Shared by create and patch, so a `loading=` bound to a slot
 * turns the spinner on and off rather than only ever on.
 *
 * `loading` means "this button's work is in flight": it disables the button
 * (forms.md: a loading button is not clickable), says so with `aria-busy`, and
 * puts a spinner in front of the label. The spinner is hidden from assistive
 * technology — a labelled one would join the button's accessible name through
 * name-from-content and turn "Save" into "Loading Save", which is the one thing
 * a busy button must not do to the name a user is listening for.
 */
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

/**
 * Write the button's label without disturbing anything else inside it. The
 * label is the trailing text node; the spinner, when there is one, sits before
 * it.
 */
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
  // A text NODE rather than `textContent`, because the label is not the only
  // thing in a button: a loading button also holds a spinner, and assigning
  // `textContent` on the next render would take it back out.
  b.appendChild(document.createTextNode(node.text));
  // Only when the tile said so: a `<button>` with no type submits the form it
  // is in, and that default is the one forms.md §5.2.2 describes. Writing
  // `type="button"` here for every button would silently un-submit every
  // form that relies on it.
  if (node.type) b.setAttribute("type", node.type);
  applyButtonState(b, node.props);
  const id = tileId(node);
  if (id) b.id = id;
  setHandlers(b, inputHandlers(node));
  b.addEventListener("click", (e) => {
    const state = INPUT_STATE.get(b);
    if (state?.onClick) {
      e.preventDefault();
      state.onClick(state.el ?? {});
    }
  });
  return b;
};

export const buttonPatcher: TilePatcher<"button"> = (el, _oldNode, newNode) => {
  const b = el as HTMLButtonElement;
  setButtonLabel(b, newNode.text);
  // A conditional can swap one button for another with a different `type`,
  // so this is reconciled like every other attribute — and a node that stops
  // carrying one loses the attribute rather than keeping what the previous
  // render set, which is what `create` and the SSR path produce for it.
  //
  // Compared against the ATTRIBUTE, not `b.type`: that property reports the
  // browser's resolved value, so an absent or invalid attribute reads back as
  // "submit" and the comparison would be true on every single reconcile.
  const nextType = newNode.type ? String(newNode.type) : null;
  if (b.getAttribute("type") !== nextType) {
    if (nextType === null) b.removeAttribute("type");
    else b.setAttribute("type", nextType);
  }
  applyButtonState(b, newNode.props);
  reconcileId(b, newNode);
  setHandlers(b, inputHandlers(newNode));
};
