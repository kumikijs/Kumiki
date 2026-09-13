// The `slider` tile (#71): its own shipping unit, so an app that renders one
// does not download the nine other input controls.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import {
  applyControlState,
  bindDataset,
  clearBindDataset,
  INPUT_STATE,
  inputHandlers,
  liveApp,
  reconcileId,
  setHandlers,
  setStringAttr,
  tileId,
  writeBind,
} from "./_shared.ts";

export const sliderTile: TileRenderer<"slider"> = (node) => {
  const inp = document.createElement("input");
  inp.dataset.kumikiTile = "slider";
  inp.type = "range";
  const id = tileId(node);
  if (id) inp.id = id;
  if (typeof node.min === "number") inp.min = String(node.min);
  if (typeof node.max === "number") inp.max = String(node.max);
  if (typeof node.step === "number") inp.step = String(node.step);
  if (node.bind) bindDataset(inp, node.bind, node.bindPath);
  if (node.value != null) inp.value = String(node.value);
  setHandlers(inp, { ...inputHandlers(node), isSlider: true });
  inp.addEventListener("input", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.bind) {
      const app = liveApp(inp);
      if (app) writeBind(app, state.bind, state.bindPath, Number(inp.value));
    }
  });
  inp.addEventListener("change", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.onChange) state.onChange({ ...(state.el ?? {}), value: Number(inp.value) });
  });
  applyControlState(inp, node.props);
  return inp;
};

export const sliderPatcher: TilePatcher<"slider"> = (el, _oldNode, newNode) => {
  const inp = el as HTMLInputElement;
  reconcileId(inp, newNode);
  if (typeof newNode.min === "number") setStringAttr(inp, "min", String(newNode.min));
  if (typeof newNode.max === "number") setStringAttr(inp, "max", String(newNode.max));
  if (typeof newNode.step === "number") setStringAttr(inp, "step", String(newNode.step));
  if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
  else clearBindDataset(inp);
  if (newNode.value != null) {
    const nextValue = String(newNode.value);
    // Range inputs have no caret; a `.value` write mid-drag would jump the
    // thumb, so guard on active-drag by checking pointer-focus via focus.
    if (inp.value !== nextValue && document.activeElement !== inp) inp.value = nextValue;
  }
  setHandlers(inp, { ...inputHandlers(newNode), isSlider: true });
  applyControlState(el, (newNode as { props?: TileProps }).props);
};
