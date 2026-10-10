import type { TilePatcher, TileProps, TileRenderer } from "../../core.ts";
import {
  applyControlState,
  bindDataset,
  clearBindDataset,
  IME_COMPOSING,
  INPUT_STATE,
  type InputHandlers,
  inputHandlers,
  installCompositionGuard,
  liveApp,
  reconcileId,
  setHandlers,
  setStringAttr,
  tileId,
  writeBind,
} from "./_shared.ts";

function setBooleanAttr(inp: HTMLElement, name: string, on: boolean): void {
  if (on) {
    if (!inp.hasAttribute(name)) inp.setAttribute(name, "");
  } else if (inp.hasAttribute(name)) {
    inp.removeAttribute(name);
  }
}

type InputNode = Parameters<TileRenderer<"input">>[0];

/** The handler slot for an input, with the reader its bound slot's type needs. */
function withParse(h: InputHandlers, node: InputNode): InputHandlers {
  if (node.parse) h.parse = node.parse;
  return h;
}

function readsSame(node: InputNode, text: string): boolean {
  if (!node.parse) return false;
  const shown = node.parse.read(text);
  const held = node.parse.read(node.value ?? "");
  return shown._tag === "Some" && held._tag === "Some" && shown._0 === held._0;
}

export const inputTile: TileRenderer<"input"> = (node) => {
  const inp = document.createElement("input");
  inp.dataset.kumikiTile = "input";
  inp.type = node.type ?? "text";
  if (node.placeholder) inp.placeholder = node.placeholder;
  if (node.required) inp.required = true;
  if (node.autoFocus) inp.autofocus = true;
  const id = tileId(node);
  if (id) inp.id = id;
  if (node.accept) inp.accept = String(node.accept);
  if (node.multiple) inp.multiple = true;
  const isFile = inp.type === "file";
  if (!isFile) {
    if (node.bind) bindDataset(inp, node.bind, node.bindPath);
    inp.value = node.value ?? "";
    installCompositionGuard(inp);
  }
  setHandlers(inp, withParse(inputHandlers(node), node));
  inp.addEventListener("input", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.bind && inp.type !== "file") {
      const app = liveApp(inp);
      if (app) writeBind(app, inp, state.bind, state.bindPath, inp.value, state.parse);
    }
    if (state?.onInput) state.onInput({ ...(state.el ?? {}), value: inp.value });
  });
  inp.addEventListener("change", () => {
    const state = INPUT_STATE.get(inp);
    if (!state?.onChange) return;
    if (inp.type === "file") {
      const list = inp.files;
      const files: Array<{ name: string; size: number; type: string; _file: File }> = [];
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          if (f) files.push({ name: f.name, size: f.size, type: f.type, _file: f });
        }
      }
      state.onChange({ ...(state.el ?? {}), files });
    } else {
      state.onChange({ ...(state.el ?? {}), value: inp.value });
    }
  });
  applyControlState(inp, node.props);
  return inp;
};

export const inputPatcher: TilePatcher<"input"> = (el, _oldNode, newNode) => {
  const inp = el as HTMLInputElement;
  const nextType = newNode.type ?? "text";
  if (inp.type !== nextType) inp.type = nextType;
  setStringAttr(inp, "placeholder", newNode.placeholder);
  setBooleanAttr(inp, "required", !!newNode.required);
  reconcileId(inp, newNode);
  setStringAttr(inp, "accept", newNode.accept == null ? undefined : String(newNode.accept));
  setBooleanAttr(inp, "multiple", !!newNode.multiple);
  const isFile = inp.type === "file";
  if (!isFile) {
    if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
    else clearBindDataset(inp);
    const nextValue = newNode.value ?? "";
    if (inp.value !== nextValue && !IME_COMPOSING.has(inp) && !readsSame(newNode, inp.value)) {
      inp.value = nextValue;
    }
  }
  setHandlers(inp, withParse(inputHandlers(newNode), newNode));
  applyControlState(el, (newNode as { props?: TileProps }).props);
};
