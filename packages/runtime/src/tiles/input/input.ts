// The `input` tile (#71): its own shipping unit, so an app that renders one
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

function setBooleanAttr(inp: HTMLElement, name: string, on: boolean): void {
  if (on) {
    if (!inp.hasAttribute(name)) inp.setAttribute(name, "");
  } else if (inp.hasAttribute(name)) {
    inp.removeAttribute(name);
  }
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
  // File inputs reject programmatic `.value` assignment (security) and have no
  // text representation worth pre-populating; the picked-file state lives in
  // the slot, not in the DOM. bind= is undefined for files (spec §5.1.1 table).
  if (!isFile) {
    if (node.bind) bindDataset(inp, node.bind, node.bindPath);
    inp.value = node.value ?? "";
    installCompositionGuard(inp);
  }
  setHandlers(inp, inputHandlers(node));
  inp.addEventListener("input", () => {
    const state = INPUT_STATE.get(inp);
    if (state?.bind && inp.type !== "file") {
      const app = liveApp(inp);
      if (app) writeBind(app, inp, state.bind, state.bindPath, inp.value);
    }
    if (state?.onInput) state.onInput({ ...(state.el ?? {}), value: inp.value });
  });
  inp.addEventListener("change", () => {
    const state = INPUT_STATE.get(inp);
    if (!state?.onChange) return;
    if (inp.type === "file") {
      // FileList → plain records the Kumiki layer can read: name / size /
      // type are visible to Kumiki expressions; `_file` keeps the original
      // DOM File so `file-url()` can hand it to URL.createObjectURL and a
      // future http effect can wrap it in Multipart.
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
    // Write when the DOM diverges from what the tile intends. Typing "Bud"
    // → bind writes slot="Bud" → rerender computes value=`_s.show(slot)`
    // ="Bud"; the DOM already reads "Bud", so this skips the assignment and
    // the caret stays put. A reducer that clears / rewrites the slot ("Buy
    // milk" → "" on Enter) DOES diverge and must land — caret restoration
    // is picked up by the outer `renderPass` snapshot layer, which captures
    // selectionStart/End BEFORE this write.
    //
    // IME guard: skip the write while the user is composing (JP/CN/KR IME
    // candidate window open). Overwriting `.value` mid-composition would
    // dismiss the candidate window and destroy the in-flight glyph. When
    // `compositionend` fires, the browser dispatches a normal `input` event
    // that syncs the slot to the committed text, and the next render's
    // divergence is genuine.
    const nextValue = newNode.value ?? "";
    if (inp.value !== nextValue && !IME_COMPOSING.has(inp)) inp.value = nextValue;
  }
  setHandlers(inp, inputHandlers(newNode));
  applyControlState(el, (newNode as { props?: TileProps }).props);
};
