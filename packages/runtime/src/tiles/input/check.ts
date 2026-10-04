// The `check` tile (#71): its own shipping unit, so an app that renders one
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
  tileId,
  writeBind,
} from "./_shared.ts";

export const checkTile: TileRenderer<"check"> = (node) => {
  const wrap = document.createElement("label");
  wrap.dataset.kumikiTile = "check";
  const id = tileId(node);
  if (id) wrap.id = id;
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.checked = node.checked;
  if (node.bind) bindDataset(inp, node.bind, node.bindPath);
  setHandlers(inp, inputHandlers(node));
  inp.addEventListener("change", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.bind) {
      const app = liveApp(inp);
      if (app) writeBind(app, inp, state.bind, state.bindPath, inp.checked);
    }
    if (state?.onClick) state.onClick(state.el ?? {});
    if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
  });
  wrap.appendChild(inp);
  // The text beside the box (stdlib.md §2.3.4), as a radio shows its own.
  const labelText = (node.props?.label as string | undefined) ?? "";
  if (labelText) {
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.appendChild(span);
  }
  applyControlState(inp, node.props);
  return wrap;
};

export const checkPatcher: TilePatcher<"check"> = (el, _oldNode, newNode) => {
  const wrap = el as HTMLLabelElement;
  reconcileId(wrap, newNode);
  // check / radio / switch: create wraps a single `<input>` as the first
  // child (check and radio also append a trailing `<span>` label; switch does
  // not). Use the direct child instead of `querySelector("input")` to avoid
  // matching a nested input if a future container tile ever wraps another
  // input beneath the same label.
  const inp = wrap.firstElementChild as HTMLInputElement | null;
  if (inp) {
    if (inp.checked !== newNode.checked) inp.checked = newNode.checked;
    if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
    else clearBindDataset(inp);
    setHandlers(inp, inputHandlers(newNode));
  }
  // Reconcile the trailing label span if the label text changed.
  const nextLabel = (newNode.props?.label as string | undefined) ?? "";
  const span = wrap.querySelector("span");
  if (nextLabel) {
    if (span) {
      if (span.textContent !== nextLabel) span.textContent = nextLabel;
    } else {
      const s = document.createElement("span");
      s.textContent = nextLabel;
      wrap.appendChild(s);
    }
  } else if (span) {
    wrap.removeChild(span);
  }
  applyControlState(el.querySelector("input") ?? el, (newNode as { props?: TileProps }).props);
};
