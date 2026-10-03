// The `editable` tile (#71): its own shipping unit, so an app that renders one
// does not download the nine other input controls.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import {
  applyControlState,
  bindDataset,
  clearBindDataset,
  IME_COMPOSING,
  INPUT_STATE,
  inputHandlers,
  installCompositionGuard,
  liveApp,
  reconcileId,
  setHandlers,
  tileId,
  writeBind,
} from "./_shared.ts";

export const editableTile: TileRenderer<"editable"> = (node) => {
  const div = document.createElement("div");
  div.dataset.kumikiTile = "editable";
  div.contentEditable = "true";
  applyControlState(div, node.props);
  const id = tileId(node);
  if (id) div.id = id;
  if (node.bind) bindDataset(div, node.bind, node.bindPath);
  div.textContent = node.text ?? "";
  installCompositionGuard(div);
  setHandlers(div, inputHandlers(node));
  div.addEventListener("input", () => {
    const state = INPUT_STATE.get(div);
    const value = div.textContent ?? "";
    if (state?.bind) {
      const app = liveApp(div);
      if (app) writeBind(app, div, state.bind, state.bindPath, value);
    }
    if (state?.onInput) state.onInput({ ...(state.el ?? {}), value });
  });
  return div;
};

export const editablePatcher: TilePatcher<"editable"> = (el, _oldNode, newNode) => {
  const div = el as HTMLDivElement;
  applyControlState(div, (newNode as { props?: TileProps }).props);
  reconcileId(div, newNode);
  if (newNode.bind) bindDataset(div, newNode.bind, newNode.bindPath);
  else clearBindDataset(div);
  // Text write on divergence only. During typing the bind loop keeps the
  // slot in sync with the DOM (`slot = textContent`), so `newNode.text ===
  // div.textContent` and this skips the assignment — caret / IME composition
  // survive. IME guard skips the write while a compositionstart..end is in
  // flight (JP/CN/KR candidate window), matching the `input` / `textarea`
  // patcher behaviour. A reducer that explicitly rewrites the slot outside
  // of composition DOES land here and will jump the caret; contenteditable
  // has no snapshot equivalent to INPUT's `setSelectionRange`, and
  // restoring a text-node offset across an arbitrary rewrite is out of
  // scope for #190 (native focus is still preserved via patch identity).
  const nextText = newNode.text ?? "";
  if ((div.textContent ?? "") !== nextText && !IME_COMPOSING.has(div)) {
    div.textContent = nextText;
  }
  setHandlers(div, inputHandlers(newNode));
};
