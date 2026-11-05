import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import { attrValue } from "../../core.ts";
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
  valueKey,
  writeBind,
} from "./_shared.ts";

const RADIO_VALUE = new WeakMap<HTMLElement, unknown>();

/** The text after the box as a trailing `<span>`, by check.ts's `boxLabelText` rule; spelled out here because each tile module ships on its own. */
function syncLabel(wrap: HTMLElement, props: TileProps | undefined): void {
  const label = attrValue(props?.label);
  const text = label === undefined ? "" : String(label);
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

// The bind writes the value itself; the attribute carries its key, which the served
// radio carries too, since a radio's `value` reflects into the markup.
function setRadioValue(inp: HTMLInputElement, value: unknown): void {
  if (value === undefined) {
    RADIO_VALUE.delete(inp);
    inp.removeAttribute("value");
    return;
  }
  RADIO_VALUE.set(inp, value);
  const key = valueKey(value);
  if (inp.getAttribute("value") !== key) inp.setAttribute("value", key);
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
  wrap.appendChild(inp);
  syncLabel(wrap, node.props);
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
  syncLabel(wrap, newNode.props);
  applyControlState(el.querySelector("input") ?? el, (newNode as { props?: TileProps }).props);
};
