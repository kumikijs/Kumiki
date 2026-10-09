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
  valueKey,
  writeBind,
} from "./_shared.ts";

function reconcileSelectOptions(
  sel: HTMLSelectElement,
  placeholder: string | undefined,
  options: Array<{ label: unknown; value: unknown }>,
  currentValue: unknown,
): void {
  const currentKey = valueKey(currentValue);
  const existing: HTMLOptionElement[] = Array.from(sel.options);
  const firstOption = existing[0];
  const hasPlaceholder = firstOption?.disabled === true && firstOption.value === "";
  if (placeholder != null) {
    if (hasPlaceholder && firstOption !== undefined) {
      firstOption.textContent = String(placeholder);
      firstOption.selected = currentValue == null;
    } else {
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = String(placeholder);
      ph.disabled = true;
      ph.selected = currentValue == null;
      sel.insertBefore(ph, sel.firstChild);
    }
  } else if (hasPlaceholder && firstOption !== undefined) {
    sel.removeChild(firstOption);
  }
  const offset = placeholder != null ? 1 : 0;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt) continue;
    const k = valueKey(opt.value);
    const existingAt = sel.options[i + offset];
    if (existingAt && existingAt.value === k) {
      if (existingAt.textContent !== String(opt.label)) {
        existingAt.textContent = String(opt.label);
      }
      existingAt.selected = k === currentKey;
      continue;
    }
    let found: HTMLOptionElement | undefined;
    for (let j = i + offset + 1; j < sel.options.length; j++) {
      const cand = sel.options[j];
      if (cand && cand.value === k) {
        found = cand;
        break;
      }
    }
    if (found) {
      if (found.textContent !== String(opt.label)) found.textContent = String(opt.label);
      found.selected = k === currentKey;
      sel.insertBefore(found, sel.options[i + offset] ?? null);
    } else {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = String(opt.label);
      o.selected = k === currentKey;
      sel.insertBefore(o, sel.options[i + offset] ?? null);
    }
  }
  while (sel.options.length > options.length + offset) {
    const last = sel.options[sel.options.length - 1];
    if (!last) break;
    sel.removeChild(last);
  }
}

export const selectTile: TileRenderer<"select"> = (node) => {
  const sel = document.createElement("select");
  sel.dataset.kumikiTile = "select";
  if (node.bind) bindDataset(sel, node.bind, node.bindPath);
  const id = tileId(node);
  if (id) sel.id = id;
  const options = (node.options ?? []) as Array<{ label: unknown; value: unknown }>;
  reconcileSelectOptions(sel, node.placeholder, options, node.value);
  setHandlers(sel, { ...inputHandlers(node), selectOptions: options });
  sel.addEventListener("change", () => {
    const state = INPUT_STATE.get(sel);
    const opts = state?.selectOptions ?? [];
    const k = sel.value;
    const matched = opts.find((o) => valueKey(o.value) === k);
    if (matched === undefined) return;
    if (state?.bind) {
      const app = liveApp(sel);
      if (app) writeBind(app, sel, state.bind, state.bindPath, matched.value);
    }
    if (state?.onChange) state.onChange({ ...(state.el ?? {}), value: matched.value });
  });
  applyControlState(sel, node.props);
  return sel;
};

export const selectPatcher: TilePatcher<"select"> = (el, _oldNode, newNode) => {
  const sel = el as HTMLSelectElement;
  reconcileId(sel, newNode);
  if (newNode.bind) bindDataset(sel, newNode.bind, newNode.bindPath);
  else clearBindDataset(sel);
  const options = (newNode.options ?? []) as Array<{ label: unknown; value: unknown }>;
  reconcileSelectOptions(sel, newNode.placeholder, options, newNode.value);
  setHandlers(sel, { ...inputHandlers(newNode), selectOptions: options });
  applyControlState(el, (newNode as { props?: TileProps }).props);
};
