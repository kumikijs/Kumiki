// The `radio` tile (#71): its own shipping unit, so an app that renders one
// does not download the nine other input controls.

import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import {
  applyControlState,
  INPUT_STATE,
  inputHandlers,
  reconcileId,
  setHandlers,
  tileId,
} from "./_shared.ts";

export const radioTile: TileRenderer<"radio"> = (node) => {
  const wrap = document.createElement("label");
  wrap.dataset.kumikiTile = "radio";
  const id = tileId(node);
  if (id) wrap.id = id;
  const inp = document.createElement("input");
  inp.type = "radio";
  if (node.group) inp.name = String(node.group);
  inp.checked = !!node.selected;
  const labelText = (node.props?.label as string | undefined) ?? "";
  wrap.appendChild(inp);
  if (labelText) {
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.appendChild(span);
  }
  setHandlers(inp, inputHandlers(node));
  inp.addEventListener("change", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.onClick) state.onClick(state.el ?? {});
    if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
  });
  applyControlState(inp, node.props);
  return wrap;
};

export const radioPatcher: TilePatcher<"radio"> = (el, _oldNode, newNode) => {
  const wrap = el as HTMLLabelElement;
  reconcileId(wrap, newNode);
  // check / radio / switch: create wraps a single `<input>` as the first
  // child (radio also appends a trailing `<span>` label; check / switch do
  // not). Use the direct child instead of `querySelector("input")` to avoid
  // matching a nested input if a future container tile ever wraps another
  // input beneath the same label.
  const inp = wrap.firstElementChild as HTMLInputElement | null;
  if (inp) {
    const nextName = newNode.group ? String(newNode.group) : "";
    if (inp.name !== nextName) inp.name = nextName;
    const nextChecked = !!newNode.selected;
    if (inp.checked !== nextChecked) inp.checked = nextChecked;
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
