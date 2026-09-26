// The `textarea` tile (#71): its own shipping unit, so an app that renders one
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
  setStringAttr,
  tileId,
  writeBind,
} from "./_shared.ts";

export const textareaTile: TileRenderer<"textarea"> = (node) => {
  const ta = document.createElement("textarea");
  ta.dataset.kumikiTile = "textarea";
  if (node.rows) ta.rows = node.rows;
  if (node.placeholder) ta.placeholder = node.placeholder;
  const id = tileId(node);
  if (id) ta.id = id;
  if (node.bind) bindDataset(ta, node.bind, node.bindPath);
  ta.value = node.value ?? "";
  installCompositionGuard(ta);
  setHandlers(ta, inputHandlers(node));
  ta.addEventListener("input", () => {
    const state = INPUT_STATE.get(ta);
    if (state?.bind) {
      const app = liveApp(ta);
      if (app) writeBind(app, ta, state.bind, state.bindPath, ta.value);
    }
    if (state?.onInput) state.onInput({ ...(state.el ?? {}), value: ta.value });
  });
  ta.addEventListener("change", () => {
    const state = INPUT_STATE.get(ta);
    if (state?.onChange) state.onChange({ ...(state.el ?? {}), value: ta.value });
  });
  applyControlState(ta, node.props);
  return ta;
};

export const textareaPatcher: TilePatcher<"textarea"> = (el, _oldNode, newNode) => {
  const ta = el as HTMLTextAreaElement;
  if (typeof newNode.rows === "number" && ta.rows !== newNode.rows) ta.rows = newNode.rows;
  setStringAttr(ta, "placeholder", newNode.placeholder);
  reconcileId(ta, newNode);
  if (newNode.bind) bindDataset(ta, newNode.bind, newNode.bindPath);
  else clearBindDataset(ta);
  const nextValue = newNode.value ?? "";
  // See `input` patcher — write on divergence, caret restore is upstream.
  // IME guard as above: don't dismiss the IME candidate window mid-compose.
  if (ta.value !== nextValue && !IME_COMPOSING.has(ta)) ta.value = nextValue;
  setHandlers(ta, inputHandlers(newNode));
  applyControlState(el, (newNode as { props?: TileProps }).props);
};
