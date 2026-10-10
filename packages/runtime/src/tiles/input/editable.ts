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
  const nextText = newNode.text ?? "";
  if ((div.textContent ?? "") !== nextText && !IME_COMPOSING.has(div)) {
    div.textContent = nextText;
  }
  setHandlers(div, inputHandlers(newNode));
};
