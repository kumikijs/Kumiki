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

const RADIO_VALUE = new WeakMap<HTMLElement, unknown>();

function setRadioValue(inp: HTMLInputElement, value: unknown): void {
  if (value === undefined) RADIO_VALUE.delete(inp);
  else RADIO_VALUE.set(inp, value);
}

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
  if (node.bind) bindDataset(inp, node.bind, node.bindPath);
  setHandlers(inp, inputHandlers(node));
  setRadioValue(inp, node.value);
  inp.addEventListener("change", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.bind && inp.checked && RADIO_VALUE.has(inp)) {
      const app = liveApp(inp);
      if (app) writeBind(app, inp, state.bind, state.bindPath, RADIO_VALUE.get(inp));
    }
    if (state?.onClick) state.onClick(state.el ?? {});
    if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
  });
  applyControlState(inp, node.props);
  return wrap;
};

export const radioPatcher: TilePatcher<"radio"> = (el, _oldNode, newNode) => {
  const wrap = el as HTMLLabelElement;
  reconcileId(wrap, newNode);
  const inp = wrap.firstElementChild as HTMLInputElement | null;
  if (inp) {
    const nextName = newNode.group ? String(newNode.group) : "";
    if (inp.name !== nextName) inp.name = nextName;
    const nextChecked = !!newNode.selected;
    if (inp.checked !== nextChecked) inp.checked = nextChecked;
    if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
    else clearBindDataset(inp);
    setHandlers(inp, inputHandlers(newNode));
    setRadioValue(inp, newNode.value);
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
